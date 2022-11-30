#include "async_wrap-inl.h"
#include "env-inl.h"
#define NAPI_EXPERIMENTAL
#include "js_native_api_v8.h"
#include "memory_tracker-inl.h"
#include "node_api.h"
#include "node_api_internals.h"
#include "node_binding.h"
#include "node_buffer.h"
#include "node_errors.h"
#include "node_internals.h"
#include "node_process.h"
#include "node_url.h"
#include "threadpoolwork-inl.h"
#include "tracing/traced_value.h"
#include "util-inl.h"

#include <atomic>
#include <memory>

node_napi_env__::node_napi_env__(v8::Local<v8::Context> context,
                                 const std::string& module_filename)
    : napi_env__(context), filename(module_filename) {
  CHECK_NOT_NULL(node_env());
}

node_napi_env__::~node_napi_env__() {
  destructing = true;
  FinalizeAll();
}

bool node_napi_env__::can_call_into_js() const {
  return node_env()->can_call_into_js();
}

v8::Maybe<bool> node_napi_env__::mark_arraybuffer_as_untransferable(
    v8::Local<v8::ArrayBuffer> ab) const {
  return ab->SetPrivate(context(),
                        node_env()->untransferable_object_private_symbol(),
                        v8::True(isolate));
}

void node_napi_env__::CallFinalizer(napi_finalize cb, void* data, void* hint) {
  CallFinalizer<true>(cb, data, hint);
}

template <bool enforceUncaughtExceptionPolicy>
void node_napi_env__::CallFinalizer(napi_finalize cb, void* data, void* hint) {
  if (destructing) {
    // we can not defer finalizers when the environment is being destructed.
    v8::HandleScope handle_scope(isolate);
    v8::Context::Scope context_scope(context());
    CallbackIntoModule<enforceUncaughtExceptionPolicy>(
        [&](napi_env env) { cb(env, data, hint); });
    return;
  }
  // we need to keep the env live until the finalizer has been run
  // EnvRefHolder provides an exception safe wrapper to Ref and then
  // Unref once the lambda is freed
  EnvRefHolder liveEnv(static_cast<napi_env>(this));
  node_env()->SetImmediate(
      [=, liveEnv = std::move(liveEnv)](node::Environment* node_env) {
        node_napi_env__* env = static_cast<node_napi_env__*>(liveEnv.env());
        v8::HandleScope handle_scope(env->isolate);
        v8::Context::Scope context_scope(env->context());
        env->CallbackIntoModule<enforceUncaughtExceptionPolicy>(
            [&](napi_env env) { cb(env, data, hint); });
      });
}

void node_napi_env__::trigger_fatal_exception(v8::Local<v8::Value> local_err) {
  v8::Local<v8::Message> local_msg =
      v8::Exception::CreateMessage(isolate, local_err);
  node::errors::TriggerUncaughtException(isolate, local_err, local_msg);
}

// option enforceUncaughtExceptionPolicy is added for not breaking existing
// running n-api add-ons, and should be deprecated in the next major Node.js
// release.
template <bool enforceUncaughtExceptionPolicy, typename T>
void node_napi_env__::CallbackIntoModule(T&& call) {
  CallIntoModule(call, [](napi_env env_, v8::Local<v8::Value> local_err) {
    node_napi_env__* env = static_cast<node_napi_env__*>(env_);
    node::Environment* node_env = env->node_env();
    if (!node_env->options()->force_node_api_uncaught_exceptions_policy &&
        !enforceUncaughtExceptionPolicy) {
      ProcessEmitDeprecationWarning(
          node_env,
          "Uncaught N-API callback exception detected, please run node "
          "with option --force-node-api-uncaught-exceptions-policy=true"
          "to handle those exceptions properly.",
          "DEP0XXX");
      return;
    }
    // If there was an unhandled exception in the complete callback,
    // report it as a fatal exception. (There is no JavaScript on the
    // callstack that can possibly handle it.)
    env->trigger_fatal_exception(local_err);
  });
}

namespace v8impl {

namespace {

class BufferFinalizer : private Finalizer {
 public:
  // node::Buffer::FreeCallback
  static void FinalizeBufferCallback(char* data, void* hint) {
    std::unique_ptr<BufferFinalizer, Deleter> finalizer{
        static_cast<BufferFinalizer*>(hint)};
    finalizer->_finalize_data = data;

    if (finalizer->_finalize_callback == nullptr) return;
    finalizer->_env->CallFinalizer(finalizer->_finalize_callback,
                                   finalizer->_finalize_data,
                                   finalizer->_finalize_hint);
  }

