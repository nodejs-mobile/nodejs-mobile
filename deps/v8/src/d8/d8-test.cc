// Copyright 2021 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/d8/d8.h"

#include "include/v8-fast-api-calls.h"
#include "src/api/api-inl.h"

// This file exposes a d8.test.fast_c_api object, which adds testing facility
// for writing mjsunit tests that exercise fast API calls. The fast_c_api object
// contains an `add_all` method with the following signature:
// double add_all(bool /*should_fallback*/, int32_t, uint32_t,
//   int64_t, uint64_t, float, double), that is wired as a "fast API" method.
// The fast_c_api object also supports querying the number of fast/slow calls
// and resetting these counters.

// Make sure to sync the following with src/compiler/globals.h.
#if defined(V8_TARGET_ARCH_X64)
#define V8_ENABLE_FP_PARAMS_IN_C_LINKAGE
#endif

namespace v8 {
namespace {

#define CHECK_SELF_OR_FALLBACK(return_value) \
  if (!self) {                               \
    options.fallback = 1;                    \
    return return_value;                     \
  }

#define CHECK_SELF_OR_THROW()                                               \
  if (!self) {                                                              \
    args.GetIsolate()->ThrowError(                                          \
        "This method is not defined on objects inheriting from FastCAPI."); \
    return;                                                                 \
  }

class FastCApiObject {
 public:
  static double AddAllFastCallback(Local<Object> receiver, bool should_fallback,
                                   int32_t arg_i32, uint32_t arg_u32,
                                   int64_t arg_i64, uint64_t arg_u64,
                                   float arg_f32, double arg_f64,
                                   FastApiCallbackOptions& options) {
    FastCApiObject* self = UnwrapObject(receiver);
    CHECK_SELF_OR_FALLBACK(0);
    self->fast_call_count_++;

    if (should_fallback) {
      options.fallback = 1;
      return 0;
    }

    return static_cast<double>(arg_i32) + static_cast<double>(arg_u32) +
           static_cast<double>(arg_i64) + static_cast<double>(arg_u64) +
           static_cast<double>(arg_f32) + arg_f64;
  }
  static void AddAllSlowCallback(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    self->slow_call_count_++;

    HandleScope handle_scope(isolate);

    double sum = 0;
    if (args.Length() > 1 && args[1]->IsNumber()) {
      sum += args[1]->Int32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 2 && args[2]->IsNumber()) {
      sum += args[2]->Uint32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 3 && args[3]->IsNumber()) {
      sum += args[3]->IntegerValue(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 4 && args[4]->IsNumber()) {
      sum += args[4]->IntegerValue(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 5 && args[5]->IsNumber()) {
      sum += args[5]->NumberValue(isolate->GetCurrentContext()).FromJust();
    } else {
      sum += std::numeric_limits<double>::quiet_NaN();
    }
    if (args.Length() > 6 && args[6]->IsNumber()) {
      sum += args[6]->NumberValue(isolate->GetCurrentContext()).FromJust();
    } else {
      sum += std::numeric_limits<double>::quiet_NaN();
    }

    args.GetReturnValue().Set(Number::New(isolate, sum));
  }

#ifdef V8_ENABLE_FP_PARAMS_IN_C_LINKAGE
  typedef double Type;
  static constexpr CTypeInfo type_info = CTypeInfo(CTypeInfo::Type::kFloat64);
#else
  typedef int32_t Type;
  static constexpr CTypeInfo type_info = CTypeInfo(CTypeInfo::Type::kInt32);
#endif  // V8_ENABLE_FP_PARAMS_IN_C_LINKAGE
  static Type AddAllSequenceFastCallback(Local<Object> receiver,
                                         bool should_fallback,
                                         Local<Array> seq_arg,
                                         FastApiCallbackOptions& options) {
    FastCApiObject* self = UnwrapObject(receiver);
    CHECK_SELF_OR_FALLBACK(0);
    self->fast_call_count_++;

    if (should_fallback) {
      options.fallback = 1;
      return 0;
    }

    uint32_t length = seq_arg->Length();
    if (length > 1024) {
      options.fallback = 1;
      return 0;
    }

    Type buffer[1024];
    bool result = TryCopyAndConvertArrayToCppBuffer<&type_info, Type>(
        seq_arg, buffer, 1024);
    if (!result) {
      options.fallback = 1;
      return 0;
    }
    DCHECK_EQ(seq_arg->Length(), length);

    Type sum = 0;
    for (uint32_t i = 0; i < length; ++i) {
      sum += buffer[i];
    }

    return sum;
  }
  static void AddAllSequenceSlowCallback(
      const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();

    HandleScope handle_scope(isolate);

    if (args.Length() < 2) {
      self->slow_call_count_++;
      isolate->ThrowError("This method expects at least 2 arguments.");
      return;
    }
    if (args[1]->IsTypedArray()) {
      AddAllTypedArraySlowCallback(args);
      return;
    }
    self->slow_call_count_++;
    if (args[1]->IsUndefined()) {
      Type dummy_result = 0;
      args.GetReturnValue().Set(Number::New(isolate, dummy_result));
      return;
    }
    if (!args[1]->IsArray()) {
      isolate->ThrowError("This method expects an array as a second argument.");
      return;
    }

    Local<Array> seq_arg = args[1].As<Array>();
    uint32_t length = seq_arg->Length();
    if (length > 1024) {
      isolate->ThrowError(
          "Invalid length of array, must be between 0 and 1024.");
      return;
    }

    Type sum = 0;
    for (uint32_t i = 0; i < length; ++i) {
      v8::Local<v8::Value> element =
          seq_arg
              ->Get(isolate->GetCurrentContext(),
                    v8::Integer::NewFromUnsigned(isolate, i))
              .ToLocalChecked();
      if (element->IsNumber()) {
        double value = element->ToNumber(isolate->GetCurrentContext())
                           .ToLocalChecked()
                           ->Value();
        sum += value;
      } else if (element->IsUndefined()) {
        // Hole: ignore the element.
      } else {
        isolate->ThrowError("unexpected element type in JSArray");
        return;
      }
    }
    args.GetReturnValue().Set(Number::New(isolate, sum));
  }
  template <typename T>
  static Type AddAllTypedArrayFastCallback(
      Local<Object> receiver, bool should_fallback,
      const FastApiTypedArray<T>& typed_array_arg,
      FastApiCallbackOptions& options) {
    FastCApiObject* self = UnwrapObject(receiver);
    CHECK_SELF_OR_FALLBACK(0);
    self->fast_call_count_++;

    if (should_fallback) {
      options.fallback = 1;
      return 0;
    }

    T sum = 0;
    for (unsigned i = 0; i < typed_array_arg.length(); ++i) {
      sum += typed_array_arg.get(i);
    }
    return static_cast<Type>(sum);
  }
  static void AddAllTypedArraySlowCallback(
      const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    self->slow_call_count_++;

    HandleScope handle_scope(isolate);

    if (args.Length() < 2) {
      isolate->ThrowError("This method expects at least 2 arguments.");
      return;
    }
    if (!args[1]->IsTypedArray()) {
      isolate->ThrowError(
          "This method expects a TypedArray as a second argument.");
      return;
    }

    Local<TypedArray> typed_array_arg = args[1].As<TypedArray>();
    size_t length = typed_array_arg->Length();

    void* data = typed_array_arg->Buffer()->GetBackingStore()->Data();
    if (typed_array_arg->IsInt32Array() || typed_array_arg->IsUint32Array() ||
        typed_array_arg->IsBigInt64Array() ||
        typed_array_arg->IsBigUint64Array()) {
      int64_t sum = 0;
      for (unsigned i = 0; i < length; ++i) {
        if (typed_array_arg->IsInt32Array()) {
          sum += static_cast<int32_t*>(data)[i];
        } else if (typed_array_arg->IsUint32Array()) {
          sum += static_cast<uint32_t*>(data)[i];
        } else if (typed_array_arg->IsBigInt64Array()) {
          sum += static_cast<int64_t*>(data)[i];
        } else if (typed_array_arg->IsBigUint64Array()) {
          sum += static_cast<uint64_t*>(data)[i];
        }
      }
      args.GetReturnValue().Set(Number::New(isolate, sum));
    } else if (typed_array_arg->IsFloat32Array() ||
               typed_array_arg->IsFloat64Array()) {
      double sum = 0;
      for (unsigned i = 0; i < length; ++i) {
        if (typed_array_arg->IsFloat32Array()) {
          sum += static_cast<float*>(data)[i];
        } else if (typed_array_arg->IsFloat64Array()) {
          sum += static_cast<double*>(data)[i];
        }
      }
      args.GetReturnValue().Set(Number::New(isolate, sum));
    } else {
      isolate->ThrowError("TypedArray type is not supported.");
      return;
    }
  }

  static int32_t AddAllIntInvalidCallback(Local<Object> receiver,
                                          bool should_fallback, int32_t arg_i32,
                                          FastApiCallbackOptions& options) {
    // This should never be called
    UNREACHABLE();
  }

  static int Add32BitIntFastCallback(v8::Local<v8::Object> receiver,
                                     bool should_fallback, int32_t arg_i32,
                                     uint32_t arg_u32,
                                     FastApiCallbackOptions& options) {
    FastCApiObject* self = UnwrapObject(receiver);
    CHECK_SELF_OR_FALLBACK(0);
    self->fast_call_count_++;

    if (should_fallback) {
      options.fallback = 1;
      return 0;
    }

    return arg_i32 + arg_u32;
  }
  static void Add32BitIntSlowCallback(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    self->slow_call_count_++;

    HandleScope handle_scope(isolate);

    double sum = 0;
    if (args.Length() > 1 && args[1]->IsNumber()) {
      sum += args[1]->Int32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 2 && args[2]->IsNumber()) {
      sum += args[2]->Uint32Value(isolate->GetCurrentContext()).FromJust();
    }

    args.GetReturnValue().Set(Number::New(isolate, sum));
  }

  static int AddAll32BitIntFastCallback_6Args(
      Local<Object> receiver, bool should_fallback, int32_t arg1_i32,
      int32_t arg2_i32, int32_t arg3_i32, uint32_t arg4_u32, uint32_t arg5_u32,
      uint32_t arg6_u32, FastApiCallbackOptions& options) {
    FastCApiObject* self = UnwrapObject(receiver);
    CHECK_SELF_OR_FALLBACK(0);
    self->fast_call_count_++;

    if (should_fallback) {
      options.fallback = 1;
      return 0;
    }

    int64_t result = static_cast<int64_t>(arg1_i32) + arg2_i32 + arg3_i32 +
                     arg4_u32 + arg5_u32 + arg6_u32;
    if (result > INT_MAX) return INT_MAX;
    if (result < INT_MIN) return INT_MIN;
    return static_cast<int>(result);
  }
  static int AddAll32BitIntFastCallback_5Args(
      Local<Object> receiver, bool should_fallback, int32_t arg1_i32,
      int32_t arg2_i32, int32_t arg3_i32, uint32_t arg4_u32, uint32_t arg5_u32,
      FastApiCallbackOptions& options) {
    return AddAll32BitIntFastCallback_6Args(receiver, should_fallback, arg1_i32,
                                            arg2_i32, arg3_i32, arg4_u32,
                                            arg5_u32, 0, options);
  }
  static void AddAll32BitIntSlowCallback(
      const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    self->slow_call_count_++;

    HandleScope handle_scope(isolate);

    double sum = 0;
    if (args.Length() > 1 && args[1]->IsNumber()) {
      sum += args[1]->Int32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 2 && args[2]->IsNumber()) {
      sum += args[2]->Int32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 3 && args[3]->IsNumber()) {
      sum += args[3]->Int32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 4 && args[4]->IsNumber()) {
      sum += args[4]->Uint32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 5 && args[5]->IsNumber()) {
      sum += args[5]->Uint32Value(isolate->GetCurrentContext()).FromJust();
    }
    if (args.Length() > 6 && args[6]->IsNumber()) {
      sum += args[6]->Uint32Value(isolate->GetCurrentContext()).FromJust();
    }

    args.GetReturnValue().Set(Number::New(isolate, sum));
  }

  static bool IsFastCApiObjectFastCallback(v8::Local<v8::Object> receiver,
                                           bool should_fallback,
                                           v8::Local<v8::Value> arg,
                                           FastApiCallbackOptions& options) {
    FastCApiObject* self = UnwrapObject(receiver);
    CHECK_SELF_OR_FALLBACK(false);
    self->fast_call_count_++;

    if (should_fallback) {
      options.fallback = 1;
      return false;
    }

    if (!arg->IsObject()) {
      return false;
    }
    Local<Object> object = arg.As<Object>();
    if (!IsValidApiObject(object)) return false;

    internal::Isolate* i_isolate =
        internal::IsolateFromNeverReadOnlySpaceObject(
            *reinterpret_cast<internal::Address*>(*object));
    CHECK_NOT_NULL(i_isolate);
    Isolate* isolate = reinterpret_cast<Isolate*>(i_isolate);
    HandleScope handle_scope(isolate);
    return PerIsolateData::Get(isolate)
        ->GetTestApiObjectCtor()
        ->IsLeafTemplateForApiObject(object);
  }
  static void IsFastCApiObjectSlowCallback(
      const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    self->slow_call_count_++;

    HandleScope handle_scope(isolate);

    bool result = false;
    if (args.Length() < 2) {
      args.GetIsolate()->ThrowError(
          "is_valid_api_object should be called with 2 arguments");
      return;
    }
    if (args[1]->IsObject()) {
      Local<Object> object = args[1].As<Object>();
      if (!IsValidApiObject(object)) {
        result = false;
      } else {
        result = PerIsolateData::Get(args.GetIsolate())
                     ->GetTestApiObjectCtor()
                     ->IsLeafTemplateForApiObject(object);
      }
    }

    args.GetReturnValue().Set(Boolean::New(isolate, result));
  }

  static void FastCallCount(const FunctionCallbackInfo<Value>& args) {
    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    args.GetReturnValue().Set(
        Number::New(args.GetIsolate(), self->fast_call_count()));
  }
  static void SlowCallCount(const FunctionCallbackInfo<Value>& args) {
    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    args.GetReturnValue().Set(
        Number::New(args.GetIsolate(), self->slow_call_count()));
  }
  static void ResetCounts(const FunctionCallbackInfo<Value>& args) {
    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    self->reset_counts();
    args.GetReturnValue().Set(Undefined(args.GetIsolate()));
  }
  static void SupportsFPParams(const FunctionCallbackInfo<Value>& args) {
    FastCApiObject* self = UnwrapObject(args.This());
    CHECK_SELF_OR_THROW();
    args.GetReturnValue().Set(self->supports_fp_params_);
  }

  int fast_call_count() const { return fast_call_count_; }
  int slow_call_count() const { return slow_call_count_; }
  void reset_counts() {
    fast_call_count_ = 0;
    slow_call_count_ = 0;
  }

  static const int kV8WrapperObjectIndex = 1;

 private:
  static bool IsValidApiObject(Local<Object> object) {
    i::Address addr = *reinterpret_cast<i::Address*>(*object);
    auto instance_type = i::Internals::GetInstanceType(addr);
    return (instance_type == i::Internals::kJSApiObjectType ||
            instance_type == i::Internals::kJSSpecialApiObjectType);
  }
  static FastCApiObject* UnwrapObject(Local<Object> object) {
    if (!IsValidApiObject(object)) {
      return nullptr;
    }
    FastCApiObject* wrapped = reinterpret_cast<FastCApiObject*>(
        object->GetAlignedPointerFromInternalField(kV8WrapperObjectIndex));
    CHECK_NOT_NULL(wrapped);
    return wrapped;
  }
  int fast_call_count_ = 0, slow_call_count_ = 0;
#ifdef V8_ENABLE_FP_PARAMS_IN_C_LINKAGE
  bool supports_fp_params_ = true;
#else   // V8_ENABLE_FP_PARAMS_IN_C_LINKAGE
  bool supports_fp_params_ = false;
#endif  // V8_ENABLE_FP_PARAMS_IN_C_LINKAGE
};

#undef CHECK_SELF_OR_THROW
#undef CHECK_SELF_OR_FALLBACK

// The object is statically initialized for simplicity, typically the embedder
// will take care of managing their C++ objects lifetime.
thread_local FastCApiObject kFastCApiObject;
}  // namespace

void CreateFastCAPIObject(const FunctionCallbackInfo<Value>& info) {
  if (!info.IsConstructCall()) {
    info.GetIsolate()->ThrowError(
        "FastCAPI helper must be constructed with new.");
    return;
  }
  Local<Object> api_object = info.Holder();
  api_object->SetAlignedPointerInInternalField(
      FastCApiObject::kV8WrapperObjectIndex,
      reinterpret_cast<void*>(&kFastCApiObject));
  api_object->SetAccessorProperty(
      String::NewFromUtf8Literal(info.GetIsolate(), "supports_fp_params"),
      FunctionTemplate::New(info.GetIsolate(), FastCApiObject::SupportsFPParams)
          ->GetFunction(api_object->GetCreationContext().ToLocalChecked())
          .ToLocalChecked());
}

Local<FunctionTemplate> Shell::CreateTestFastCApiTemplate(Isolate* isolate) {
  Local<FunctionTemplate> api_obj_ctor =
      FunctionTemplate::New(isolate, CreateFastCAPIObject);
  PerIsolateData::Get(isolate)->SetTestApiObjectCtor(api_obj_ctor);
  Local<Signature> signature = Signature::New(isolate, api_obj_ctor);
  {
    CFunction add_all_c_func =
        CFunction::Make(FastCApiObject::AddAllFastCallback);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all",
        FunctionTemplate::New(isolate, FastCApiObject::AddAllSlowCallback,
                              Local<Value>(), signature, 1,
                              ConstructorBehavior::kThrow,
                              SideEffectType::kHasSideEffect, &add_all_c_func));

    CFunction add_all_seq_c_func =
        CFunction::Make(FastCApiObject::AddAllSequenceFastCallback);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all_sequence",
        FunctionTemplate::New(
            isolate, FastCApiObject::AddAllSequenceSlowCallback, Local<Value>(),
            signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, &add_all_seq_c_func));

