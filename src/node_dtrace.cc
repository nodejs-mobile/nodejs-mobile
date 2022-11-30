// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

#include "node_dtrace.h"

#ifdef HAVE_DTRACE
#include "node_provider.h"
#elif HAVE_ETW
#include "node_win32_etw_provider-inl.h"
#else
#define NODE_HTTP_SERVER_REQUEST(arg0, arg1)
#define NODE_HTTP_SERVER_REQUEST_ENABLED() (0)
#define NODE_HTTP_SERVER_RESPONSE(arg0)
#define NODE_HTTP_SERVER_RESPONSE_ENABLED() (0)
#define NODE_HTTP_CLIENT_REQUEST(arg0, arg1)
#define NODE_HTTP_CLIENT_REQUEST_ENABLED() (0)
#define NODE_HTTP_CLIENT_RESPONSE(arg0)
#define NODE_HTTP_CLIENT_RESPONSE_ENABLED() (0)
#define NODE_NET_SERVER_CONNECTION(arg0)
#define NODE_NET_SERVER_CONNECTION_ENABLED() (0)
#define NODE_NET_STREAM_END(arg0)
#define NODE_NET_STREAM_END_ENABLED() (0)
#define NODE_GC_START(arg0, arg1, arg2)
#define NODE_GC_DONE(arg0, arg1, arg2)
#endif

#include "env-inl.h"
#include "node_errors.h"
#include "node_external_reference.h"

#include <cstring>

