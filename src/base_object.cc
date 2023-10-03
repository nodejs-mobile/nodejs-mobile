#include "base_object.h"
#include "env-inl.h"
#include "node_realm-inl.h"

namespace node {

using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::HandleScope;
using v8::Local;
using v8::Object;
using v8::Value;
using v8::WeakCallbackInfo;
using v8::WeakCallbackType;

BaseObject::BaseObject(Realm* realm, Local<Object> object)
    : persistent_handle_(realm->isolate(), object), realm_(realm) {
  CHECK_EQ(false, object.IsEmpty());
  CHECK_GE(object->InternalFieldCount(), BaseObject::kInternalFieldCount);
  SetInternalFields(object, static_cast<void*>(this));
  realm->AddCleanupHook(DeleteMe, static_cast<void*>(this));
  realm->modify_base_object_count(1);
}

BaseObject::~BaseObject() {
  realm()->modify_base_object_count(-1);
  realm()->RemoveCleanupHook(DeleteMe, static_cast<void*>(this));

  if (UNLIKELY(has_pointer_data())) {
    PointerData* metadata = pointer_data();
    CHECK_EQ(metadata->strong_ptr_count, 0);
    metadata->self = nullptr;
    if (metadata->weak_ptr_count == 0) delete metadata;
  }

  if (persistent_handle_.IsEmpty()) {
    // This most likely happened because the weak callback below cleared it.
    return;
  }

  {
    HandleScope handle_scope(realm()->isolate());
    object()->SetAlignedPointerInInternalField(BaseObject::kSlot, nullptr);
  }
}

void BaseObject::MakeWeak() {
  if (has_pointer_data()) {
    pointer_data()->wants_weak_jsobj = true;
    if (pointer_data()->strong_ptr_count > 0) return;
  }

  persistent_handle_.SetWeak(
      this,
      [](const WeakCallbackInfo<BaseObject>& data) {
        BaseObject* obj = data.GetParameter();
        // Clear the persistent handle so that ~BaseObject() doesn't attempt
        // to mess with internal fields, since the JS object may have
        // transitioned into an invalid state.
        // Refs: https://github.com/nodejs/node/issues/18897
        obj->persistent_handle_.Reset();
        CHECK_IMPLIES(obj->has_pointer_data(),
                      obj->pointer_data()->strong_ptr_count == 0);
        obj->OnGCCollect();
      },
      WeakCallbackType::kParameter);
}

// This just has to be different from the Chromium ones:
// https://source.chromium.org/chromium/chromium/src/+/main:gin/public/gin_embedders.h;l=18-23;drc=5a758a97032f0b656c3c36a3497560762495501a
// Otherwise, when Node is loaded in an isolate which uses cppgc, cppgc will
// misinterpret the data stored in the embedder fields and try to garbage
// collect them.
uint16_t kNodeEmbedderId = 0x90de;

void BaseObject::LazilyInitializedJSTemplateConstructor(
    const FunctionCallbackInfo<Value>& args) {
  DCHECK(args.IsConstructCall());
  CHECK_GE(args.This()->InternalFieldCount(), BaseObject::kInternalFieldCount);
  SetInternalFields(args.This(), nullptr);
}

Local<FunctionTemplate> BaseObject::MakeLazilyInitializedJSTemplate(
    Environment* env) {
  return MakeLazilyInitializedJSTemplate(env->isolate_data());
}

Local<FunctionTemplate> BaseObject::MakeLazilyInitializedJSTemplate(
    IsolateData* isolate_data) {
  Local<FunctionTemplate> t = NewFunctionTemplate(
      isolate_data->isolate(), LazilyInitializedJSTemplateConstructor);
  t->Inherit(BaseObject::GetConstructorTemplate(isolate_data));
  t->InstanceTemplate()->SetInternalFieldCount(BaseObject::kInternalFieldCount);
  return t;
}

BaseObject::PointerData* BaseObject::pointer_data() {
  if (!has_pointer_data()) {
    PointerData* metadata = new PointerData();
    metadata->wants_weak_jsobj = persistent_handle_.IsWeak();
    metadata->self = this;
    pointer_data_ = metadata;
  }
  CHECK(has_pointer_data());
  return pointer_data_;
}

void BaseObject::decrease_refcount() {
  CHECK(has_pointer_data());
  PointerData* metadata = pointer_data();
  CHECK_GT(metadata->strong_ptr_count, 0);
  unsigned int new_refcount = --metadata->strong_ptr_count;
  if (new_refcount == 0) {
    if (metadata->is_detached) {
      OnGCCollect();
    } else if (metadata->wants_weak_jsobj && !persistent_handle_.IsEmpty()) {
      MakeWeak();
    }
  }
}

void BaseObject::increase_refcount() {
  unsigned int prev_refcount = pointer_data()->strong_ptr_count++;
  if (prev_refcount == 0 && !persistent_handle_.IsEmpty())
    persistent_handle_.ClearWeak();
}

void BaseObject::DeleteMe(void* data) {
  BaseObject* self = static_cast<BaseObject*>(data);
  if (self->has_pointer_data() && self->pointer_data()->strong_ptr_count > 0) {
    return self->Detach();
  }
  delete self;
}

bool BaseObject::IsDoneInitializing() const {
  return true;
}

Local<Object> BaseObject::WrappedObject() const {
  return object();
}

bool BaseObject::IsRootNode() const {
  return !persistent_handle_.IsWeak();
}

Local<FunctionTemplate> BaseObject::GetConstructorTemplate(
    IsolateData* isolate_data) {
  Local<FunctionTemplate> tmpl = isolate_data->base_object_ctor_template();
  if (tmpl.IsEmpty()) {
    tmpl = NewFunctionTemplate(isolate_data->isolate(), nullptr);
    tmpl->SetClassName(
        FIXED_ONE_BYTE_STRING(isolate_data->isolate(), "BaseObject"));
    isolate_data->set_base_object_ctor_template(tmpl);
  }
  return tmpl;
}

bool BaseObject::IsNotIndicativeOfMemoryLeakAtExit() const {
  return IsWeakOrDetached();
}

}  // namespace node