  struct Deleter {
    void operator()(BufferFinalizer* finalizer) {
      Finalizer::Delete(finalizer);
    }
  };
};

static inline napi_env NewEnv(v8::Local<v8::Context> context,
                              const std::string& module_filename) {
  node_napi_env result;

  result = new node_napi_env__(context, module_filename);
  // TODO(addaleax): There was previously code that tried to delete the
  // napi_env when its v8::Context was garbage collected;
  // However, as long as N-API addons using this napi_env are in place,
  // the Context needs to be accessible and alive.
  // Ideally, we'd want an on-addon-unload hook that takes care of this
  // once all N-API addons using this napi_env are unloaded.
  // For now, a per-Environment cleanup hook is the best we can do.
  result->node_env()->AddCleanupHook(
      [](void* arg) { static_cast<napi_env>(arg)->Unref(); },
      static_cast<void*>(result));

  return result;
}

class ThreadSafeFunction : public node::AsyncResource {
 public:
  ThreadSafeFunction(v8::Local<v8::Function> func,
                     v8::Local<v8::Object> resource,
                     v8::Local<v8::String> name,
                     size_t thread_count_,
                     void* context_,
                     size_t max_queue_size_,
                     node_napi_env env_,
                     void* finalize_data_,
                     napi_finalize finalize_cb_,
                     napi_threadsafe_function_call_js call_js_cb_)
      : AsyncResource(env_->isolate,
                      resource,
                      *v8::String::Utf8Value(env_->isolate, name)),
        thread_count(thread_count_),
        is_closing(false),
        dispatch_state(kDispatchIdle),
        context(context_),
        max_queue_size(max_queue_size_),
        env(env_),
        finalize_data(finalize_data_),
        finalize_cb(finalize_cb_),
        call_js_cb(call_js_cb_ == nullptr ? CallJs : call_js_cb_),
        handles_closing(false) {
    ref.Reset(env->isolate, func);
    node::AddEnvironmentCleanupHook(env->isolate, Cleanup, this);
    env->Ref();
  }

  ~ThreadSafeFunction() override {
    node::RemoveEnvironmentCleanupHook(env->isolate, Cleanup, this);
    env->Unref();
  }

  // These methods can be called from any thread.

  napi_status Push(void* data, napi_threadsafe_function_call_mode mode) {
    node::Mutex::ScopedLock lock(this->mutex);

    while (queue.size() >= max_queue_size && max_queue_size > 0 &&
           !is_closing) {
      if (mode == napi_tsfn_nonblocking) {
        return napi_queue_full;
      }
      cond->Wait(lock);
    }

    if (is_closing) {
      if (thread_count == 0) {
        return napi_invalid_arg;
      } else {
        thread_count--;
        return napi_closing;
      }
    } else {
      queue.push(data);
      Send();
      return napi_ok;
    }
  }

  napi_status Acquire() {
    node::Mutex::ScopedLock lock(this->mutex);

    if (is_closing) {
      return napi_closing;
    }

    thread_count++;

    return napi_ok;
  }

  napi_status Release(napi_threadsafe_function_release_mode mode) {
    node::Mutex::ScopedLock lock(this->mutex);

    if (thread_count == 0) {
      return napi_invalid_arg;
    }

    thread_count--;

    if (thread_count == 0 || mode == napi_tsfn_abort) {
      if (!is_closing) {
        is_closing = (mode == napi_tsfn_abort);
        if (is_closing && max_queue_size > 0) {
          cond->Signal(lock);
        }
        Send();
      }
    }

    return napi_ok;
  }

  void EmptyQueueAndDelete() {
    for (; !queue.empty(); queue.pop()) {
      call_js_cb(nullptr, nullptr, context, queue.front());
    }
    delete this;
  }

  // These methods must only be called from the loop thread.

  napi_status Init() {
    ThreadSafeFunction* ts_fn = this;
    uv_loop_t* loop = env->node_env()->event_loop();

    if (uv_async_init(loop, &async, AsyncCb) == 0) {
      if (max_queue_size > 0) {
        cond = std::make_unique<node::ConditionVariable>();
      }
      if (max_queue_size == 0 || cond) {
        return napi_ok;
      }

      env->node_env()->CloseHandle(
          reinterpret_cast<uv_handle_t*>(&async),
          [](uv_handle_t* handle) -> void {
            ThreadSafeFunction* ts_fn =
                node::ContainerOf(&ThreadSafeFunction::async,
                                  reinterpret_cast<uv_async_t*>(handle));
            delete ts_fn;
          });

      // Prevent the thread-safe function from being deleted here, because
      // the callback above will delete it.
      ts_fn = nullptr;
    }

    delete ts_fn;

    return napi_generic_failure;
  }

  napi_status Unref() {
    uv_unref(reinterpret_cast<uv_handle_t*>(&async));

    return napi_ok;
  }

  napi_status Ref() {
    uv_ref(reinterpret_cast<uv_handle_t*>(&async));

    return napi_ok;
  }

  inline void* Context() { return context; }

 protected:
  void Dispatch() {
    bool has_more = true;

    // Limit maximum synchronous iteration count to prevent event loop
    // starvation. See `src/node_messaging.cc` for an inspiration.
    unsigned int iterations_left = kMaxIterationCount;
    while (has_more && --iterations_left != 0) {
      dispatch_state = kDispatchRunning;
      has_more = DispatchOne();

      // Send() was called while we were executing the JS function
      if (dispatch_state.exchange(kDispatchIdle) != kDispatchRunning) {
        has_more = true;
      }
    }

    if (has_more) {
      Send();
    }
  }

