#include "node_binding.h"
#include <atomic>
#include "env-inl.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_native_module_env.h"
#include "util.h"

#include <string>

#if HAVE_OPENSSL
#define NODE_BUILTIN_OPENSSL_MODULES(V) V(crypto) V(tls_wrap)
#else
#define NODE_BUILTIN_OPENSSL_MODULES(V)
#endif

#if NODE_HAVE_I18N_SUPPORT
#define NODE_BUILTIN_ICU_MODULES(V) V(icu)
#else
#define NODE_BUILTIN_ICU_MODULES(V)
#endif

#if HAVE_INSPECTOR
#define NODE_BUILTIN_PROFILER_MODULES(V) V(profiler)
#else
#define NODE_BUILTIN_PROFILER_MODULES(V)
#endif

#if HAVE_DTRACE || HAVE_ETW
#define NODE_BUILTIN_DTRACE_MODULES(V) V(dtrace)
#else
#define NODE_BUILTIN_DTRACE_MODULES(V)
#endif

// A list of built-in modules. In order to do module registration
// in node::Init(), need to add built-in modules in the following list.
// Then in binding::RegisterBuiltinModules(), it calls modules' registration
// function. This helps the built-in modules are loaded properly when
// node is built as static library. No need to depend on the
// __attribute__((constructor)) like mechanism in GCC.
#define NODE_BUILTIN_STANDARD_MODULES(V)                                       \
  V(async_wrap)                                                                \
  V(blob)                                                                      \
  V(block_list)                                                                \
  V(buffer)                                                                    \
  V(cares_wrap)                                                                \
  V(config)                                                                    \
  V(contextify)                                                                \
  V(credentials)                                                               \
  V(errors)                                                                    \
  V(fs)                                                                        \
  V(fs_dir)                                                                    \
  V(fs_event_wrap)                                                             \
  V(heap_utils)                                                                \
  V(http2)                                                                     \
  V(http_parser)                                                               \
  V(inspector)                                                                 \
  V(js_stream)                                                                 \
  V(js_udp_wrap)                                                               \
  V(messaging)                                                                 \
  V(module_wrap)                                                               \
  V(mksnapshot)                                                                \
  V(native_module)                                                             \
  V(options)                                                                   \
  V(os)                                                                        \
  V(performance)                                                               \
  V(pipe_wrap)                                                                 \
  V(process_wrap)                                                              \
  V(process_methods)                                                           \
  V(report)                                                                    \
  V(serdes)                                                                    \
  V(signal_wrap)                                                               \
  V(spawn_sync)                                                                \
  V(stream_pipe)                                                               \
  V(stream_wrap)                                                               \
  V(string_decoder)                                                            \
  V(symbols)                                                                   \
  V(task_queue)                                                                \
  V(tcp_wrap)                                                                  \
  V(timers)                                                                    \
  V(trace_events)                                                              \
  V(tty_wrap)                                                                  \
  V(types)                                                                     \
  V(udp_wrap)                                                                  \
  V(url)                                                                       \
  V(util)                                                                      \
  V(uv)                                                                        \
  V(v8)                                                                        \
  V(wasi)                                                                      \
  V(watchdog)                                                                  \
  V(worker)                                                                    \
  V(zlib)

#define NODE_BUILTIN_MODULES(V)                                                \
  NODE_BUILTIN_STANDARD_MODULES(V)                                             \
  NODE_BUILTIN_OPENSSL_MODULES(V)                                              \
  NODE_BUILTIN_ICU_MODULES(V)                                                  \
  NODE_BUILTIN_PROFILER_MODULES(V)                                             \
  NODE_BUILTIN_DTRACE_MODULES(V)

// This is used to load built-in modules. Instead of using
// __attribute__((constructor)), we call the _register_<modname>
// function for each built-in modules explicitly in
// binding::RegisterBuiltinModules(). This is only forward declaration.
// The definitions are in each module's implementation when calling
// the NODE_MODULE_CONTEXT_AWARE_INTERNAL.
#define V(modname) void _register_##modname();
NODE_BUILTIN_MODULES(V)
#undef V

