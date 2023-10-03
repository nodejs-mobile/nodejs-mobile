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

#include "util.h"  // NOLINT(build/include_inline)
#include "util-inl.h"

#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node_buffer.h"
#include "node_errors.h"
#include "node_internals.h"
#include "node_util.h"
#include "string_bytes.h"
#include "uv.h"

#ifdef _WIN32
#include <io.h>  // _S_IREAD _S_IWRITE
#include <time.h>
#ifndef S_IRUSR
#define S_IRUSR _S_IREAD
#endif  // S_IRUSR
#ifndef S_IWUSR
#define S_IWUSR _S_IWRITE
#endif  // S_IWUSR
#else
#include <sys/time.h>
#include <sys/types.h>
#endif

#include <atomic>
#include <cstdio>
#include <cstring>
#include <iomanip>
#include <sstream>

static std::atomic_int seq = {0};  // Sequence number for diagnostic filenames.

namespace node {

using v8::ArrayBufferView;
using v8::Isolate;
using v8::Local;
using v8::String;
using v8::Value;

template <typename T>
static void MakeUtf8String(Isolate* isolate,
                           Local<Value> value,
                           MaybeStackBuffer<T>* target) {
  Local<String> string;
  if (!value->ToString(isolate->GetCurrentContext()).ToLocal(&string)) return;

  size_t storage;
  if (!StringBytes::StorageSize(isolate, string, UTF8).To(&storage)) return;
  storage += 1;
  target->AllocateSufficientStorage(storage);
  const int flags =
      String::NO_NULL_TERMINATION | String::REPLACE_INVALID_UTF8;
  const int length =
      string->WriteUtf8(isolate, target->out(), storage, nullptr, flags);
  target->SetLengthAndZeroTerminate(length);
}

Utf8Value::Utf8Value(Isolate* isolate, Local<Value> value) {
  if (value.IsEmpty())
    return;

  MakeUtf8String(isolate, value, this);
}


TwoByteValue::TwoByteValue(Isolate* isolate, Local<Value> value) {
  if (value.IsEmpty()) {
    return;
  }

  Local<String> string;
  if (!value->ToString(isolate->GetCurrentContext()).ToLocal(&string)) return;

  // Allocate enough space to include the null terminator
  const size_t storage = string->Length() + 1;
  AllocateSufficientStorage(storage);

  const int flags = String::NO_NULL_TERMINATION;
  const int length = string->Write(isolate, out(), 0, storage, flags);
  SetLengthAndZeroTerminate(length);
}

BufferValue::BufferValue(Isolate* isolate, Local<Value> value) {
  // Slightly different take on Utf8Value. If value is a String,
  // it will return a Utf8 encoded string. If value is a Buffer,
  // it will copy the data out of the Buffer as is.
  if (value.IsEmpty()) {
    // Dereferencing this object will return nullptr.
    Invalidate();
    return;
  }

  if (value->IsString()) {
    MakeUtf8String(isolate, value, this);
  } else if (value->IsArrayBufferView()) {
    const size_t len = value.As<ArrayBufferView>()->ByteLength();
    // Leave place for the terminating '\0' byte.
    AllocateSufficientStorage(len + 1);
    value.As<ArrayBufferView>()->CopyContents(out(), len);
    SetLengthAndZeroTerminate(len);
  } else {
    Invalidate();
  }
}

void LowMemoryNotification() {
  if (per_process::v8_initialized) {
    auto isolate = Isolate::TryGetCurrent();
    if (isolate != nullptr) {
      isolate->LowMemoryNotification();
    }
  }
}

std::string GetProcessTitle(const char* default_title) {
  std::string buf(16, '\0');

  for (;;) {
    const int rc = uv_get_process_title(buf.data(), buf.size());

    if (rc == 0)
      break;

    // If uv_setup_args() was not called, `uv_get_process_title()` will always
    // return `UV_ENOBUFS`, no matter the input size. Guard against a possible
    // infinite loop by limiting the buffer size.
    if (rc != UV_ENOBUFS || buf.size() >= 1024 * 1024)
      return default_title;

    buf.resize(2 * buf.size());
  }

  // Strip excess trailing nul bytes. Using strlen() here is safe,
  // uv_get_process_title() always zero-terminates the result.
  buf.resize(strlen(buf.data()));

  return buf;
}

std::string GetHumanReadableProcessName() {
  return SPrintF("%s[%d]", GetProcessTitle("Node.js"), uv_os_getpid());
}

std::vector<std::string> SplitString(const std::string& in,
                                     char delim,
                                     bool skipEmpty) {
  std::vector<std::string> out;
  if (in.empty())
    return out;
  std::istringstream in_stream(in);
  while (in_stream.good()) {
    std::string item;
    std::getline(in_stream, item, delim);
    if (item.empty() && skipEmpty) continue;
    out.emplace_back(std::move(item));
  }
  return out;
}

void ThrowErrStringTooLong(Isolate* isolate) {
  isolate->ThrowException(ERR_STRING_TOO_LONG(isolate));
}

double GetCurrentTimeInMicroseconds() {
  constexpr double kMicrosecondsPerSecond = 1e6;
  uv_timeval64_t tv;
  CHECK_EQ(0, uv_gettimeofday(&tv));
  return kMicrosecondsPerSecond * tv.tv_sec + tv.tv_usec;
}

int WriteFileSync(const char* path, uv_buf_t buf) {
  uv_fs_t req;
  int fd = uv_fs_open(nullptr,
                      &req,
                      path,
                      O_WRONLY | O_CREAT | O_TRUNC,
                      S_IWUSR | S_IRUSR,
                      nullptr);
  uv_fs_req_cleanup(&req);
  if (fd < 0) {
    return fd;
  }

  int err = uv_fs_write(nullptr, &req, fd, &buf, 1, 0, nullptr);
  uv_fs_req_cleanup(&req);
  if (err < 0) {
    return err;
  }

  err = uv_fs_close(nullptr, &req, fd, nullptr);
  uv_fs_req_cleanup(&req);
  return err;
}

int WriteFileSync(v8::Isolate* isolate,
                  const char* path,
                  v8::Local<v8::String> string) {
  node::Utf8Value utf8(isolate, string);
  uv_buf_t buf = uv_buf_init(utf8.out(), utf8.length());
  return WriteFileSync(path, buf);
}

int ReadFileSync(std::string* result, const char* path) {
  uv_fs_t req;
  auto defer_req_cleanup = OnScopeLeave([&req]() {
    uv_fs_req_cleanup(&req);
  });

  uv_file file = uv_fs_open(nullptr, &req, path, O_RDONLY, 0, nullptr);
  if (req.result < 0) {
    // req will be cleaned up by scope leave.
    return req.result;
  }
  uv_fs_req_cleanup(&req);

  auto defer_close = OnScopeLeave([file]() {
    uv_fs_t close_req;
    CHECK_EQ(0, uv_fs_close(nullptr, &close_req, file, nullptr));
    uv_fs_req_cleanup(&close_req);
  });

  *result = std::string("");
  char buffer[4096];
  uv_buf_t buf = uv_buf_init(buffer, sizeof(buffer));

  while (true) {
    const int r =
        uv_fs_read(nullptr, &req, file, &buf, 1, result->length(), nullptr);
    if (req.result < 0) {
      // req will be cleaned up by scope leave.
      return req.result;
    }
    uv_fs_req_cleanup(&req);
    if (r <= 0) {
      break;
    }
    result->append(buf.base, r);
  }
  return 0;
}

void DiagnosticFilename::LocalTime(TIME_TYPE* tm_struct) {
#ifdef _WIN32
  GetLocalTime(tm_struct);
#else  // UNIX, OSX
  struct timeval time_val;
  gettimeofday(&time_val, nullptr);
  localtime_r(&time_val.tv_sec, tm_struct);
#endif
}

// Defined in node_internals.h
std::string DiagnosticFilename::MakeFilename(
    uint64_t thread_id,
    const char* prefix,
    const char* ext) {
  std::ostringstream oss;
  TIME_TYPE tm_struct;
  LocalTime(&tm_struct);
  oss << prefix;
#ifdef _WIN32
  oss << "." << std::setfill('0') << std::setw(4) << tm_struct.wYear;
  oss << std::setfill('0') << std::setw(2) << tm_struct.wMonth;
  oss << std::setfill('0') << std::setw(2) << tm_struct.wDay;
  oss << "." << std::setfill('0') << std::setw(2) << tm_struct.wHour;
  oss << std::setfill('0') << std::setw(2) << tm_struct.wMinute;
  oss << std::setfill('0') << std::setw(2) << tm_struct.wSecond;
#else  // UNIX, OSX
  oss << "."
            << std::setfill('0')
            << std::setw(4)
            << tm_struct.tm_year + 1900;
  oss << std::setfill('0')
            << std::setw(2)
            << tm_struct.tm_mon + 1;
  oss << std::setfill('0')
            << std::setw(2)
            << tm_struct.tm_mday;
  oss << "."
            << std::setfill('0')
            << std::setw(2)
            << tm_struct.tm_hour;
  oss << std::setfill('0')
            << std::setw(2)
            << tm_struct.tm_min;
  oss << std::setfill('0')
            << std::setw(2)
            << tm_struct.tm_sec;
#endif
  oss << "." << uv_os_getpid();
  oss << "." << thread_id;
  oss << "." << std::setfill('0') << std::setw(3) << ++seq;
  oss << "." << ext;
  return oss.str();
}

Local<v8::FunctionTemplate> NewFunctionTemplate(
    v8::Isolate* isolate,
    v8::FunctionCallback callback,
    Local<v8::Signature> signature,
    v8::ConstructorBehavior behavior,
    v8::SideEffectType side_effect_type,
    const v8::CFunction* c_function) {
  return v8::FunctionTemplate::New(isolate,
                                   callback,
                                   Local<v8::Value>(),
                                   signature,
                                   0,
                                   behavior,
                                   side_effect_type,
                                   c_function);
}

void SetMethod(Local<v8::Context> context,
               Local<v8::Object> that,
               const char* name,
               v8::FunctionCallback callback) {
  Isolate* isolate = context->GetIsolate();
  Local<v8::Function> function =
      NewFunctionTemplate(isolate,
                          callback,
                          Local<v8::Signature>(),
                          v8::ConstructorBehavior::kThrow,
                          v8::SideEffectType::kHasSideEffect)
          ->GetFunction(context)
          .ToLocalChecked();
  // kInternalized strings are created in the old space.
  const v8::NewStringType type = v8::NewStringType::kInternalized;
  Local<v8::String> name_string =
      v8::String::NewFromUtf8(isolate, name, type).ToLocalChecked();
  that->Set(context, name_string, function).Check();
  function->SetName(name_string);  // NODE_SET_METHOD() compatibility.
}

void SetFastMethod(Local<v8::Context> context,
                   Local<v8::Object> that,
                   const char* name,
                   v8::FunctionCallback slow_callback,
                   const v8::CFunction* c_function) {
  Isolate* isolate = context->GetIsolate();
  Local<v8::Function> function =
      NewFunctionTemplate(isolate,
                          slow_callback,
                          Local<v8::Signature>(),
                          v8::ConstructorBehavior::kThrow,
                          v8::SideEffectType::kHasSideEffect,
                          c_function)
          ->GetFunction(context)
          .ToLocalChecked();
  const v8::NewStringType type = v8::NewStringType::kInternalized;
  Local<v8::String> name_string =
      v8::String::NewFromUtf8(isolate, name, type).ToLocalChecked();
  that->Set(context, name_string, function).Check();
}

void SetFastMethodNoSideEffect(Local<v8::Context> context,
                               Local<v8::Object> that,
                               const char* name,
                               v8::FunctionCallback slow_callback,
                               const v8::CFunction* c_function) {
  Isolate* isolate = context->GetIsolate();
  Local<v8::Function> function =
      NewFunctionTemplate(isolate,
                          slow_callback,
                          Local<v8::Signature>(),
                          v8::ConstructorBehavior::kThrow,
                          v8::SideEffectType::kHasNoSideEffect,
                          c_function)
          ->GetFunction(context)
          .ToLocalChecked();
  const v8::NewStringType type = v8::NewStringType::kInternalized;
  Local<v8::String> name_string =
      v8::String::NewFromUtf8(isolate, name, type).ToLocalChecked();
  that->Set(context, name_string, function).Check();
}

void SetMethodNoSideEffect(Local<v8::Context> context,
                           Local<v8::Object> that,
                           const char* name,
                           v8::FunctionCallback callback) {
  Isolate* isolate = context->GetIsolate();
  Local<v8::Function> function =
      NewFunctionTemplate(isolate,
                          callback,
                          Local<v8::Signature>(),
                          v8::ConstructorBehavior::kThrow,
                          v8::SideEffectType::kHasNoSideEffect)
          ->GetFunction(context)
          .ToLocalChecked();
  // kInternalized strings are created in the old space.
  const v8::NewStringType type = v8::NewStringType::kInternalized;
  Local<v8::String> name_string =
      v8::String::NewFromUtf8(isolate, name, type).ToLocalChecked();
  that->Set(context, name_string, function).Check();
  function->SetName(name_string);  // NODE_SET_METHOD() compatibility.
}

void SetProtoMethod(v8::Isolate* isolate,
                    Local<v8::FunctionTemplate> that,
                    const char* name,
                    v8::FunctionCallback callback) {
  Local<v8::Signature> signature = v8::Signature::New(isolate, that);
  Local<v8::FunctionTemplate> t =
      NewFunctionTemplate(isolate,
                          callback,
                          signature,
                          v8::ConstructorBehavior::kThrow,
                          v8::SideEffectType::kHasSideEffect);
  // kInternalized strings are created in the old space.
  const v8::NewStringType type = v8::NewStringType::kInternalized;
  Local<v8::String> name_string =
      v8::String::NewFromUtf8(isolate, name, type).ToLocalChecked();
  that->PrototypeTemplate()->Set(name_string, t);
  t->SetClassName(name_string);  // NODE_SET_PROTOTYPE_METHOD() compatibility.
}

void SetProtoMethodNoSideEffect(v8::Isolate* isolate,
                                Local<v8::FunctionTemplate> that,
                                const char* name,
                                v8::FunctionCallback callback) {
  Local<v8::Signature> signature = v8::Signature::New(isolate, that);
  Local<v8::FunctionTemplate> t =
      NewFunctionTemplate(isolate,
                          callback,
                          signature,
                          v8::ConstructorBehavior::kThrow,
                          v8::SideEffectType::kHasNoSideEffect);
  // kInternalized strings are created in the old space.
  const v8::NewStringType type = v8::NewStringType::kInternalized;
  Local<v8::String> name_string =
      v8::String::NewFromUtf8(isolate, name, type).ToLocalChecked();
  that->PrototypeTemplate()->Set(name_string, t);
  t->SetClassName(name_string);  // NODE_SET_PROTOTYPE_METHOD() compatibility.
}

void SetInstanceMethod(v8::Isolate* isolate,
                       Local<v8::FunctionTemplate> that,
                       const char* name,
                       v8::FunctionCallback callback) {
  Local<v8::Signature> signature = v8::Signature::New(isolate, that);
  Local<v8::FunctionTemplate> t =
      NewFunctionTemplate(isolate,
                          callback,
                          signature,
                          v8::ConstructorBehavior::kThrow,
                          v8::SideEffectType::kHasSideEffect);
  // kInternalized strings are created in the old space.
  const v8::NewStringType type = v8::NewStringType::kInternalized;
  Local<v8::String> name_string =
      v8::String::NewFromUtf8(isolate, name, type).ToLocalChecked();
  that->InstanceTemplate()->Set(name_string, t);
  t->SetClassName(name_string);
}

void SetConstructorFunction(Local<v8::Context> context,
                            Local<v8::Object> that,
                            const char* name,
                            Local<v8::FunctionTemplate> tmpl,
                            SetConstructorFunctionFlag flag) {
  Isolate* isolate = context->GetIsolate();
  SetConstructorFunction(
      context, that, OneByteString(isolate, name), tmpl, flag);
}

void SetConstructorFunction(Local<v8::Context> context,
                            Local<v8::Object> that,
                            Local<v8::String> name,
                            Local<v8::FunctionTemplate> tmpl,
                            SetConstructorFunctionFlag flag) {
  if (LIKELY(flag == SetConstructorFunctionFlag::SET_CLASS_NAME))
    tmpl->SetClassName(name);
  that->Set(context, name, tmpl->GetFunction(context).ToLocalChecked()).Check();
}

namespace {

class NonOwningExternalOneByteResource
    : public v8::String::ExternalOneByteStringResource {
 public:
  explicit NonOwningExternalOneByteResource(const UnionBytes& source)
      : source_(source) {}
  ~NonOwningExternalOneByteResource() override = default;

  const char* data() const override {
    return reinterpret_cast<const char*>(source_.one_bytes_data());
  }
  size_t length() const override { return source_.length(); }

  NonOwningExternalOneByteResource(const NonOwningExternalOneByteResource&) =
      delete;
  NonOwningExternalOneByteResource& operator=(
      const NonOwningExternalOneByteResource&) = delete;

 private:
  const UnionBytes source_;
};

class NonOwningExternalTwoByteResource
    : public v8::String::ExternalStringResource {
 public:
  explicit NonOwningExternalTwoByteResource(const UnionBytes& source)
      : source_(source) {}
  ~NonOwningExternalTwoByteResource() override = default;

  const uint16_t* data() const override { return source_.two_bytes_data(); }
  size_t length() const override { return source_.length(); }

  NonOwningExternalTwoByteResource(const NonOwningExternalTwoByteResource&) =
      delete;
  NonOwningExternalTwoByteResource& operator=(
      const NonOwningExternalTwoByteResource&) = delete;

 private:
  const UnionBytes source_;
};

}  // anonymous namespace

Local<String> UnionBytes::ToStringChecked(Isolate* isolate) const {
  if (UNLIKELY(length() == 0)) {
    // V8 requires non-null data pointers for empty external strings,
    // but we don't guarantee that. Solve this by not creating an
    // external string at all in that case.
    return String::Empty(isolate);
  }
  if (is_one_byte()) {
    NonOwningExternalOneByteResource* source =
        new NonOwningExternalOneByteResource(*this);
    return String::NewExternalOneByte(isolate, source).ToLocalChecked();
  } else {
    NonOwningExternalTwoByteResource* source =
        new NonOwningExternalTwoByteResource(*this);
    return String::NewExternalTwoByte(isolate, source).ToLocalChecked();
  }
}

}  // namespace node