  bool DispatchOne() {
    void* data = nullptr;
    bool popped_value = false;
    bool has_more = false;

    {
      node::Mutex::ScopedLock lock(this->mutex);
      if (is_closing) {
        CloseHandlesAndMaybeDelete();
      } else {
        size_t size = queue.size();
        if (size > 0) {
          data = queue.front();
          queue.pop();
          popped_value = true;
          if (size == max_queue_size && max_queue_size > 0) {
            cond->Signal(lock);
          }
          size--;
        }

        if (size == 0) {
          if (thread_count == 0) {
            is_closing = true;
            if (max_queue_size > 0) {
              cond->Signal(lock);
            }
            CloseHandlesAndMaybeDelete();
          }
        } else {
          has_more = true;
        }
      }
    }

    if (popped_value) {
      v8::HandleScope scope(env->isolate);
      CallbackScope cb_scope(this);
      napi_value js_callback = nullptr;
      if (!ref.IsEmpty()) {
        v8::Local<v8::Function> js_cb =
            v8::Local<v8::Function>::New(env->isolate, ref);
        js_callback = v8impl::JsValueFromV8LocalValue(js_cb);
      }
      env->CallbackIntoModule<false>(
          [&](napi_env env) { call_js_cb(env, js_callback, context, data); });
    }

    return has_more;
  }

  void Finalize() {
    v8::HandleScope scope(env->isolate);
    if (finalize_cb) {
      CallbackScope cb_scope(this);
      // Do not use CallFinalizer since it will defer the invocation, which
      // would lead to accessing a deleted ThreadSafeFunction.
      env->CallbackIntoModule<false>(
          [&](napi_env env) { finalize_cb(env, finalize_data, context); });
    }
    EmptyQueueAndDelete();
  }

  void CloseHandlesAndMaybeDelete(bool set_closing = false) {
    v8::HandleScope scope(env->isolate);
    if (set_closing) {
      node::Mutex::ScopedLock lock(this->mutex);
      is_closing = true;
      if (max_queue_size > 0) {
        cond->Signal(lock);
      }
    }
    if (handles_closing) {
      return;
    }
    handles_closing = true;
    env->node_env()->CloseHandle(
        reinterpret_cast<uv_handle_t*>(&async),
        [](uv_handle_t* handle) -> void {
          ThreadSafeFunction* ts_fn =
              node::ContainerOf(&ThreadSafeFunction::async,
                                reinterpret_cast<uv_async_t*>(handle));
          ts_fn->Finalize();
        });
  }

  void Send() {
    // Ask currently running Dispatch() to make one more iteration
    unsigned char current_state = dispatch_state.fetch_or(kDispatchPending);
    if ((current_state & kDispatchRunning) == kDispatchRunning) {
      return;
    }

    CHECK_EQ(0, uv_async_send(&async));
  }

  // Default way of calling into JavaScript. Used when ThreadSafeFunction is
  //  without a call_js_cb_.
  static void CallJs(napi_env env, napi_value cb, void* context, void* data) {
    if (!(env == nullptr || cb == nullptr)) {
      napi_value recv;
      napi_status status;

      status = napi_get_undefined(env, &recv);
      if (status != napi_ok) {
        napi_throw_error(env,
                         "ERR_NAPI_TSFN_GET_UNDEFINED",
                         "Failed to retrieve undefined value");
        return;
      }

      status = napi_call_function(env, recv, cb, 0, nullptr, nullptr);
      if (status != napi_ok && status != napi_pending_exception) {
        napi_throw_error(
            env, "ERR_NAPI_TSFN_CALL_JS", "Failed to call JS callback");
        return;
      }
    }
  }

  static void AsyncCb(uv_async_t* async) {
    ThreadSafeFunction* ts_fn =
        node::ContainerOf(&ThreadSafeFunction::async, async);
    ts_fn->Dispatch();
  }

  static void Cleanup(void* data) {
    reinterpret_cast<ThreadSafeFunction*>(data)->CloseHandlesAndMaybeDelete(
        true);
  }

 private:
  static const unsigned char kDispatchIdle = 0;
  static const unsigned char kDispatchRunning = 1 << 0;
  static const unsigned char kDispatchPending = 1 << 1;

  static const unsigned int kMaxIterationCount = 1000;

  // These are variables protected by the mutex.
  node::Mutex mutex;
  std::unique_ptr<node::ConditionVariable> cond;
  std::queue<void*> queue;
  uv_async_t async;
  size_t thread_count;
  bool is_closing;
  std::atomic_uchar dispatch_state;

  // These are variables set once, upon creation, and then never again, which
  // means we don't need the mutex to read them.
  void* context;
  size_t max_queue_size;

  // These are variables accessed only from the loop thread.
  v8impl::Persistent<v8::Function> ref;
  node_napi_env env;
  void* finalize_data;
  napi_finalize finalize_cb;
  napi_threadsafe_function_call_js call_js_cb;
  bool handles_closing;
};

/**
 * Compared to node::AsyncResource, the resource object in AsyncContext is
 * gc-able. AsyncContext holds a weak reference to the resource object.
 * AsyncContext::MakeCallback doesn't implicitly set the receiver of the
 * callback to the resource object.
 */
class AsyncContext {
 public:
  AsyncContext(node_napi_env env,
               v8::Local<v8::Object> resource_object,
               const v8::Local<v8::String> resource_name,
               bool externally_managed_resource)
      : env_(env) {
    async_id_ = node_env()->new_async_id();
    trigger_async_id_ = node_env()->get_default_trigger_async_id();
    resource_.Reset(node_env()->isolate(), resource_object);
    lost_reference_ = false;
    if (externally_managed_resource) {
      resource_.SetWeak(
          this, AsyncContext::WeakCallback, v8::WeakCallbackType::kParameter);
    }

    node::AsyncWrap::EmitAsyncInit(node_env(),
                                   resource_object,
                                   resource_name,
                                   async_id_,
                                   trigger_async_id_);
  }