#ifdef _AIX
// On AIX, dlopen() behaves differently from other operating systems, in that
// it returns unique values from each call, rather than identical values, when
// loading the same handle.
// We try to work around that by providing wrappers for the dlopen() family of
// functions, and using st_dev and st_ino for the file that is to be loaded
// as keys for a cache.

namespace node {
namespace dlwrapper {

struct dl_wrap {
  uint64_t st_dev;
  uint64_t st_ino;
  uint64_t refcount;
  void* real_handle;

  struct hash {
    size_t operator()(const dl_wrap* wrap) const {
      return std::hash<uint64_t>()(wrap->st_dev) ^
             std::hash<uint64_t>()(wrap->st_ino);
    }
  };

  struct equal {
    bool operator()(const dl_wrap* a,
                    const dl_wrap* b) const {
      return a->st_dev == b->st_dev && a->st_ino == b->st_ino;
    }
  };
};

static Mutex dlhandles_mutex;
static std::unordered_set<dl_wrap*, dl_wrap::hash, dl_wrap::equal>
    dlhandles;
static thread_local std::string dlerror_storage;

char* wrapped_dlerror() {
  return &dlerror_storage[0];
}

void* wrapped_dlopen(const char* filename, int flags) {
  CHECK_NOT_NULL(filename);  // This deviates from the 'real' dlopen().
  Mutex::ScopedLock lock(dlhandles_mutex);

  uv_fs_t req;
  auto cleanup = OnScopeLeave([&]() { uv_fs_req_cleanup(&req); });
  int rc = uv_fs_stat(nullptr, &req, filename, nullptr);

  if (rc != 0) {
    dlerror_storage = uv_strerror(rc);
    return nullptr;
  }

  dl_wrap search = {
    req.statbuf.st_dev,
    req.statbuf.st_ino,
    0, nullptr
  };

  auto it = dlhandles.find(&search);
  if (it != dlhandles.end()) {
    (*it)->refcount++;
    return *it;
  }

  void* real_handle = dlopen(filename, flags);
  if (real_handle == nullptr) {
    dlerror_storage = dlerror();
    return nullptr;
  }
  dl_wrap* wrap = new dl_wrap();
  wrap->st_dev = req.statbuf.st_dev;
  wrap->st_ino = req.statbuf.st_ino;
  wrap->refcount = 1;
  wrap->real_handle = real_handle;
  dlhandles.insert(wrap);
  return wrap;
}

int wrapped_dlclose(void* handle) {
  Mutex::ScopedLock lock(dlhandles_mutex);
  dl_wrap* wrap = static_cast<dl_wrap*>(handle);
  int ret = 0;
  CHECK_GE(wrap->refcount, 1);
  if (--wrap->refcount == 0) {
    ret = dlclose(wrap->real_handle);
    if (ret != 0) dlerror_storage = dlerror();
    dlhandles.erase(wrap);
    delete wrap;
  }
  return ret;
}

void* wrapped_dlsym(void* handle, const char* symbol) {
  if (handle == RTLD_DEFAULT || handle == RTLD_NEXT)
    return dlsym(handle, symbol);
  dl_wrap* wrap = static_cast<dl_wrap*>(handle);
  return dlsym(wrap->real_handle, symbol);
}

#define dlopen node::dlwrapper::wrapped_dlopen
#define dlerror node::dlwrapper::wrapped_dlerror
#define dlclose node::dlwrapper::wrapped_dlclose
#define dlsym node::dlwrapper::wrapped_dlsym

}  // namespace dlwrapper
}  // namespace node

#endif  // _AIX