    CFunction add_all_int32_typed_array_c_func =
        CFunction::Make(FastCApiObject::AddAllTypedArrayFastCallback<int32_t>);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all_int32_typed_array",
        FunctionTemplate::New(
            isolate, FastCApiObject::AddAllTypedArraySlowCallback,
            Local<Value>(), signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, &add_all_int32_typed_array_c_func));

    CFunction add_all_int64_typed_array_c_func =
        CFunction::Make(FastCApiObject::AddAllTypedArrayFastCallback<int64_t>);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all_int64_typed_array",
        FunctionTemplate::New(
            isolate, FastCApiObject::AddAllTypedArraySlowCallback,
            Local<Value>(), signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, &add_all_int64_typed_array_c_func));

    CFunction add_all_uint64_typed_array_c_func =
        CFunction::Make(FastCApiObject::AddAllTypedArrayFastCallback<uint64_t>);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all_uint64_typed_array",
        FunctionTemplate::New(
            isolate, FastCApiObject::AddAllTypedArraySlowCallback,
            Local<Value>(), signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect,
            &add_all_uint64_typed_array_c_func));

    CFunction add_all_uint32_typed_array_c_func =
        CFunction::Make(FastCApiObject::AddAllTypedArrayFastCallback<uint32_t>);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all_uint32_typed_array",
        FunctionTemplate::New(
            isolate, FastCApiObject::AddAllTypedArraySlowCallback,
            Local<Value>(), signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect,
            &add_all_uint32_typed_array_c_func));

    const CFunction add_all_overloads[] = {
        add_all_uint32_typed_array_c_func,
        add_all_seq_c_func,
    };
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all_overload",
        FunctionTemplate::NewWithCFunctionOverloads(
            isolate, FastCApiObject::AddAllSequenceSlowCallback, Local<Value>(),
            signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, {add_all_overloads, 2}));

    CFunction add_all_int_invalid_func =
        CFunction::Make(FastCApiObject::AddAllIntInvalidCallback);
    const CFunction add_all_invalid_overloads[] = {
        add_all_int_invalid_func,
        add_all_seq_c_func,
    };
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_all_invalid_overload",
        FunctionTemplate::NewWithCFunctionOverloads(
            isolate, FastCApiObject::AddAllSequenceSlowCallback, Local<Value>(),
            signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, {add_all_invalid_overloads, 2}));

    CFunction add_all_32bit_int_6args_c_func =
        CFunction::Make(FastCApiObject::AddAll32BitIntFastCallback_6Args);
    CFunction add_all_32bit_int_5args_c_func =
        CFunction::Make(FastCApiObject::AddAll32BitIntFastCallback_5Args);
    const CFunction c_function_overloads[] = {add_all_32bit_int_6args_c_func,
                                              add_all_32bit_int_5args_c_func};
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "overloaded_add_all_32bit_int",
        FunctionTemplate::NewWithCFunctionOverloads(
            isolate, FastCApiObject::AddAll32BitIntSlowCallback, Local<Value>(),
            signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, {c_function_overloads, 2}));

    CFunction add_32bit_int_c_func =
        CFunction::Make(FastCApiObject::Add32BitIntFastCallback);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "add_32bit_int",
        FunctionTemplate::New(
            isolate, FastCApiObject::Add32BitIntSlowCallback, Local<Value>(),
            signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, &add_32bit_int_c_func));
    CFunction is_valid_api_object_c_func =
        CFunction::Make(FastCApiObject::IsFastCApiObjectFastCallback);
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "is_fast_c_api_object",
        FunctionTemplate::New(
            isolate, FastCApiObject::IsFastCApiObjectSlowCallback,
            Local<Value>(), signature, 1, ConstructorBehavior::kThrow,
            SideEffectType::kHasSideEffect, &is_valid_api_object_c_func));
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "fast_call_count",
        FunctionTemplate::New(isolate, FastCApiObject::FastCallCount,
                              Local<Value>(), signature));
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "slow_call_count",
        FunctionTemplate::New(isolate, FastCApiObject::SlowCallCount,
                              Local<Value>(), signature));
    api_obj_ctor->PrototypeTemplate()->Set(
        isolate, "reset_counts",
        FunctionTemplate::New(isolate, FastCApiObject::ResetCounts,
                              Local<Value>(), signature));
  }
  api_obj_ctor->InstanceTemplate()->SetInternalFieldCount(
      FastCApiObject::kV8WrapperObjectIndex + 1);

  return api_obj_ctor;
}

void CreateLeafInterfaceObject(const FunctionCallbackInfo<Value>& info) {
  if (!info.IsConstructCall()) {
    info.GetIsolate()->ThrowError(
        "LeafInterfaceType helper must be constructed with new.");
  }
}

Local<FunctionTemplate> Shell::CreateLeafInterfaceTypeTemplate(
    Isolate* isolate) {
  Local<FunctionTemplate> leaf_object_ctor =
      FunctionTemplate::New(isolate, CreateLeafInterfaceObject);
  leaf_object_ctor->SetClassName(
      String::NewFromUtf8Literal(isolate, "LeafInterfaceType"));
  return leaf_object_ctor;
}

}  // namespace v8