  ~AsyncContext() {
    resource_.Reset();
    lost_reference_ = true;
    node::AsyncWrap::EmitDestroy(node_env(), async_id_);
  }

  inline v8::MaybeLocal<v8::Value> MakeCallback(
      v8::Local<v8::Object> recv,
      const v8::Local<v8::Function> callback,
      int argc,
      v8::Local<v8::Value> argv[]) {
    EnsureReference();
    return node::InternalMakeCallback(node_env(),
                                      resource(),
                                      recv,
                                      callback,
                                      argc,
                                      argv,
                                      {async_id_, trigger_async_id_});
  }

  inline napi_callback_scope OpenCallbackScope() {
    EnsureReference();
    napi_callback_scope it =
        reinterpret_cast<napi_callback_scope>(new CallbackScope(this));
    env_->open_callback_scopes++;
    return it;
  }

  inline void EnsureReference() {
    if (lost_reference_) {
      const v8::HandleScope handle_scope(node_env()->isolate());
      resource_.Reset(node_env()->isolate(),
                      v8::Object::New(node_env()->isolate()));
      lost_reference_ = false;
    }
  }

  inline node::Environment* node_env() { return env_->node_env(); }
  inline v8::Local<v8::Object> resource() {
    return resource_.Get(node_env()->isolate());
  }
  inline node::async_context async_context() {
    return {async_id_, trigger_async_id_};
  }

  static inline void CloseCallbackScope(node_napi_env env,
                                        napi_callback_scope s) {
    CallbackScope* callback_scope = reinterpret_cast<CallbackScope*>(s);
    delete callback_scope;
    env->open_callback_scopes--;
  }

  static void WeakCallback(const v8::WeakCallbackInfo<AsyncContext>& data) {
    AsyncContext* async_context = data.GetParameter();
    async_context->resource_.Reset();
    async_context->lost_reference_ = true;
  }

 private:
  class CallbackScope : public node::CallbackScope {
   public:
    explicit CallbackScope(AsyncContext* async_context)
        : node::CallbackScope(async_context->node_env(),
                              async_context->resource_.Get(
                                  async_context->node_env()->isolate()),
                              async_context->async_context()) {}
  };

  node_napi_env env_;
  double async_id_;
  double trigger_async_id_;
  v8::Global<v8::Object> resource_;
  bool lost_reference_;
};

}  // end of anonymous namespace

}  // end of namespace v8impl

// Intercepts the Node-V8 module registration callback. Converts parameters
// to NAPI equivalents and then calls the registration callback specified
// by the NAPI module.
static void napi_module_register_cb(v8::Local<v8::Object> exports,
                                    v8::Local<v8::Value> module,
                                    v8::Local<v8::Context> context,
                                    void* priv) {
  napi_module_register_by_symbol(
      exports,
      module,
      context,
      static_cast<const napi_module*>(priv)->nm_register_func);
}

void napi_module_register_by_symbol(v8::Local<v8::Object> exports,
                                    v8::Local<v8::Value> module,
                                    v8::Local<v8::Context> context,
                                    napi_addon_register_func init) {
  node::Environment* node_env = node::Environment::GetCurrent(context);
  std::string module_filename = "";
  if (init == nullptr) {
    CHECK_NOT_NULL(node_env);
    node_env->ThrowError("Module has no declared entry point.");
    return;
  }

  // We set `env->filename` from `module.filename` here, but we could just as
  // easily add a private property to `exports` in `process.dlopen`, which
  // receives the file name from JS, and retrieve *that* here. Thus, we are not
  // endorsing commonjs here by making use of `module.filename`.
  v8::Local<v8::Value> filename_js;
  v8::Local<v8::Object> modobj;
  if (module->ToObject(context).ToLocal(&modobj) &&
      modobj->Get(context, node_env->filename_string()).ToLocal(&filename_js) &&
      filename_js->IsString()) {
    node::Utf8Value filename(node_env->isolate(), filename_js);

    // Turn the absolute path into a URL. Currently the absolute path is always
    // a file system path.
    // TODO(gabrielschulhof): Pass the `filename` through unchanged if/when we
    // receive it as a URL already.
    module_filename = node::url::URL::FromFilePath(filename.ToString()).href();
  }

  // Create a new napi_env for this specific module.
  napi_env env = v8impl::NewEnv(context, module_filename);

  napi_value _exports;
  env->CallIntoModule([&](napi_env env) {
    _exports = init(env, v8impl::JsValueFromV8LocalValue(exports));
  });

  // If register function returned a non-null exports object different from
  // the exports object we passed it, set that as the "exports" property of
  // the module.
  if (_exports != nullptr &&
      _exports != v8impl::JsValueFromV8LocalValue(exports)) {
    napi_value _module = v8impl::JsValueFromV8LocalValue(module);
    napi_set_named_property(env, _module, "exports", _exports);
  }
}

namespace node {
node_module napi_module_to_node_module(const napi_module* mod) {
  return {
      -1,
      mod->nm_flags | NM_F_DELETEME,
      nullptr,
      mod->nm_filename,
      nullptr,
      napi_module_register_cb,
      mod->nm_modname,
      const_cast<napi_module*>(mod),  // priv
      nullptr,
  };
}
}  // namespace node