#ifdef __linux__
static bool libc_may_be_musl() {
  static std::atomic_bool retval;  // Cache the return value.
  static std::atomic_bool has_cached_retval { false };
  if (has_cached_retval) return retval;
  retval = dlsym(RTLD_DEFAULT, "gnu_get_libc_version") == nullptr;
  has_cached_retval = true;
  return retval;
}
#else  // __linux__
static bool libc_may_be_musl() { return false; }
#endif  // __linux__

namespace node {

using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

// Globals per process
static node_module* modlist_internal;
static node_module* modlist_linked;
static thread_local node_module* thread_local_modpending;

// This is set by node::Init() which is used by embedders
bool node_is_initialized = false;

extern "C" void node_module_register(void* m) {
  struct node_module* mp = reinterpret_cast<struct node_module*>(m);

  if (mp->nm_flags & NM_F_INTERNAL) {
    mp->nm_link = modlist_internal;
    modlist_internal = mp;
  } else if (!node_is_initialized) {
    // "Linked" modules are included as part of the node project.
    // Like builtins they are registered *before* node::Init runs.
    mp->nm_flags = NM_F_LINKED;
    mp->nm_link = modlist_linked;
    modlist_linked = mp;
  } else {
    thread_local_modpending = mp;
  }
}

namespace binding {

static struct global_handle_map_t {
 public:
  void set(void* handle, node_module* mod) {
    CHECK_NE(handle, nullptr);
    Mutex::ScopedLock lock(mutex_);

    map_[handle].module = mod;
    // We need to store this flag internally to avoid a chicken-and-egg problem
    // during cleanup. By the time we actually use the flag's value,
    // the shared object has been unloaded, and its memory would be gone,
    // making it impossible to access fields of `mod` --
    // unless `mod` *is* dynamically allocated, but we cannot know that
    // without checking the flag.
    map_[handle].wants_delete_module = mod->nm_flags & NM_F_DELETEME;
    map_[handle].refcount++;
  }

  node_module* get_and_increase_refcount(void* handle) {
    CHECK_NE(handle, nullptr);
    Mutex::ScopedLock lock(mutex_);

    auto it = map_.find(handle);
    if (it == map_.end()) return nullptr;
    it->second.refcount++;
    return it->second.module;
  }

  void erase(void* handle) {
    CHECK_NE(handle, nullptr);
    Mutex::ScopedLock lock(mutex_);

    auto it = map_.find(handle);
    if (it == map_.end()) return;
    CHECK_GE(it->second.refcount, 1);
    if (--it->second.refcount == 0) {
      if (it->second.wants_delete_module)
        delete it->second.module;
      map_.erase(handle);
    }
  }