namespace node {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::GCCallbackFlags;
using v8::GCType;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;

#define SLURP_STRING(obj, member, valp)                                    \
  if (!(obj)->IsObject()) {                                                \
    return node::THROW_ERR_INVALID_ARG_TYPE(env,                           \
        "expected object for " #obj " to contain string member " #member); \
  }                                                                        \
  node::Utf8Value _##member(env->isolate(),                                \
      obj->Get(env->context(),                                             \
               OneByteString(env->isolate(), #member)).ToLocalChecked());  \
  if ((*(const char **)valp = *_##member) == nullptr)                      \
    *(const char **)valp = "<unknown>";

#define SLURP_INT(obj, member, valp)                                           \
  if (!(obj)->IsObject()) {                                                    \
    return node::THROW_ERR_INVALID_ARG_TYPE(                                   \
        env,                                                                   \
        "expected object for " #obj " to contain integer member " #member);    \
  }                                                                            \
  *valp = obj->Get(env->context(),                                             \
                   OneByteString(env->isolate(), #member)).ToLocalChecked()    \
              ->Int32Value(env->context())                                     \
              .FromJust();

#define SLURP_OBJECT(obj, member, valp)                                    \
  if (!(obj)->IsObject()) {                                                \
    return node::THROW_ERR_INVALID_ARG_TYPE(env,                           \
        "expected object for " #obj " to contain object member " #member); \
  }                                                                        \
  *valp = obj->Get(env->context(),                                         \
      OneByteString(env->isolate(), #member)).ToLocalChecked().As<Object>();

#define SLURP_CONNECTION(arg, conn)                                        \
  if (!(arg)->IsObject()) {                                                \
    return node::THROW_ERR_INVALID_ARG_TYPE(env,                           \
        "expected argument " #arg " to be a connection object");           \
  }                                                                        \
  node_dtrace_connection_t conn;                                           \
  Local<Object> _##conn = arg.As<Object>();                                \
  Local<Value> _handle =                                                   \
      (_##conn)->Get(env->context(),                                       \
                     FIXED_ONE_BYTE_STRING(env->isolate(), "_handle"))     \
                     .ToLocalChecked();                                    \
  if (_handle->IsObject()) {                                               \
    SLURP_INT(_handle.As<Object>(), fd, &conn.fd);                         \
  } else {                                                                 \
    conn.fd = -1;                                                          \
  }                                                                        \
  SLURP_STRING(_##conn, remoteAddress, &conn.remote);                      \
  SLURP_INT(_##conn, remotePort, &conn.port);                              \
  SLURP_INT(_##conn, bufferSize, &conn.buffered);

#define SLURP_CONNECTION_HTTP_CLIENT(arg, conn)                            \
  if (!(arg)->IsObject()) {                                                \
    return node::THROW_ERR_INVALID_ARG_TYPE(env,                           \
        "expected argument " #arg " to be a connection object");           \
  }                                                                        \
  node_dtrace_connection_t conn;                                           \
  Local<Object> _##conn = arg.As<Object>();                                \
  SLURP_INT(_##conn, fd, &conn.fd);                                        \
  SLURP_STRING(_##conn, host, &conn.remote);                               \
  SLURP_INT(_##conn, port, &conn.port);                                    \
  SLURP_INT(_##conn, bufferSize, &conn.buffered);

#define SLURP_CONNECTION_HTTP_CLIENT_RESPONSE(arg0, arg1, conn)            \
  if (!(arg0)->IsObject()) {                                               \
    return node::THROW_ERR_INVALID_ARG_TYPE(env,                           \
        "expected argument " #arg0 " to be a connection object");          \
  }                                                                        \
  if (!(arg1)->IsObject()) {                                               \
    return node::THROW_ERR_INVALID_ARG_TYPE(env,                           \
        "expected argument " #arg1 " to be a connection object");          \
  }                                                                        \
  node_dtrace_connection_t conn;                                           \
  Local<Object> _##conn = arg0.As<Object>();                               \
  SLURP_INT(_##conn, fd, &conn.fd);                                        \
  SLURP_INT(_##conn, bufferSize, &conn.buffered);                          \
  _##conn = arg1.As<Object>();                                             \
  SLURP_STRING(_##conn, host, &conn.remote);                               \
  SLURP_INT(_##conn, port, &conn.port);


void DTRACE_NET_SERVER_CONNECTION(const FunctionCallbackInfo<Value>& args) {
  if (!NODE_NET_SERVER_CONNECTION_ENABLED())
    return;
  Environment* env = Environment::GetCurrent(args);
  SLURP_CONNECTION(args[0], conn);
  NODE_NET_SERVER_CONNECTION(&conn, conn.remote, conn.port, conn.fd);
}


void DTRACE_NET_STREAM_END(const FunctionCallbackInfo<Value>& args) {
  if (!NODE_NET_STREAM_END_ENABLED())
    return;
  Environment* env = Environment::GetCurrent(args);
  SLURP_CONNECTION(args[0], conn);
  NODE_NET_STREAM_END(&conn, conn.remote, conn.port, conn.fd);
}

void DTRACE_HTTP_SERVER_REQUEST(const FunctionCallbackInfo<Value>& args) {
  node_dtrace_http_server_request_t req;

  if (!NODE_HTTP_SERVER_REQUEST_ENABLED())
    return;

  Environment* env = Environment::GetCurrent(args);
  HandleScope scope(env->isolate());
  Local<Object> arg0 = args[0].As<Object>();
  Local<Object> headers;

  memset(&req, 0, sizeof(req));
  req._un.version = 1;
  SLURP_STRING(arg0, url, &req.url);
  SLURP_STRING(arg0, method, &req.method);
  SLURP_OBJECT(arg0, headers, &headers);

  if (!(headers)->IsObject()) {
    return node::THROW_ERR_INVALID_ARG_TYPE(env,
        "expected object for request to contain string member headers");
  }

  Local<Value> strfwdfor = headers->Get(
      env->context(), env->x_forwarded_string()).ToLocalChecked();
  node::Utf8Value fwdfor(env->isolate(), strfwdfor);

  if (!strfwdfor->IsString() || (req.forwardedFor = *fwdfor) == nullptr)
    req.forwardedFor = const_cast<char*>("");

  SLURP_CONNECTION(args[1], conn);
  NODE_HTTP_SERVER_REQUEST(&req, &conn, conn.remote, conn.port, req.method, \
                           req.url, conn.fd);
}


void DTRACE_HTTP_SERVER_RESPONSE(const FunctionCallbackInfo<Value>& args) {
  if (!NODE_HTTP_SERVER_RESPONSE_ENABLED())
    return;
  Environment* env = Environment::GetCurrent(args);
  SLURP_CONNECTION(args[0], conn);
  NODE_HTTP_SERVER_RESPONSE(&conn, conn.remote, conn.port, conn.fd);
}


void DTRACE_HTTP_CLIENT_REQUEST(const FunctionCallbackInfo<Value>& args) {
  node_dtrace_http_client_request_t req;
  char* header;

  if (!NODE_HTTP_CLIENT_REQUEST_ENABLED())
    return;

  Environment* env = Environment::GetCurrent(args);
  HandleScope scope(env->isolate());

  /*
   * For the method and URL, we're going to dig them out of the header.  This
   * is not as efficient as it could be, but we would rather not force the
   * caller here to retain their method and URL until the time at which
   * DTRACE_HTTP_CLIENT_REQUEST can be called.
   */
  Local<Object> arg0 = args[0].As<Object>();
  SLURP_STRING(arg0, _header, &header);

  req.method = header;

  while (*header != '\0' && *header != ' ')
    header++;

  if (*header != '\0')
    *header++ = '\0';

  req.url = header;

  while (*header != '\0' && *header != ' ')
    header++;

  *header = '\0';

  SLURP_CONNECTION_HTTP_CLIENT(args[1], conn);
  NODE_HTTP_CLIENT_REQUEST(&req, &conn, conn.remote, conn.port, req.method, \
                           req.url, conn.fd);
}


void DTRACE_HTTP_CLIENT_RESPONSE(const FunctionCallbackInfo<Value>& args) {
  if (!NODE_HTTP_CLIENT_RESPONSE_ENABLED())
    return;
  Environment* env = Environment::GetCurrent(args);
  SLURP_CONNECTION_HTTP_CLIENT_RESPONSE(args[0], args[1], conn);
  NODE_HTTP_CLIENT_RESPONSE(&conn, conn.remote, conn.port, conn.fd);
}

void dtrace_gc_start(Isolate* isolate,
                     GCType type,
                     GCCallbackFlags flags,
                     void* data) {
  // Previous versions of this probe point only logged type and flags.
  // That's why for reasons of backwards compatibility the isolate goes last.
  NODE_GC_START(type, flags, isolate);
}

void dtrace_gc_done(Isolate* isolate,
                    GCType type,
                    GCCallbackFlags flags,
                    void* data) {
  // Previous versions of this probe point only logged type and flags.
  // That's why for reasons of backwards compatibility the isolate goes last.
  NODE_GC_DONE(type, flags, isolate);
}


void InitDTrace(Environment* env) {
#ifdef HAVE_ETW
  // ETW is neither thread-safe nor does it clean up resources on exit,
  // so we can use it only on the main thread.
  if (env->is_main_thread()) {
    init_etw();
  }
#endif

  // We need to use the variant of GC callbacks that takes data to
  // avoid running into DCHECKs when multiple Environments try to add
  // the same callback to the same isolate multiple times.
  env->isolate()->AddGCPrologueCallback(dtrace_gc_start, env);
  env->isolate()->AddGCEpilogueCallback(dtrace_gc_done, env);
  env->AddCleanupHook([](void* data) {
    Environment* env = static_cast<Environment*>(data);
    env->isolate()->RemoveGCPrologueCallback(dtrace_gc_start, env);
    env->isolate()->RemoveGCEpilogueCallback(dtrace_gc_done, env);
  }, env);
}

#define NODE_PROBES(V)                                                         \
  V(DTRACE_NET_SERVER_CONNECTION)                                              \
  V(DTRACE_NET_STREAM_END)                                                     \
  V(DTRACE_HTTP_SERVER_REQUEST)                                                \
  V(DTRACE_HTTP_SERVER_RESPONSE)                                               \
  V(DTRACE_HTTP_CLIENT_REQUEST)                                                \
  V(DTRACE_HTTP_CLIENT_RESPONSE)

void InitializeDTrace(Local<Object> target,
                      Local<Value> unused,
                      Local<Context> context,
                      void* priv) {
  Environment* env = Environment::GetCurrent(context);

#if defined HAVE_DTRACE || defined HAVE_ETW
#define V(name) env->SetMethod(target, #name, name);
  NODE_PROBES(V)
#undef V
#endif  // defined HAVE_DTRACE || defined HAVE_ETW
}

void RegisterDtraceExternalReferences(ExternalReferenceRegistry* registry) {
#if defined HAVE_DTRACE || defined HAVE_ETW
#define V(name) registry->Register(name);
  NODE_PROBES(V)
#undef V
#endif  // defined HAVE_DTRACE || defined HAVE_ETW
}

}  // namespace node
NODE_MODULE_CONTEXT_AWARE_INTERNAL(dtrace, node::InitializeDTrace)
NODE_MODULE_EXTERNAL_REFERENCE(dtrace, node::RegisterDtraceExternalReferences)