// Registers a NAPI module.
void NAPI_CDECL napi_module_register(napi_module* mod) {
  node::node_module* nm =
      new node::node_module(node::napi_module_to_node_module(mod));
  node::node_module_register(nm);
}

napi_status NAPI_CDECL napi_add_env_cleanup_hook(
    napi_env env, void(NAPI_CDECL* fun)(void* arg), void* arg) {
  CHECK_ENV(env);
  CHECK_ARG(env, fun);

  node::AddEnvironmentCleanupHook(env->isolate, fun, arg);

  return napi_ok;
}

napi_status NAPI_CDECL napi_remove_env_cleanup_hook(
    napi_env env, void(NAPI_CDECL* fun)(void* arg), void* arg) {
  CHECK_ENV(env);
  CHECK_ARG(env, fun);

  node::RemoveEnvironmentCleanupHook(env->isolate, fun, arg);

  return napi_ok;
}

struct napi_async_cleanup_hook_handle__ {
  napi_async_cleanup_hook_handle__(napi_env env,
                                   napi_async_cleanup_hook user_hook,
                                   void* user_data)
      : env_(env), user_hook_(user_hook), user_data_(user_data) {
    handle_ = node::AddEnvironmentCleanupHook(env->isolate, Hook, this);
    env->Ref();
  }

  ~napi_async_cleanup_hook_handle__() {
    node::RemoveEnvironmentCleanupHook(std::move(handle_));
    if (done_cb_ != nullptr) done_cb_(done_data_);

    // Release the `env` handle asynchronously since it would be surprising if
    // a call to a N-API function would destroy `env` synchronously.
    static_cast<node_napi_env>(env_)->node_env()->SetImmediate(
        [env = env_](node::Environment*) { env->Unref(); });
  }

  static void Hook(void* data, void (*done_cb)(void*), void* done_data) {
    napi_async_cleanup_hook_handle__* handle =
        static_cast<napi_async_cleanup_hook_handle__*>(data);
    handle->done_cb_ = done_cb;
    handle->done_data_ = done_data;
    handle->user_hook_(handle, handle->user_data_);
  }

  node::AsyncCleanupHookHandle handle_;
  napi_env env_ = nullptr;
  napi_async_cleanup_hook user_hook_ = nullptr;
  void* user_data_ = nullptr;
  void (*done_cb_)(void*) = nullptr;
  void* done_data_ = nullptr;
};