 private:
  Mutex mutex_;
  struct Entry {
    unsigned int refcount;
    bool wants_delete_module;
    node_module* module;
  };
  std::unordered_map<void*, Entry> map_;
} global_handle_map;

DLib::DLib(const char* filename, int flags)
    : filename_(filename), flags_(flags), handle_(nullptr) {}

#ifdef __POSIX__
bool DLib::Open() {
  handle_ = dlopen(filename_.c_str(), flags_);
  if (handle_ != nullptr) return true;
  errmsg_ = dlerror();
  return false;
}

void DLib::Close() {
  if (handle_ == nullptr) return;

  if (libc_may_be_musl()) {
    // musl libc implements dlclose() as a no-op which returns 0.
    // As a consequence, trying to re-load a previously closed addon at a later
    // point will not call its static constructors, which Node.js uses.
    // Therefore, when we may be using musl libc, we assume that the shared
    // object exists indefinitely and keep it in our handle map.
    return;
  }

  int err = dlclose(handle_);
  if (err == 0) {
    if (has_entry_in_global_handle_map_)
      global_handle_map.erase(handle_);
  }
  handle_ = nullptr;
}

void* DLib::GetSymbolAddress(const char* name) {
  return dlsym(handle_, name);
}
#else   // !__POSIX__
bool DLib::Open() {
  int ret = uv_dlopen(filename_.c_str(), &lib_);
  if (ret == 0) {
    handle_ = static_cast<void*>(lib_.handle);
    return true;
  }
  errmsg_ = uv_dlerror(&lib_);
  uv_dlclose(&lib_);
  return false;
}

void DLib::Close() {
  if (handle_ == nullptr) return;
  if (has_entry_in_global_handle_map_)
    global_handle_map.erase(handle_);
  uv_dlclose(&lib_);
  handle_ = nullptr;
}

void* DLib::GetSymbolAddress(const char* name) {
  void* address;
  if (0 == uv_dlsym(&lib_, name, &address)) return address;
  return nullptr;
}
#endif  // !__POSIX__

void DLib::SaveInGlobalHandleMap(node_module* mp) {
  has_entry_in_global_handle_map_ = true;
  global_handle_map.set(handle_, mp);
}

node_module* DLib::GetSavedModuleFromGlobalHandleMap() {
  has_entry_in_global_handle_map_ = true;
  return global_handle_map.get_and_increase_refcount(handle_);
}

using InitializerCallback = void (*)(Local<Object> exports,
                                     Local<Value> module,
                                     Local<Context> context);

inline InitializerCallback GetInitializerCallback(DLib* dlib) {
  const char* name = "node_register_module_v" STRINGIFY(NODE_MODULE_VERSION);
  return reinterpret_cast<InitializerCallback>(dlib->GetSymbolAddress(name));
}

inline napi_addon_register_func GetNapiInitializerCallback(DLib* dlib) {
  const char* name =
      STRINGIFY(NAPI_MODULE_INITIALIZER_BASE) STRINGIFY(NAPI_MODULE_VERSION);
  return reinterpret_cast<napi_addon_register_func>(
      dlib->GetSymbolAddress(name));
}

// DLOpen is process.dlopen(module, filename, flags).
// Used to load 'module.node' dynamically shared objects.
//
// FIXME(bnoordhuis) Not multi-context ready. TBD how to resolve the conflict
// when two contexts try to load the same shared object. Maybe have a shadow
// cache that's a plain C list or hash table that's shared across contexts?
void DLOpen(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (env->no_native_addons()) {
    return THROW_ERR_DLOPEN_DISABLED(
      env, "Cannot load native addon because loading addons is disabled.");
  }

  auto context = env->context();

  CHECK_NULL(thread_local_modpending);

  if (args.Length() < 2) {
    return THROW_ERR_MISSING_ARGS(
        env, "process.dlopen needs at least 2 arguments");
  }

  int32_t flags = DLib::kDefaultFlags;
  if (args.Length() > 2 && !args[2]->Int32Value(context).To(&flags)) {
    return THROW_ERR_INVALID_ARG_TYPE(env, "flag argument must be an integer.");
  }

  Local<Object> module;
  Local<Object> exports;
  Local<Value> exports_v;
  if (!args[0]->ToObject(context).ToLocal(&module) ||
      !module->Get(context, env->exports_string()).ToLocal(&exports_v) ||
      !exports_v->ToObject(context).ToLocal(&exports)) {
    return;  // Exception pending.
  }

  node::Utf8Value filename(env->isolate(), args[1]);  // Cast
  env->TryLoadAddon(*filename, flags, [&](DLib* dlib) {
    static Mutex dlib_load_mutex;
    Mutex::ScopedLock lock(dlib_load_mutex);

    const bool is_opened = dlib->Open();

    // Objects containing v14 or later modules will have registered themselves
    // on the pending list.  Activate all of them now.  At present, only one
    // module per object is supported.
    node_module* mp = thread_local_modpending;
    thread_local_modpending = nullptr;

    if (!is_opened) {
      std::string errmsg = dlib->errmsg_.c_str();
      dlib->Close();
#ifdef _WIN32
      // Windows needs to add the filename into the error message
      errmsg += *filename;
#endif  // _WIN32
      THROW_ERR_DLOPEN_FAILED(env, errmsg.c_str());
      return false;
    }

    if (mp != nullptr) {
      if (mp->nm_context_register_func == nullptr) {
        if (env->force_context_aware()) {
          dlib->Close();
          THROW_ERR_NON_CONTEXT_AWARE_DISABLED(env);
          return false;
        }
      }
      mp->nm_dso_handle = dlib->handle_;
      dlib->SaveInGlobalHandleMap(mp);
    } else {
      if (auto callback = GetInitializerCallback(dlib)) {
        callback(exports, module, context);
        return true;
      } else if (auto napi_callback = GetNapiInitializerCallback(dlib)) {
        napi_module_register_by_symbol(exports, module, context, napi_callback);
        return true;
      } else {
        mp = dlib->GetSavedModuleFromGlobalHandleMap();
        if (mp == nullptr || mp->nm_context_register_func == nullptr) {
          dlib->Close();
          char errmsg[1024];
          snprintf(errmsg,
                   sizeof(errmsg),
                   "Module did not self-register: '%s'.",
                   *filename);
          THROW_ERR_DLOPEN_FAILED(env, errmsg);
          return false;
        }
      }
    }

    // -1 is used for N-API modules
    if ((mp->nm_version != -1) && (mp->nm_version != NODE_MODULE_VERSION)) {
      // Even if the module did self-register, it may have done so with the
      // wrong version. We must only give up after having checked to see if it
      // has an appropriate initializer callback.
      if (auto callback = GetInitializerCallback(dlib)) {
        callback(exports, module, context);
        return true;
      }
      char errmsg[1024];
      snprintf(errmsg,
               sizeof(errmsg),
               "The module '%s'"
               "\nwas compiled against a different Node.js version using"
               "\nNODE_MODULE_VERSION %d. This version of Node.js requires"
               "\nNODE_MODULE_VERSION %d. Please try re-compiling or "
               "re-installing\nthe module (for instance, using `npm rebuild` "
               "or `npm install`).",
               *filename,
               mp->nm_version,
               NODE_MODULE_VERSION);

      // NOTE: `mp` is allocated inside of the shared library's memory, calling
      // `dlclose` will deallocate it
      dlib->Close();
      THROW_ERR_DLOPEN_FAILED(env, errmsg);
      return false;
    }
    CHECK_EQ(mp->nm_flags & NM_F_BUILTIN, 0);

    // Do not keep the lock while running userland addon loading code.
    Mutex::ScopedUnlock unlock(lock);
    if (mp->nm_context_register_func != nullptr) {
      mp->nm_context_register_func(exports, module, context, mp->nm_priv);
    } else if (mp->nm_register_func != nullptr) {
      mp->nm_register_func(exports, module, mp->nm_priv);
    } else {
      dlib->Close();
      THROW_ERR_DLOPEN_FAILED(env, "Module has no declared entry point.");
      return false;
    }

    return true;
  });

  // Tell coverity that 'handle' should not be freed when we return.
  // coverity[leaked_storage]
}

inline struct node_module* FindModule(struct node_module* list,
                                      const char* name,
                                      int flag) {
  struct node_module* mp;

  for (mp = list; mp != nullptr; mp = mp->nm_link) {
    if (strcmp(mp->nm_modname, name) == 0) break;
  }

  CHECK(mp == nullptr || (mp->nm_flags & flag) != 0);
  return mp;
}

static Local<Object> InitModule(Environment* env,
                                node_module* mod,
                                Local<String> module) {
  // Internal bindings don't have a "module" object, only exports.
  Local<Function> ctor = env->binding_data_ctor_template()
                             ->GetFunction(env->context())
                             .ToLocalChecked();
  Local<Object> exports = ctor->NewInstance(env->context()).ToLocalChecked();
  CHECK_NULL(mod->nm_register_func);
  CHECK_NOT_NULL(mod->nm_context_register_func);
  Local<Value> unused = Undefined(env->isolate());
  mod->nm_context_register_func(exports, unused, env->context(), mod->nm_priv);
  return exports;
}

void GetInternalBinding(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  CHECK(args[0]->IsString());

  Local<String> module = args[0].As<String>();
  node::Utf8Value module_v(env->isolate(), module);
  Local<Object> exports;

  node_module* mod = FindModule(modlist_internal, *module_v, NM_F_INTERNAL);
  if (mod != nullptr) {
    exports = InitModule(env, mod, module);
    env->internal_bindings.insert(mod);
  } else if (!strcmp(*module_v, "constants")) {
    exports = Object::New(env->isolate());
    CHECK(
        exports->SetPrototype(env->context(), Null(env->isolate())).FromJust());
    DefineConstants(env->isolate(), exports);
  } else if (!strcmp(*module_v, "natives")) {
    exports = native_module::NativeModuleEnv::GetSourceObject(env->context());
    // Legacy feature: process.binding('natives').config contains stringified
    // config.gypi
    CHECK(exports
              ->Set(env->context(),
                    env->config_string(),
                    native_module::NativeModuleEnv::GetConfigString(
                        env->isolate()))
              .FromJust());
  } else {
    char errmsg[1024];
    snprintf(errmsg, sizeof(errmsg), "No such module: %s", *module_v);
    return THROW_ERR_INVALID_MODULE(env, errmsg);
  }

  args.GetReturnValue().Set(exports);
}

void GetLinkedBinding(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  CHECK(args[0]->IsString());

  Local<String> module_name = args[0].As<String>();

  node::Utf8Value module_name_v(env->isolate(), module_name);
  const char* name = *module_name_v;
  node_module* mod = nullptr;

  // Iterate from here to the nearest non-Worker Environment to see if there's
  // a linked binding defined locally rather than through the global list.
  Environment* cur_env = env;
  while (mod == nullptr && cur_env != nullptr) {
    Mutex::ScopedLock lock(cur_env->extra_linked_bindings_mutex());
    mod = FindModule(cur_env->extra_linked_bindings_head(), name, NM_F_LINKED);
    cur_env = cur_env->worker_parent_env();
  }

  if (mod == nullptr)
    mod = FindModule(modlist_linked, name, NM_F_LINKED);

  if (mod == nullptr) {
    char errmsg[1024];
    snprintf(errmsg,
             sizeof(errmsg),
             "No such module was linked: %s",
             *module_name_v);
    return THROW_ERR_INVALID_MODULE(env, errmsg);
  }

  Local<Object> module = Object::New(env->isolate());
  Local<Object> exports = Object::New(env->isolate());
  Local<String> exports_prop =
      String::NewFromUtf8Literal(env->isolate(), "exports");
  module->Set(env->context(), exports_prop, exports).Check();

  if (mod->nm_context_register_func != nullptr) {
    mod->nm_context_register_func(
        exports, module, env->context(), mod->nm_priv);
  } else if (mod->nm_register_func != nullptr) {
    mod->nm_register_func(exports, module, mod->nm_priv);
  } else {
    return THROW_ERR_INVALID_MODULE(
        env,
        "Linked moduled has no declared entry point.");
  }

  auto effective_exports =
      module->Get(env->context(), exports_prop).ToLocalChecked();

  args.GetReturnValue().Set(effective_exports);
}

// Call built-in modules' _register_<module name> function to
// do module registration explicitly.
void RegisterBuiltinModules() {
#define V(modname) _register_##modname();
  NODE_BUILTIN_MODULES(V)
#undef V
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(GetLinkedBinding);
  registry->Register(GetInternalBinding);
}

}  // namespace binding
}  // namespace node

NODE_MODULE_EXTERNAL_REFERENCE(binding,
                               node::binding::RegisterExternalReferences)