napi_status NAPI_CDECL
napi_add_async_cleanup_hook(napi_env env,
                            napi_async_cleanup_hook hook,
                            void* arg,
                            napi_async_cleanup_hook_handle* remove_handle) {
  CHECK_ENV(env);
  CHECK_ARG(env, hook);

  napi_async_cleanup_hook_handle__* handle =
      new napi_async_cleanup_hook_handle__(env, hook, arg);

  if (remove_handle != nullptr) *remove_handle = handle;

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL
napi_remove_async_cleanup_hook(napi_async_cleanup_hook_handle remove_handle) {
  if (remove_handle == nullptr) return napi_invalid_arg;

  delete remove_handle;

  return napi_ok;
}

napi_status NAPI_CDECL napi_fatal_exception(napi_env env, napi_value err) {
  NAPI_PREAMBLE(env);
  CHECK_ARG(env, err);

  v8::Local<v8::Value> local_err = v8impl::V8LocalValueFromJsValue(err);
  static_cast<node_napi_env>(env)->trigger_fatal_exception(local_err);

  return napi_clear_last_error(env);
}

NAPI_NO_RETURN void NAPI_CDECL napi_fatal_error(const char* location,
                                                size_t location_len,
                                                const char* message,
                                                size_t message_len) {
  std::string location_string;
  std::string message_string;

  if (location_len != NAPI_AUTO_LENGTH) {
    location_string.assign(const_cast<char*>(location), location_len);
  } else {
    location_string.assign(const_cast<char*>(location), strlen(location));
  }

  if (message_len != NAPI_AUTO_LENGTH) {
    message_string.assign(const_cast<char*>(message), message_len);
  } else {
    message_string.assign(const_cast<char*>(message), strlen(message));
  }

  node::FatalError(location_string.c_str(), message_string.c_str());
}

napi_status NAPI_CDECL
napi_open_callback_scope(napi_env env,
                         napi_value /** ignored */,
                         napi_async_context async_context_handle,
                         napi_callback_scope* result) {
  // Omit NAPI_PREAMBLE and GET_RETURN_STATUS because V8 calls here cannot throw
  // JS exceptions.
  CHECK_ENV(env);
  CHECK_ARG(env, result);

  v8impl::AsyncContext* node_async_context =
      reinterpret_cast<v8impl::AsyncContext*>(async_context_handle);

  *result = node_async_context->OpenCallbackScope();

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_close_callback_scope(napi_env env,
                                                 napi_callback_scope scope) {
  // Omit NAPI_PREAMBLE and GET_RETURN_STATUS because V8 calls here cannot throw
  // JS exceptions.
  CHECK_ENV(env);
  CHECK_ARG(env, scope);
  if (env->open_callback_scopes == 0) {
    return napi_callback_scope_mismatch;
  }

  v8impl::AsyncContext::CloseCallbackScope(reinterpret_cast<node_napi_env>(env),
                                           scope);

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_async_init(napi_env env,
                                       napi_value async_resource,
                                       napi_value async_resource_name,
                                       napi_async_context* result) {
  CHECK_ENV(env);
  CHECK_ARG(env, async_resource_name);
  CHECK_ARG(env, result);

  v8::Isolate* isolate = env->isolate;
  v8::Local<v8::Context> context = env->context();

  v8::Local<v8::Object> v8_resource;
  bool externally_managed_resource;
  if (async_resource != nullptr) {
    CHECK_TO_OBJECT(env, context, v8_resource, async_resource);
    externally_managed_resource = true;
  } else {
    v8_resource = v8::Object::New(isolate);
    externally_managed_resource = false;
  }

  v8::Local<v8::String> v8_resource_name;
  CHECK_TO_STRING(env, context, v8_resource_name, async_resource_name);

  v8impl::AsyncContext* async_context =
      new v8impl::AsyncContext(reinterpret_cast<node_napi_env>(env),
                               v8_resource,
                               v8_resource_name,
                               externally_managed_resource);

  *result = reinterpret_cast<napi_async_context>(async_context);

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_async_destroy(napi_env env,
                                          napi_async_context async_context) {
  CHECK_ENV(env);
  CHECK_ARG(env, async_context);

  v8impl::AsyncContext* node_async_context =
      reinterpret_cast<v8impl::AsyncContext*>(async_context);

  delete node_async_context;

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_make_callback(napi_env env,
                                          napi_async_context async_context,
                                          napi_value recv,
                                          napi_value func,
                                          size_t argc,
                                          const napi_value* argv,
                                          napi_value* result) {
  NAPI_PREAMBLE(env);
  CHECK_ARG(env, recv);
  if (argc > 0) {
    CHECK_ARG(env, argv);
  }

  v8::Local<v8::Context> context = env->context();

  v8::Local<v8::Object> v8recv;
  CHECK_TO_OBJECT(env, context, v8recv, recv);

  v8::Local<v8::Function> v8func;
  CHECK_TO_FUNCTION(env, v8func, func);

  v8::MaybeLocal<v8::Value> callback_result;

  if (async_context == nullptr) {
    callback_result = node::MakeCallback(
        env->isolate,
        v8recv,
        v8func,
        argc,
        reinterpret_cast<v8::Local<v8::Value>*>(const_cast<napi_value*>(argv)),
        {0, 0});
  } else {
    v8impl::AsyncContext* node_async_context =
        reinterpret_cast<v8impl::AsyncContext*>(async_context);
    callback_result = node_async_context->MakeCallback(
        v8recv,
        v8func,
        argc,
        reinterpret_cast<v8::Local<v8::Value>*>(const_cast<napi_value*>(argv)));
  }

  if (try_catch.HasCaught()) {
    return napi_set_last_error(env, napi_pending_exception);
  } else {
    CHECK_MAYBE_EMPTY(env, callback_result, napi_generic_failure);
    if (result != nullptr) {
      *result =
          v8impl::JsValueFromV8LocalValue(callback_result.ToLocalChecked());
    }
  }

  return GET_RETURN_STATUS(env);
}

napi_status NAPI_CDECL napi_create_buffer(napi_env env,
                                          size_t length,
                                          void** data,
                                          napi_value* result) {
  NAPI_PREAMBLE(env);
  CHECK_ARG(env, result);

  v8::MaybeLocal<v8::Object> maybe = node::Buffer::New(env->isolate, length);

  CHECK_MAYBE_EMPTY(env, maybe, napi_generic_failure);

  v8::Local<v8::Object> buffer = maybe.ToLocalChecked();

  *result = v8impl::JsValueFromV8LocalValue(buffer);

  if (data != nullptr) {
    *data = node::Buffer::Data(buffer);
  }

  return GET_RETURN_STATUS(env);
}

napi_status NAPI_CDECL napi_create_external_buffer(napi_env env,
                                                   size_t length,
                                                   void* data,
                                                   napi_finalize finalize_cb,
                                                   void* finalize_hint,
                                                   napi_value* result) {
  NAPI_PREAMBLE(env);
  CHECK_ARG(env, result);

  v8::Isolate* isolate = env->isolate;

  // The finalizer object will delete itself after invoking the callback.
  v8impl::Finalizer* finalizer =
      v8impl::Finalizer::New(env,
                             finalize_cb,
                             nullptr,
                             finalize_hint,
                             v8impl::Finalizer::kKeepEnvReference);

  v8::MaybeLocal<v8::Object> maybe =
      node::Buffer::New(isolate,
                        static_cast<char*>(data),
                        length,
                        v8impl::BufferFinalizer::FinalizeBufferCallback,
                        finalizer);

  CHECK_MAYBE_EMPTY(env, maybe, napi_generic_failure);

  *result = v8impl::JsValueFromV8LocalValue(maybe.ToLocalChecked());
  return GET_RETURN_STATUS(env);
  // Tell coverity that 'finalizer' should not be freed when we return
  // as it will be deleted when the buffer to which it is associated
  // is finalized.
  // coverity[leaked_storage]
}

napi_status NAPI_CDECL napi_create_buffer_copy(napi_env env,
                                               size_t length,
                                               const void* data,
                                               void** result_data,
                                               napi_value* result) {
  NAPI_PREAMBLE(env);
  CHECK_ARG(env, result);

  v8::MaybeLocal<v8::Object> maybe =
      node::Buffer::Copy(env->isolate, static_cast<const char*>(data), length);

  CHECK_MAYBE_EMPTY(env, maybe, napi_generic_failure);

  v8::Local<v8::Object> buffer = maybe.ToLocalChecked();
  *result = v8impl::JsValueFromV8LocalValue(buffer);

  if (result_data != nullptr) {
    *result_data = node::Buffer::Data(buffer);
  }

  return GET_RETURN_STATUS(env);
}

napi_status NAPI_CDECL napi_is_buffer(napi_env env,
                                      napi_value value,
                                      bool* result) {
  CHECK_ENV(env);
  CHECK_ARG(env, value);
  CHECK_ARG(env, result);

  *result = node::Buffer::HasInstance(v8impl::V8LocalValueFromJsValue(value));
  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_buffer_info(napi_env env,
                                            napi_value value,
                                            void** data,
                                            size_t* length) {
  CHECK_ENV(env);
  CHECK_ARG(env, value);

  v8::Local<v8::Value> buffer = v8impl::V8LocalValueFromJsValue(value);

  if (data != nullptr) {
    *data = node::Buffer::Data(buffer);
  }
  if (length != nullptr) {
    *length = node::Buffer::Length(buffer);
  }

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_node_version(napi_env env,
                                             const napi_node_version** result) {
  CHECK_ENV(env);
  CHECK_ARG(env, result);
  static const napi_node_version version = {
      NODE_MAJOR_VERSION, NODE_MINOR_VERSION, NODE_PATCH_VERSION, NODE_RELEASE};
  *result = &version;
  return napi_clear_last_error(env);
}

namespace {
namespace uvimpl {

static napi_status ConvertUVErrorCode(int code) {
  switch (code) {
    case 0:
      return napi_ok;
    case UV_EINVAL:
      return napi_invalid_arg;
    case UV_ECANCELED:
      return napi_cancelled;
    default:
      return napi_generic_failure;
  }
}

// Wrapper around uv_work_t which calls user-provided callbacks.
class Work : public node::AsyncResource, public node::ThreadPoolWork {
 private:
  explicit Work(node_napi_env env,
                v8::Local<v8::Object> async_resource,
                v8::Local<v8::String> async_resource_name,
                napi_async_execute_callback execute,
                napi_async_complete_callback complete = nullptr,
                void* data = nullptr)
      : AsyncResource(
            env->isolate,
            async_resource,
            *v8::String::Utf8Value(env->isolate, async_resource_name)),
        ThreadPoolWork(env->node_env()),
        _env(env),
        _data(data),
        _execute(execute),
        _complete(complete) {}

  ~Work() override = default;

 public:
  static Work* New(node_napi_env env,
                   v8::Local<v8::Object> async_resource,
                   v8::Local<v8::String> async_resource_name,
                   napi_async_execute_callback execute,
                   napi_async_complete_callback complete,
                   void* data) {
    return new Work(
        env, async_resource, async_resource_name, execute, complete, data);
  }

  static void Delete(Work* work) { delete work; }

  void DoThreadPoolWork() override { _execute(_env, _data); }

  void AfterThreadPoolWork(int status) override {
    if (_complete == nullptr) return;

    // Establish a handle scope here so that every callback doesn't have to.
    // Also it is needed for the exception-handling below.
    v8::HandleScope scope(_env->isolate);

    CallbackScope callback_scope(this);

    _env->CallbackIntoModule<true>([&](napi_env env) {
      _complete(env, ConvertUVErrorCode(status), _data);
    });

    // Note: Don't access `work` after this point because it was
    // likely deleted by the complete callback.
  }

 private:
  node_napi_env _env;
  void* _data;
  napi_async_execute_callback _execute;
  napi_async_complete_callback _complete;
};

}  // end of namespace uvimpl
}  // end of anonymous namespace

#define CALL_UV(env, condition)                                                \
  do {                                                                         \
    int result = (condition);                                                  \
    napi_status status = uvimpl::ConvertUVErrorCode(result);                   \
    if (status != napi_ok) {                                                   \
      return napi_set_last_error(env, status, result);                         \
    }                                                                          \
  } while (0)

napi_status NAPI_CDECL
napi_create_async_work(napi_env env,
                       napi_value async_resource,
                       napi_value async_resource_name,
                       napi_async_execute_callback execute,
                       napi_async_complete_callback complete,
                       void* data,
                       napi_async_work* result) {
  CHECK_ENV(env);
  CHECK_ARG(env, execute);
  CHECK_ARG(env, result);

  v8::Local<v8::Context> context = env->context();

  v8::Local<v8::Object> resource;
  if (async_resource != nullptr) {
    CHECK_TO_OBJECT(env, context, resource, async_resource);
  } else {
    resource = v8::Object::New(env->isolate);
  }

  v8::Local<v8::String> resource_name;
  CHECK_TO_STRING(env, context, resource_name, async_resource_name);

  uvimpl::Work* work = uvimpl::Work::New(reinterpret_cast<node_napi_env>(env),
                                         resource,
                                         resource_name,
                                         execute,
                                         complete,
                                         data);

  *result = reinterpret_cast<napi_async_work>(work);

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_delete_async_work(napi_env env,
                                              napi_async_work work) {
  CHECK_ENV(env);
  CHECK_ARG(env, work);

  uvimpl::Work::Delete(reinterpret_cast<uvimpl::Work*>(work));

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_uv_event_loop(napi_env env, uv_loop_t** loop) {
  CHECK_ENV(env);
  CHECK_ARG(env, loop);
  *loop = reinterpret_cast<node_napi_env>(env)->node_env()->event_loop();
  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_queue_async_work(napi_env env,
                                             napi_async_work work) {
  CHECK_ENV(env);
  CHECK_ARG(env, work);

  uv_loop_t* event_loop = nullptr;
  STATUS_CALL(napi_get_uv_event_loop(env, &event_loop));

  uvimpl::Work* w = reinterpret_cast<uvimpl::Work*>(work);

  w->ScheduleWork();

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_cancel_async_work(napi_env env,
                                              napi_async_work work) {
  CHECK_ENV(env);
  CHECK_ARG(env, work);

  uvimpl::Work* w = reinterpret_cast<uvimpl::Work*>(work);

  CALL_UV(env, w->CancelWork());

  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL
napi_create_threadsafe_function(napi_env env,
                                napi_value func,
                                napi_value async_resource,
                                napi_value async_resource_name,
                                size_t max_queue_size,
                                size_t initial_thread_count,
                                void* thread_finalize_data,
                                napi_finalize thread_finalize_cb,
                                void* context,
                                napi_threadsafe_function_call_js call_js_cb,
                                napi_threadsafe_function* result) {
  CHECK_ENV(env);
  CHECK_ARG(env, async_resource_name);
  RETURN_STATUS_IF_FALSE(env, initial_thread_count > 0, napi_invalid_arg);
  CHECK_ARG(env, result);

  napi_status status = napi_ok;

  v8::Local<v8::Function> v8_func;
  if (func == nullptr) {
    CHECK_ARG(env, call_js_cb);
  } else {
    CHECK_TO_FUNCTION(env, v8_func, func);
  }

  v8::Local<v8::Context> v8_context = env->context();

  v8::Local<v8::Object> v8_resource;
  if (async_resource == nullptr) {
    v8_resource = v8::Object::New(env->isolate);
  } else {
    CHECK_TO_OBJECT(env, v8_context, v8_resource, async_resource);
  }

  v8::Local<v8::String> v8_name;
  CHECK_TO_STRING(env, v8_context, v8_name, async_resource_name);

  v8impl::ThreadSafeFunction* ts_fn =
      new v8impl::ThreadSafeFunction(v8_func,
                                     v8_resource,
                                     v8_name,
                                     initial_thread_count,
                                     context,
                                     max_queue_size,
                                     reinterpret_cast<node_napi_env>(env),
                                     thread_finalize_data,
                                     thread_finalize_cb,
                                     call_js_cb);

  if (ts_fn == nullptr) {
    status = napi_generic_failure;
  } else {
    // Init deletes ts_fn upon failure.
    status = ts_fn->Init();
    if (status == napi_ok) {
      *result = reinterpret_cast<napi_threadsafe_function>(ts_fn);
    }
  }

  return napi_set_last_error(env, status);
}

napi_status NAPI_CDECL napi_get_threadsafe_function_context(
    napi_threadsafe_function func, void** result) {
  CHECK_NOT_NULL(func);
  CHECK_NOT_NULL(result);

  *result = reinterpret_cast<v8impl::ThreadSafeFunction*>(func)->Context();
  return napi_ok;
}

napi_status NAPI_CDECL
napi_call_threadsafe_function(napi_threadsafe_function func,
                              void* data,
                              napi_threadsafe_function_call_mode is_blocking) {
  CHECK_NOT_NULL(func);
  return reinterpret_cast<v8impl::ThreadSafeFunction*>(func)->Push(data,
                                                                   is_blocking);
}

napi_status NAPI_CDECL
napi_acquire_threadsafe_function(napi_threadsafe_function func) {
  CHECK_NOT_NULL(func);
  return reinterpret_cast<v8impl::ThreadSafeFunction*>(func)->Acquire();
}

napi_status NAPI_CDECL napi_release_threadsafe_function(
    napi_threadsafe_function func, napi_threadsafe_function_release_mode mode) {
  CHECK_NOT_NULL(func);
  return reinterpret_cast<v8impl::ThreadSafeFunction*>(func)->Release(mode);
}

napi_status NAPI_CDECL
napi_unref_threadsafe_function(napi_env env, napi_threadsafe_function func) {
  CHECK_NOT_NULL(func);
  return reinterpret_cast<v8impl::ThreadSafeFunction*>(func)->Unref();
}

napi_status NAPI_CDECL
napi_ref_threadsafe_function(napi_env env, napi_threadsafe_function func) {
  CHECK_NOT_NULL(func);
  return reinterpret_cast<v8impl::ThreadSafeFunction*>(func)->Ref();
}

napi_status NAPI_CDECL node_api_get_module_file_name(napi_env env,
                                                     const char** result) {
  CHECK_ENV(env);
  CHECK_ARG(env, result);

  *result = static_cast<node_napi_env>(env)->GetFilename();
  return napi_clear_last_error(env);
}
