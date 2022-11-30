// Copyright 2021 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/compiler/heap-refs.h"

#ifdef ENABLE_SLOW_DCHECKS
#include <algorithm>
#endif

#include "src/api/api-inl.h"
#include "src/ast/modules.h"
#include "src/base/optional.h"
#include "src/base/platform/platform.h"
#include "src/codegen/code-factory.h"
#include "src/compiler/compilation-dependencies.h"
#include "src/compiler/graph-reducer.h"
#include "src/compiler/js-heap-broker.h"
#include "src/execution/protectors-inl.h"
#include "src/objects/allocation-site-inl.h"
#include "src/objects/descriptor-array.h"
#include "src/objects/heap-number-inl.h"
#include "src/objects/js-array-buffer-inl.h"
#include "src/objects/literal-objects-inl.h"
#include "src/objects/property-cell.h"
#include "src/objects/template-objects-inl.h"

namespace v8 {
namespace internal {
namespace compiler {

#define TRACE(broker, x) TRACE_BROKER(broker, x)
#define TRACE_MISSING(broker, x) TRACE_BROKER_MISSING(broker, x)

// There are several kinds of ObjectData values.
//
// kSmi: The underlying V8 object is a Smi and the data is an instance of the
//   base class (ObjectData), i.e. it's basically just the handle.  Because the
//   object is a Smi, it's safe to access the handle in order to extract the
//   number value, and AsSmi() does exactly that.
//
// kBackgroundSerializedHeapObject: The underlying V8 object is a HeapObject
//   and the data is an instance of the corresponding (most-specific) subclass,
//   e.g.  JSFunctionData, which provides serialized information about the
//   object. Allows serialization from the background thread.
//
// kUnserializedHeapObject: The underlying V8 object is a HeapObject and the
//   data is an instance of the base class (ObjectData), i.e. it basically
//   carries no information other than the handle.
//
// kNeverSerializedHeapObject: The underlying V8 object is a (potentially
//   mutable) HeapObject and the data is an instance of ObjectData. Its handle
//   must be persistent so that the GC can update it at a safepoint. Via this
//   handle, the object can be accessed concurrently to the main thread. To be
//   used the flag --concurrent-inlining must be on.
//
// kUnserializedReadOnlyHeapObject: The underlying V8 object is a read-only
//   HeapObject and the data is an instance of ObjectData. For
//   ReadOnlyHeapObjects, it is OK to access heap even from off-thread, so
//   these objects need not be serialized.
enum ObjectDataKind {
  kSmi,
  kBackgroundSerializedHeapObject,
  kUnserializedHeapObject,
  kNeverSerializedHeapObject,
  kUnserializedReadOnlyHeapObject
};

namespace {

bool IsReadOnlyHeapObjectForCompiler(HeapObject object) {
  DisallowGarbageCollection no_gc;
  // TODO(jgruber): Remove this compiler-specific predicate and use the plain
  // heap predicate instead. This would involve removing the special cases for
  // builtins.
  return (object.IsCode() && Code::cast(object).is_builtin()) ||
         (object.IsHeapObject() &&
          ReadOnlyHeap::Contains(HeapObject::cast(object)));
}

}  // namespace

NotConcurrentInliningTag::NotConcurrentInliningTag(JSHeapBroker* broker) {
  CHECK(!broker->is_concurrent_inlining());
}

class ObjectData : public ZoneObject {
 public:
  ObjectData(JSHeapBroker* broker, ObjectData** storage, Handle<Object> object,
             ObjectDataKind kind)
      : object_(object),
        kind_(kind)
#ifdef DEBUG
        ,
        broker_(broker)
#endif  // DEBUG
  {
    // This assignment ensures we don't end up inserting the same object
    // in an endless recursion.
    *storage = this;

    TRACE(broker, "Creating data " << this << " for handle " << object.address()
                                   << " (" << Brief(*object) << ")");

    // It is safe to access read only heap objects and builtins from a
    // background thread. When we read fields of these objects, we may create
    // ObjectData on the background thread even without a canonical handle
    // scope. This is safe too since we don't create handles but just get
    // handles from read only root table or builtins table which is what
    // canonical scope uses as well. For all other objects we should have
    // created ObjectData in canonical handle scope on the main thread.
    CHECK_IMPLIES(
        broker->mode() == JSHeapBroker::kDisabled ||
            broker->mode() == JSHeapBroker::kSerializing,
        broker->isolate()->handle_scope_data()->canonical_scope != nullptr);
    CHECK_IMPLIES(broker->mode() == JSHeapBroker::kSerialized,
                  kind == kUnserializedReadOnlyHeapObject || kind == kSmi ||
                      kind == kNeverSerializedHeapObject ||
                      kind == kBackgroundSerializedHeapObject);
    CHECK_IMPLIES(kind == kUnserializedReadOnlyHeapObject,
                  object->IsHeapObject() && IsReadOnlyHeapObjectForCompiler(
                                                HeapObject::cast(*object)));
  }

#define DECLARE_IS(Name) bool Is##Name() const;
  HEAP_BROKER_OBJECT_LIST(DECLARE_IS)
#undef DECLARE_IS

#define DECLARE_AS(Name) Name##Data* As##Name();
  HEAP_BROKER_BACKGROUND_SERIALIZED_OBJECT_LIST(DECLARE_AS)
#undef DECLARE_AS

  Handle<Object> object() const { return object_; }
  ObjectDataKind kind() const { return kind_; }
  bool is_smi() const { return kind_ == kSmi; }
  bool should_access_heap() const {
    return kind_ == kUnserializedHeapObject ||
           kind_ == kNeverSerializedHeapObject ||
           kind_ == kUnserializedReadOnlyHeapObject;
  }
  bool IsNull() const { return object_->IsNull(); }

#ifdef DEBUG
  JSHeapBroker* broker() const { return broker_; }
#endif  // DEBUG

 private:
  Handle<Object> const object_;
  ObjectDataKind const kind_;
#ifdef DEBUG
  JSHeapBroker* const broker_;  // For DCHECKs.
#endif                          // DEBUG
};

class HeapObjectData : public ObjectData {
 public:
  HeapObjectData(JSHeapBroker* broker, ObjectData** storage,
                 Handle<HeapObject> object, ObjectDataKind kind);

  base::Optional<bool> TryGetBooleanValue(JSHeapBroker* broker) const;
  ObjectData* map() const { return map_; }
  InstanceType GetMapInstanceType() const;

 private:
  base::Optional<bool> TryGetBooleanValueImpl(JSHeapBroker* broker) const;

  ObjectData* const map_;
};

class PropertyCellData : public HeapObjectData {
 public:
  PropertyCellData(JSHeapBroker* broker, ObjectData** storage,
                   Handle<PropertyCell> object, ObjectDataKind kind);

  bool Cache(JSHeapBroker* broker);

  PropertyDetails property_details() const {
    CHECK(serialized());
    return property_details_;
  }

  ObjectData* value() const {
    DCHECK(serialized());
    return value_;
  }

 private:
  PropertyDetails property_details_ = PropertyDetails::Empty();
  ObjectData* value_ = nullptr;

  bool serialized() const { return value_ != nullptr; }
};

namespace {

ZoneVector<Address> GetCFunctions(FixedArray function_overloads, Zone* zone) {
  const int len = function_overloads.length() /
                  FunctionTemplateInfo::kFunctionOverloadEntrySize;
  ZoneVector<Address> c_functions = ZoneVector<Address>(len, zone);
  for (int i = 0; i < len; i++) {
    c_functions[i] = v8::ToCData<Address>(function_overloads.get(
        FunctionTemplateInfo::kFunctionOverloadEntrySize * i));
  }
  return c_functions;
}

ZoneVector<const CFunctionInfo*> GetCSignatures(FixedArray function_overloads,
                                                Zone* zone) {
  const int len = function_overloads.length() /
                  FunctionTemplateInfo::kFunctionOverloadEntrySize;
  ZoneVector<const CFunctionInfo*> c_signatures =
      ZoneVector<const CFunctionInfo*>(len, zone);
  for (int i = 0; i < len; i++) {
    c_signatures[i] = v8::ToCData<const CFunctionInfo*>(function_overloads.get(
        FunctionTemplateInfo::kFunctionOverloadEntrySize * i + 1));
  }
  return c_signatures;
}

}  // namespace

PropertyCellData::PropertyCellData(JSHeapBroker* broker, ObjectData** storage,
                                   Handle<PropertyCell> object,
                                   ObjectDataKind kind)
    : HeapObjectData(broker, storage, object, kind) {}

bool PropertyCellData::Cache(JSHeapBroker* broker) {
  if (serialized()) return true;

  TraceScope tracer(broker, this, "PropertyCellData::Serialize");
  auto cell = Handle<PropertyCell>::cast(object());

  // While this code runs on a background thread, the property cell might
  // undergo state transitions via calls to PropertyCell::Transition. These
  // transitions follow a certain protocol on which we rely here to ensure that
  // we only report success when we can guarantee consistent data. A key
  // property is that after transitioning from cell type A to B (A != B), there
  // will never be a transition back to A, unless A is kConstant and the new
  // value is the hole (i.e. the property cell was invalidated, which is a final
  // state).

  PropertyDetails property_details = cell->property_details(kAcquireLoad);

  Handle<Object> value =
      broker->CanonicalPersistentHandle(cell->value(kAcquireLoad));
  if (broker->ObjectMayBeUninitialized(value)) {
    DCHECK(!broker->IsMainThread());
    return false;
  }

  {
    PropertyDetails property_details_again =
        cell->property_details(kAcquireLoad);
    if (property_details != property_details_again) {
      DCHECK(!broker->IsMainThread());
      return false;
    }
  }

  if (property_details.cell_type() == PropertyCellType::kConstant) {
    Handle<Object> value_again =
        broker->CanonicalPersistentHandle(cell->value(kAcquireLoad));
    if (*value != *value_again) {
      DCHECK(!broker->IsMainThread());
      return false;
    }
  }

  ObjectData* value_data = broker->TryGetOrCreateData(value);
  if (value_data == nullptr) {
    DCHECK(!broker->IsMainThread());
    return false;
  }

  PropertyCell::CheckDataIsCompatible(property_details, *value);

  DCHECK(!serialized());
  property_details_ = property_details;
  value_ = value_data;
  DCHECK(serialized());
  return true;
}

class JSReceiverData : public HeapObjectData {
 public:
  JSReceiverData(JSHeapBroker* broker, ObjectData** storage,
                 Handle<JSReceiver> object, ObjectDataKind kind)
      : HeapObjectData(broker, storage, object, kind) {}
};

class JSObjectData : public JSReceiverData {
 public:
  JSObjectData(JSHeapBroker* broker, ObjectData** storage,
               Handle<JSObject> object, ObjectDataKind kind);

  // Recursive serialization of all reachable JSObjects.
  bool SerializeAsBoilerplateRecursive(JSHeapBroker* broker,
                                       NotConcurrentInliningTag,
                                       int max_depth = kMaxFastLiteralDepth);
  ObjectData* GetInobjectField(int property_index) const;

  // Shallow serialization of {elements}.
  void SerializeElements(JSHeapBroker* broker, NotConcurrentInliningTag);
  bool serialized_elements() const { return serialized_elements_; }
  ObjectData* elements() const;

  ObjectData* raw_properties_or_hash() const { return raw_properties_or_hash_; }

  void SerializeObjectCreateMap(JSHeapBroker* broker, NotConcurrentInliningTag);

  // Can be nullptr.
  ObjectData* object_create_map(JSHeapBroker* broker) const {
    if (!serialized_object_create_map_) {
      DCHECK_NULL(object_create_map_);
      TRACE_MISSING(broker, "object_create_map on " << this);
    }
    return object_create_map_;
  }

  ObjectData* GetOwnConstantElement(
      JSHeapBroker* broker, uint32_t index,
      SerializationPolicy policy = SerializationPolicy::kAssumeSerialized);
  ObjectData* GetOwnFastDataProperty(
      JSHeapBroker* broker, Representation representation,
      FieldIndex field_index,
      SerializationPolicy policy = SerializationPolicy::kAssumeSerialized);
  ObjectData* GetOwnDictionaryProperty(JSHeapBroker* broker,
                                       InternalIndex dict_index,
                                       SerializationPolicy policy);

  // This method is only used to assert our invariants.
  bool cow_or_empty_elements_tenured() const;

  bool has_extra_serialized_data() const {
    return serialized_as_boilerplate_ || serialized_elements_ ||
           serialized_object_create_map_;
  }

 private:
  ObjectData* elements_ = nullptr;
  ObjectData* raw_properties_or_hash_ = nullptr;
  bool cow_or_empty_elements_tenured_ = false;
  // The {serialized_as_boilerplate} flag is set when all recursively
  // reachable JSObjects are serialized.
  bool serialized_as_boilerplate_ = false;
  bool serialized_elements_ = false;

  ZoneVector<ObjectData*> inobject_fields_;

  bool serialized_object_create_map_ = false;
  ObjectData* object_create_map_ = nullptr;

  // Elements (indexed properties) that either
  // (1) are known to exist directly on the object as non-writable and
  // non-configurable, or (2) are known not to (possibly they don't exist at
  // all). In case (2), the second pair component is nullptr.
  ZoneVector<std::pair<uint32_t, ObjectData*>> own_constant_elements_;
  // Properties that either:
  // (1) are known to exist directly on the object, or
  // (2) are known not to (possibly they don't exist at all).
  // In case (2), the second pair component is nullptr.
  // For simplicity, this may in theory overlap with inobject_fields_.
  // For fast mode objects, the keys of the map are the property_index() values
  // of the respective property FieldIndex'es. For slow mode objects, the keys
  // are the dictionary indicies.
  ZoneUnorderedMap<int, ObjectData*> own_properties_;
};

void JSObjectData::SerializeObjectCreateMap(JSHeapBroker* broker,
                                            NotConcurrentInliningTag) {
  if (serialized_object_create_map_) return;
  serialized_object_create_map_ = true;

  TraceScope tracer(broker, this, "JSObjectData::SerializeObjectCreateMap");
  Handle<JSObject> jsobject = Handle<JSObject>::cast(object());

  if (jsobject->map().is_prototype_map()) {
    Handle<Object> maybe_proto_info(jsobject->map().prototype_info(),
                                    broker->isolate());
    if (maybe_proto_info->IsPrototypeInfo()) {
      auto proto_info = Handle<PrototypeInfo>::cast(maybe_proto_info);
      if (proto_info->HasObjectCreateMap()) {
        DCHECK_NULL(object_create_map_);
        object_create_map_ =
            broker->GetOrCreateData(proto_info->ObjectCreateMap());
      }
    }
  }
}

namespace {

base::Optional<ObjectRef> GetOwnElementFromHeap(JSHeapBroker* broker,
                                                Handle<Object> receiver,
                                                uint32_t index,
                                                bool constant_only) {
  LookupIterator it(broker->isolate(), receiver, index, LookupIterator::OWN);
  if (it.state() == LookupIterator::DATA &&
      (!constant_only || (it.IsReadOnly() && !it.IsConfigurable()))) {
    return MakeRef(broker, it.GetDataValue());
  }
  return base::nullopt;
}

base::Optional<ObjectRef> GetOwnFastDataPropertyFromHeap(
    JSHeapBroker* broker, JSObjectRef holder, Representation representation,
    FieldIndex field_index) {
  base::Optional<Object> constant;
  {
    DisallowGarbageCollection no_gc;

    // This check to ensure the live map is the same as the cached map to
    // to protect us against reads outside the bounds of the heap. This could
    // happen if the Ref was created in a prior GC epoch, and the object
    // shrunk in size. It might end up at the edge of a heap boundary. If
    // we see that the map is the same in this GC epoch, we are safe.
    Map map = holder.object()->map(kAcquireLoad);
    if (*holder.map().object() != map) {
      TRACE_BROKER_MISSING(broker, "Map changed for " << holder);
      return {};
    }

    if (field_index.is_inobject()) {
      constant = holder.object()->RawInobjectPropertyAt(map, field_index);
      if (!constant.has_value()) {
        TRACE_BROKER_MISSING(
            broker, "Constant field in " << holder << " is unsafe to read");
        return {};
      }
    } else {
      Object raw_properties_or_hash =
          holder.object()->raw_properties_or_hash(kRelaxedLoad);
      // Ensure that the object is safe to inspect.
      if (broker->ObjectMayBeUninitialized(raw_properties_or_hash)) {
        return {};
      }
      if (!raw_properties_or_hash.IsPropertyArray()) {
        TRACE_BROKER_MISSING(
            broker,
            "Expected PropertyArray for backing store in " << holder << ".");
        return {};
      }
      PropertyArray properties = PropertyArray::cast(raw_properties_or_hash);
      const int array_index = field_index.outobject_array_index();
      if (array_index < properties.length(kAcquireLoad)) {
        constant = properties.get(array_index);
      } else {
        TRACE_BROKER_MISSING(
            broker, "Backing store for " << holder << " not long enough.");
        return {};
      }
    }

    // {constant} needs to pass the gc predicate before we can introspect on it.
    if (broker->ObjectMayBeUninitialized(constant.value())) return {};

    // Ensure that {constant} matches the {representation} we expect for the
    // field.
    if (!constant->FitsRepresentation(representation, false)) {
      const char* repString =
          constant->IsSmi()
              ? "Smi"
              : constant->IsHeapNumber() ? "HeapNumber" : "HeapObject";
      TRACE_BROKER_MISSING(broker, "Mismatched representation for "
                                       << holder << ". Expected "
                                       << representation << ", but object is a "
                                       << repString);
      return {};
    }
  }

  // Now that we can safely inspect the constant, it may need to be wrapped.
  Handle<Object> value = broker->CanonicalPersistentHandle(constant.value());
  Handle<Object> possibly_wrapped = Object::WrapForRead<AllocationType::kOld>(
      broker->local_isolate_or_isolate(), value, representation);
  return TryMakeRef(broker, *possibly_wrapped);
}

// Tries to get the property at {dict_index}. If we are within bounds of the
// object, we are guaranteed to see valid heap words even if the data is wrong.
base::Optional<ObjectRef> GetOwnDictionaryPropertyFromHeap(
    JSHeapBroker* broker, Handle<JSObject> receiver, InternalIndex dict_index) {
  Handle<Object> constant;
  {
    DisallowGarbageCollection no_gc;
    // DictionaryPropertyAt will check that we are within the bounds of the
    // object.
    base::Optional<Object> maybe_constant = JSObject::DictionaryPropertyAt(
        receiver, dict_index, broker->isolate()->heap());
    DCHECK_IMPLIES(broker->IsMainThread(), maybe_constant);
    if (!maybe_constant) return {};
    constant = broker->CanonicalPersistentHandle(maybe_constant.value());
  }
  return TryMakeRef(broker, constant);
}

}  // namespace

ObjectData* JSObjectData::GetOwnConstantElement(JSHeapBroker* broker,
                                                uint32_t index,
                                                SerializationPolicy policy) {
  for (auto const& p : own_constant_elements_) {
    if (p.first == index) return p.second;
  }

  if (policy == SerializationPolicy::kAssumeSerialized) {
    TRACE_MISSING(broker, "knowledge about index " << index << " on " << this);
    return nullptr;
  }

  base::Optional<ObjectRef> element =
      GetOwnElementFromHeap(broker, object(), index, true);
  ObjectData* result = element.has_value() ? element->data() : nullptr;
  own_constant_elements_.push_back({index, result});
  return result;
}

ObjectData* JSObjectData::GetOwnFastDataProperty(JSHeapBroker* broker,
                                                 Representation representation,
                                                 FieldIndex field_index,
                                                 SerializationPolicy policy) {
  auto p = own_properties_.find(field_index.property_index());
  if (p != own_properties_.end()) return p->second;

  if (policy == SerializationPolicy::kAssumeSerialized) {
    TRACE_MISSING(broker, "knowledge about fast property with index "
                              << field_index.property_index() << " on "
                              << this);
    return nullptr;
  }

  // This call will always succeed on the main thread.
  CHECK(broker->IsMainThread());
  JSObjectRef object_ref = MakeRef(broker, Handle<JSObject>::cast(object()));
  ObjectRef property = GetOwnFastDataPropertyFromHeap(
                           broker, object_ref, representation, field_index)
                           .value();
  ObjectData* result(property.data());
  own_properties_.insert(std::make_pair(field_index.property_index(), result));
  return result;
}

ObjectData* JSObjectData::GetOwnDictionaryProperty(JSHeapBroker* broker,
                                                   InternalIndex dict_index,
                                                   SerializationPolicy policy) {
  auto p = own_properties_.find(dict_index.as_int());
  if (p != own_properties_.end()) return p->second;

  if (policy == SerializationPolicy::kAssumeSerialized) {
    TRACE_MISSING(broker, "knowledge about dictionary property with index "
                              << dict_index.as_int() << " on " << this);
    return nullptr;
  }

  ObjectRef property = GetOwnDictionaryPropertyFromHeap(
                           broker, Handle<JSObject>::cast(object()), dict_index)
                           .value();
  ObjectData* result(property.data());
  own_properties_.insert(std::make_pair(dict_index.as_int(), result));
  return result;
}

class JSTypedArrayData : public JSObjectData {
 public:
  JSTypedArrayData(JSHeapBroker* broker, ObjectData** storage,
                   Handle<JSTypedArray> object, ObjectDataKind kind)
      : JSObjectData(broker, storage, object, kind) {}

  void Serialize(JSHeapBroker* broker, NotConcurrentInliningTag tag);
  bool serialized() const { return serialized_; }

  bool is_on_heap() const { return is_on_heap_; }
  size_t length() const { return length_; }
  void* data_ptr() const { return data_ptr_; }

  ObjectData* buffer() const { return buffer_; }

 private:
  bool serialized_ = false;
  bool is_on_heap_ = false;
  size_t length_ = 0;
  void* data_ptr_ = nullptr;
  ObjectData* buffer_ = nullptr;
};

void JSTypedArrayData::Serialize(JSHeapBroker* broker,
                                 NotConcurrentInliningTag) {
  if (serialized_) return;
  serialized_ = true;

  TraceScope tracer(broker, this, "JSTypedArrayData::Serialize");
  Handle<JSTypedArray> typed_array = Handle<JSTypedArray>::cast(object());

  is_on_heap_ = typed_array->is_on_heap();
  length_ = typed_array->length();
  data_ptr_ = typed_array->DataPtr();

  if (!is_on_heap()) {
    DCHECK_NULL(buffer_);
    buffer_ = broker->GetOrCreateData(typed_array->buffer());
  }
}

class JSDataViewData : public JSObjectData {
 public:
  JSDataViewData(JSHeapBroker* broker, ObjectData** storage,
                 Handle<JSDataView> object, ObjectDataKind kind)
      : JSObjectData(broker, storage, object, kind) {
    DCHECK_EQ(kind, kBackgroundSerializedHeapObject);
    if (!broker->is_concurrent_inlining()) {
      byte_length_ = object->byte_length();
    }
  }

  size_t byte_length() const {
    return byte_length_;
  }

 private:
  size_t byte_length_ = 0;  // Only valid if not concurrent inlining.
};

class JSBoundFunctionData : public JSObjectData {
 public:
  JSBoundFunctionData(JSHeapBroker* broker, ObjectData** storage,
                      Handle<JSBoundFunction> object, ObjectDataKind kind)
      : JSObjectData(broker, storage, object, kind) {}

  bool Serialize(JSHeapBroker* broker, NotConcurrentInliningTag tag);

  ObjectData* bound_target_function() const {
    DCHECK(!broker()->is_concurrent_inlining());
    return bound_target_function_;
  }
  ObjectData* bound_this() const {
    DCHECK(!broker()->is_concurrent_inlining());
    return bound_this_;
  }
  ObjectData* bound_arguments() const {
    DCHECK(!broker()->is_concurrent_inlining());
    return bound_arguments_;
  }

 private:
  bool serialized_ = false;

  ObjectData* bound_target_function_ = nullptr;
  ObjectData* bound_this_ = nullptr;
  ObjectData* bound_arguments_ = nullptr;
};

class JSFunctionData : public JSObjectData {
 public:
  JSFunctionData(JSHeapBroker* broker, ObjectData** storage,
                 Handle<JSFunction> object, ObjectDataKind kind)
      : JSObjectData(broker, storage, object, kind) {
    Cache(broker);
  }

  bool IsConsistentWithHeapState(JSHeapBroker* broker) const;

  bool has_feedback_vector() const {
    DCHECK(serialized_);
    return has_feedback_vector_;
  }
  bool has_initial_map() const {
    DCHECK(serialized_);
    return has_initial_map_;
  }
  bool has_instance_prototype() const {
    DCHECK(serialized_);
    return has_instance_prototype_;
  }
  bool PrototypeRequiresRuntimeLookup() const {
    DCHECK(serialized_);
    return PrototypeRequiresRuntimeLookup_;
  }

  ObjectData* context() const {
    DCHECK(serialized_);
    return context_;
  }
  ObjectData* native_context() const {
    DCHECK(serialized_);
    return native_context_;
  }
  MapData* initial_map() const {
    DCHECK(serialized_);
    return initial_map_;
  }
  ObjectData* instance_prototype() const {
    DCHECK(serialized_);
    return instance_prototype_;
  }
  ObjectData* shared() const {
    DCHECK(serialized_);
    return shared_;
  }
  ObjectData* raw_feedback_cell() const {
    DCHECK(serialized_);
    return feedback_cell_;
  }
  ObjectData* feedback_vector() const {
    DCHECK(serialized_);
    return feedback_vector_;
  }
  int initial_map_instance_size_with_min_slack() const {
    DCHECK(serialized_);
    return initial_map_instance_size_with_min_slack_;
  }

  // Track serialized fields that are actually used, in order to relax
  // ConsistentJSFunctionView dependency validation as much as possible.
  enum UsedField {
    kHasFeedbackVector = 1 << 0,
    kPrototypeOrInitialMap = 1 << 1,
    kHasInitialMap = 1 << 2,
    kHasInstancePrototype = 1 << 3,
    kPrototypeRequiresRuntimeLookup = 1 << 4,
    kInitialMap = 1 << 5,
    kInstancePrototype = 1 << 6,
    kFeedbackVector = 1 << 7,
    kFeedbackCell = 1 << 8,
    kInitialMapInstanceSizeWithMinSlack = 1 << 9,
  };

  bool has_any_used_field() const { return used_fields_ != 0; }
  bool has_used_field(UsedField used_field) const {
    return (used_fields_ & used_field) != 0;
  }
  void set_used_field(UsedField used_field) { used_fields_ |= used_field; }

 private:
  void Cache(JSHeapBroker* broker);

#ifdef DEBUG
  bool serialized_ = false;
#endif  // DEBUG

  using UsedFields = base::Flags<UsedField>;
  UsedFields used_fields_;

  bool has_feedback_vector_ = false;
  ObjectData* prototype_or_initial_map_ = nullptr;
  bool has_initial_map_ = false;
  bool has_instance_prototype_ = false;
  bool PrototypeRequiresRuntimeLookup_ = false;

  ObjectData* context_ = nullptr;
  ObjectData* native_context_ = nullptr;  // Derives from context_.
  MapData* initial_map_ = nullptr;  // Derives from prototype_or_initial_map_.
  ObjectData* instance_prototype_ =
      nullptr;  // Derives from prototype_or_initial_map_.
  ObjectData* shared_ = nullptr;
  ObjectData* feedback_vector_ = nullptr;  // Derives from feedback_cell.
  ObjectData* feedback_cell_ = nullptr;
  int initial_map_instance_size_with_min_slack_;  // Derives from
                                                  // prototype_or_initial_map_.
};

class BigIntData : public HeapObjectData {
 public:
  BigIntData(JSHeapBroker* broker, ObjectData** storage, Handle<BigInt> object,
             ObjectDataKind kind)
      : HeapObjectData(broker, storage, object, kind),
        as_uint64_(object->AsUint64(nullptr)) {}

  uint64_t AsUint64() const { return as_uint64_; }

 private:
  const uint64_t as_uint64_;
};

struct PropertyDescriptor {
  FieldIndex field_index;
  ObjectData* field_owner = nullptr;
};

class MapData : public HeapObjectData {
 public:
  MapData(JSHeapBroker* broker, ObjectData** storage, Handle<Map> object,
          ObjectDataKind kind);

  InstanceType instance_type() const { return instance_type_; }
  int instance_size() const { return instance_size_; }
  byte bit_field() const { return bit_field_; }
  byte bit_field2() const { return bit_field2_; }
  uint32_t bit_field3() const { return bit_field3_; }
  bool can_be_deprecated() const { return can_be_deprecated_; }
  bool can_transition() const { return can_transition_; }
  int in_object_properties_start_in_words() const {
    CHECK(InstanceTypeChecker::IsJSObject(instance_type()));
    return in_object_properties_start_in_words_;
  }
  int in_object_properties() const {
    CHECK(InstanceTypeChecker::IsJSObject(instance_type()));
    return in_object_properties_;
  }
  int constructor_function_index() const { return constructor_function_index_; }
  int NextFreePropertyIndex() const { return next_free_property_index_; }
  int UnusedPropertyFields() const { return unused_property_fields_; }
  bool supports_fast_array_iteration() const {
    return supports_fast_array_iteration_;
  }
  bool supports_fast_array_resize() const {
    return supports_fast_array_resize_;
  }
  bool is_abandoned_prototype_map() const {
    return is_abandoned_prototype_map_;
  }

  // Extra information.
  void SerializeRootMap(JSHeapBroker* broker, NotConcurrentInliningTag tag);
  ObjectData* FindRootMap() const;

  void SerializeConstructor(JSHeapBroker* broker, NotConcurrentInliningTag tag);
  ObjectData* GetConstructor() const {
    CHECK(serialized_constructor_);
    return constructor_;
  }

  void SerializeBackPointer(JSHeapBroker* broker, NotConcurrentInliningTag tag);
  ObjectData* GetBackPointer() const {
    CHECK(serialized_backpointer_);
    return backpointer_;
  }

  bool TrySerializePrototype(JSHeapBroker* broker,
                             NotConcurrentInliningTag tag);
  void SerializePrototype(JSHeapBroker* broker, NotConcurrentInliningTag tag) {
    CHECK(TrySerializePrototype(broker, tag));
  }
  ObjectData* prototype() const {
    DCHECK_EQ(serialized_prototype_, prototype_ != nullptr);
    return prototype_;
  }

  void SerializeForElementStore(JSHeapBroker* broker,
                                NotConcurrentInliningTag tag);

  bool has_extra_serialized_data() const {
    return serialized_constructor_ || serialized_backpointer_ ||
           serialized_prototype_ || serialized_root_map_ ||
           serialized_for_element_store_;
  }

 private:
  // The following fields should be const in principle, but construction
  // requires locking the MapUpdater lock. For this reason, it's easier to
  // initialize these inside the constructor body, not in the initializer list.

  // This block of fields will always be serialized.
  InstanceType instance_type_;
  int instance_size_;
  uint32_t bit_field3_;
  int unused_property_fields_;
  bool is_abandoned_prototype_map_;
  int in_object_properties_;

  // These fields will only serialized if we are not concurrent inlining.
  byte bit_field_;
  byte bit_field2_;
  bool can_be_deprecated_;
  bool can_transition_;
  int in_object_properties_start_in_words_;
  int constructor_function_index_;
  int next_free_property_index_;
  bool supports_fast_array_iteration_;
  bool supports_fast_array_resize_;

  // These extra fields still have to be serialized (e.g prototype_), since
  // those classes have fields themselves which are not being directly read.
  // This means that, for example, even though we can get the prototype itself
  // with direct reads, some of its fields require serialization.
  bool serialized_constructor_ = false;
  ObjectData* constructor_ = nullptr;

  bool serialized_backpointer_ = false;
  ObjectData* backpointer_ = nullptr;

  bool serialized_prototype_ = false;
  ObjectData* prototype_ = nullptr;

  bool serialized_root_map_ = false;
  ObjectData* root_map_ = nullptr;

  bool serialized_for_element_store_ = false;
};

namespace {

int InstanceSizeWithMinSlack(JSHeapBroker* broker, MapRef map) {
  // This operation is split into two phases (1. map collection, 2. map
  // processing). This is to avoid having to take two locks
  // (full_transition_array_access and map_updater_access) at once and thus
  // having to deal with related deadlock issues.
  ZoneVector<Handle<Map>> maps(broker->zone());
  maps.push_back(map.object());

  {
    DisallowGarbageCollection no_gc;

    // Has to be an initial map.
    DCHECK(map.object()->GetBackPointer().IsUndefined(broker->isolate()));

    static constexpr bool kConcurrentAccess = true;
    TransitionsAccessor(broker->isolate(), *map.object(), &no_gc,
                        kConcurrentAccess)
        .TraverseTransitionTree([&](Map m) {
          maps.push_back(broker->CanonicalPersistentHandle(m));
        });
  }

  // The lock is needed for UnusedPropertyFields and InstanceSizeFromSlack.
  JSHeapBroker::MapUpdaterGuardIfNeeded mumd_scope(broker);

  int slack = std::numeric_limits<int>::max();
  for (Handle<Map> m : maps) {
    slack = std::min(slack, m->UnusedPropertyFields());
  }

  return map.object()->InstanceSizeFromSlack(slack);
}

}  // namespace

// IMPORTANT: Keep this sync'd with JSFunctionData::IsConsistentWithHeapState.
void JSFunctionData::Cache(JSHeapBroker* broker) {
  DCHECK(!serialized_);

  TraceScope tracer(broker, this, "JSFunctionData::Cache");
  Handle<JSFunction> function = Handle<JSFunction>::cast(object());

  // This function may run on the background thread and thus must be individual
  // fields in a thread-safe manner. Consistency between fields is *not*
  // guaranteed here, instead we verify it in `IsConsistentWithHeapState`,
  // called during job finalization. Relaxed loads are thus okay: we're
  // guaranteed to see an initialized JSFunction object, and after
  // initialization fields remain in a valid state.

  Context context = function->context(kRelaxedLoad);
  context_ = broker->GetOrCreateData(context, kAssumeMemoryFence);
  CHECK(context_->IsContext());

  native_context_ = broker->GetOrCreateData(context.map().native_context(),
                                            kAssumeMemoryFence);
  CHECK(native_context_->IsNativeContext());

  SharedFunctionInfo shared = function->shared(kRelaxedLoad);
  shared_ = broker->GetOrCreateData(shared, kAssumeMemoryFence);

  if (function->has_prototype_slot()) {
    prototype_or_initial_map_ = broker->GetOrCreateData(
        function->prototype_or_initial_map(kAcquireLoad), kAssumeMemoryFence);

    has_initial_map_ = prototype_or_initial_map_->IsMap();
    if (has_initial_map_) {
      initial_map_ = prototype_or_initial_map_->AsMap();

      MapRef initial_map_ref = TryMakeRef<Map>(broker, initial_map_).value();
      if (initial_map_ref.IsInobjectSlackTrackingInProgress()) {
        initial_map_instance_size_with_min_slack_ =
            InstanceSizeWithMinSlack(broker, initial_map_ref);
      } else {
        initial_map_instance_size_with_min_slack_ =
            initial_map_ref.instance_size();
      }
      CHECK_GT(initial_map_instance_size_with_min_slack_, 0);

      if (!initial_map_->should_access_heap() &&
          !broker->is_concurrent_inlining()) {
        // TODO(neis): This is currently only needed for native_context's
        // object_function, as used by GetObjectCreateMap. If no further use
        // sites show up, we should move this into NativeContextData::Serialize.
        initial_map_->SerializePrototype(broker,
                                         NotConcurrentInliningTag{broker});
        initial_map_->SerializeConstructor(broker,
                                           NotConcurrentInliningTag{broker});
      }
    }

    if (has_initial_map_) {
      has_instance_prototype_ = true;
      instance_prototype_ = broker->GetOrCreateData(
          Handle<Map>::cast(initial_map_->object())->prototype(),
          kAssumeMemoryFence);
    } else if (prototype_or_initial_map_->IsHeapObject() &&
               !Handle<HeapObject>::cast(prototype_or_initial_map_->object())
                    ->IsTheHole()) {
      has_instance_prototype_ = true;
      instance_prototype_ = prototype_or_initial_map_;
    }
  }

  PrototypeRequiresRuntimeLookup_ = function->PrototypeRequiresRuntimeLookup();

  FeedbackCell feedback_cell = function->raw_feedback_cell(kAcquireLoad);
  feedback_cell_ = broker->GetOrCreateData(feedback_cell, kAssumeMemoryFence);

  ObjectData* maybe_feedback_vector = broker->GetOrCreateData(
      feedback_cell.value(kAcquireLoad), kAssumeMemoryFence);
  if (shared.is_compiled() && maybe_feedback_vector->IsFeedbackVector()) {
    has_feedback_vector_ = true;
    feedback_vector_ = maybe_feedback_vector;
  }

#ifdef DEBUG
  serialized_ = true;
#endif  // DEBUG
}

// IMPORTANT: Keep this sync'd with JSFunctionData::Cache.
bool JSFunctionData::IsConsistentWithHeapState(JSHeapBroker* broker) const {
  DCHECK(serialized_);

  Handle<JSFunction> f = Handle<JSFunction>::cast(object());

  CHECK_EQ(*context_->object(), f->context());
  CHECK_EQ(*native_context_->object(), f->native_context());
  CHECK_EQ(*shared_->object(), f->shared());

  if (f->has_prototype_slot()) {
    if (has_used_field(kPrototypeOrInitialMap) &&
        *prototype_or_initial_map_->object() !=
            f->prototype_or_initial_map(kAcquireLoad)) {
      TRACE_BROKER_MISSING(broker, "JSFunction::prototype_or_initial_map");
      return false;
    }
    if (has_used_field(kHasInitialMap) &&
        has_initial_map_ != f->has_initial_map()) {
      TRACE_BROKER_MISSING(broker, "JSFunction::has_initial_map");
      return false;
    }
    if (has_used_field(kHasInstancePrototype) &&
        has_instance_prototype_ != f->has_instance_prototype()) {
      TRACE_BROKER_MISSING(broker, "JSFunction::has_instance_prototype");
      return false;
    }
  } else {
    DCHECK(!has_initial_map_);
    DCHECK(!has_instance_prototype_);
  }

  if (has_initial_map()) {
    if (has_used_field(kInitialMap) &&
        *initial_map_->object() != f->initial_map()) {
      TRACE_BROKER_MISSING(broker, "JSFunction::initial_map");
      return false;
    }
    if (has_used_field(kInitialMapInstanceSizeWithMinSlack) &&
        initial_map_instance_size_with_min_slack_ !=
            f->ComputeInstanceSizeWithMinSlack(f->GetIsolate())) {
      TRACE_BROKER_MISSING(broker,
                           "JSFunction::ComputeInstanceSizeWithMinSlack");
      return false;
    }
  } else {
    DCHECK_NULL(initial_map_);
  }

  if (has_instance_prototype_) {
    if (has_used_field(kInstancePrototype) &&
        *instance_prototype_->object() != f->instance_prototype()) {
      TRACE_BROKER_MISSING(broker, "JSFunction::instance_prototype");
      return false;
    }
  } else {
    DCHECK_NULL(instance_prototype_);
  }

  if (has_used_field(kPrototypeRequiresRuntimeLookup) &&
      PrototypeRequiresRuntimeLookup_ != f->PrototypeRequiresRuntimeLookup()) {
    TRACE_BROKER_MISSING(broker, "JSFunction::PrototypeRequiresRuntimeLookup");
    return false;
  }

  if (has_used_field(kFeedbackCell) &&
      *feedback_cell_->object() != f->raw_feedback_cell()) {
    TRACE_BROKER_MISSING(broker, "JSFunction::raw_feedback_cell");
    return false;
  }

  if (has_used_field(kHasFeedbackVector) &&
      has_feedback_vector_ != f->has_feedback_vector()) {
    TRACE_BROKER_MISSING(broker, "JSFunction::has_feedback_vector");
    return false;
  }

  if (has_feedback_vector_) {
    if (has_used_field(kFeedbackVector) &&
        *feedback_vector_->object() != f->feedback_vector()) {
      TRACE_BROKER_MISSING(broker, "JSFunction::feedback_vector");
      return false;
    }
  } else {
    DCHECK_NULL(feedback_vector_);
  }

  return true;
}

bool JSFunctionRef::IsConsistentWithHeapState() const {
  DCHECK(broker()->is_concurrent_inlining());
  DCHECK(broker()->IsMainThread());
  return data()->AsJSFunction()->IsConsistentWithHeapState(broker());
}

HeapObjectData::HeapObjectData(JSHeapBroker* broker, ObjectData** storage,
                               Handle<HeapObject> object, ObjectDataKind kind)
    : ObjectData(broker, storage, object, kind),
      map_(broker->GetOrCreateData(object->map(kAcquireLoad),
                                   kAssumeMemoryFence)) {
  CHECK_IMPLIES(broker->mode() == JSHeapBroker::kSerialized,
                kind == kBackgroundSerializedHeapObject);
}

base::Optional<bool> HeapObjectData::TryGetBooleanValue(
    JSHeapBroker* broker) const {
  // Keep in sync with Object::BooleanValue.
  auto result = TryGetBooleanValueImpl(broker);
  DCHECK_IMPLIES(broker->IsMainThread() && result.has_value(),
                 result.value() == object()->BooleanValue(broker->isolate()));
  return result;
}

base::Optional<bool> HeapObjectData::TryGetBooleanValueImpl(
    JSHeapBroker* broker) const {
  DisallowGarbageCollection no_gc;
  Object o = *object();
  Isolate* isolate = broker->isolate();
  const InstanceType t = GetMapInstanceType();
  if (o.IsTrue(isolate)) {
    return true;
  } else if (o.IsFalse(isolate)) {
    return false;
  } else if (o.IsNullOrUndefined(isolate)) {
    return false;
  } else if (MapRef{broker, map()}.is_undetectable()) {
    return false;  // Undetectable object is false.
  } else if (InstanceTypeChecker::IsString(t)) {
    // TODO(jgruber): Implement in possible cases.
    return {};
  } else if (InstanceTypeChecker::IsHeapNumber(t)) {
    return {};
  } else if (InstanceTypeChecker::IsBigInt(t)) {
    return {};
  }
  return true;
}

InstanceType HeapObjectData::GetMapInstanceType() const {
  ObjectData* map_data = map();
  if (map_data->should_access_heap()) {
    return Handle<Map>::cast(map_data->object())->instance_type();
  }
  return map_data->AsMap()->instance_type();
}

namespace {

bool IsReadOnlyLengthDescriptor(Isolate* isolate, Handle<Map> jsarray_map) {
  DCHECK(!jsarray_map->is_dictionary_map());
  DescriptorArray descriptors =
      jsarray_map->instance_descriptors(isolate, kRelaxedLoad);
  static_assert(
      JSArray::kLengthOffset == JSObject::kHeaderSize,
      "The length should be the first property on the descriptor array");
  InternalIndex offset(0);
  return descriptors.GetDetails(offset).IsReadOnly();
}

// Important: this predicate does not check Protectors::IsNoElementsIntact. The
// compiler checks protectors through the compilation dependency mechanism; it
// doesn't make sense to do that here as part of every MapData construction.
// Callers *must* take care to take the correct dependency themselves.
bool SupportsFastArrayIteration(JSHeapBroker* broker, Handle<Map> map) {
  return map->instance_type() == JS_ARRAY_TYPE &&
         IsFastElementsKind(map->elements_kind()) &&
         map->prototype().IsJSArray() &&
         broker->IsArrayOrObjectPrototype(broker->CanonicalPersistentHandle(
             JSArray::cast(map->prototype())));
}

bool SupportsFastArrayResize(JSHeapBroker* broker, Handle<Map> map) {
  return SupportsFastArrayIteration(broker, map) && map->is_extensible() &&
         !map->is_dictionary_map() &&
         !IsReadOnlyLengthDescriptor(broker->isolate(), map);
}

}  // namespace

MapData::MapData(JSHeapBroker* broker, ObjectData** storage, Handle<Map> object,
                 ObjectDataKind kind)
    : HeapObjectData(broker, storage, object, kind) {
  // This lock ensure that MapData can always be background-serialized, i.e.
  // while the lock is held the Map object may not be modified (except in
  // benign ways).
  // TODO(jgruber): Consider removing this lock by being smrt.
  JSHeapBroker::MapUpdaterGuardIfNeeded mumd_scope(broker);

  // When background serializing the map, we can perform a lite serialization
  // since the MapRef will read some of the Map's fields can be read directly.

  // Even though MapRefs can read {instance_type} directly, other classes depend
  // on {instance_type} being serialized.
  instance_type_ = object->instance_type();
  instance_size_ = object->instance_size();

  // Both bit_field3 (and below bit_field) are special fields: Even though most
  // of the individual bits inside of the bitfield could be read / written
  // non-atomically, the bitfield itself has to use atomic relaxed accessors
  // since some fields since can be modified in live objects.
  // TODO(solanes, v8:7790): Assess if adding the exclusive lock in more places
  // (e.g for set_has_non_instance_prototype) makes sense. Pros: these fields
  // can use the non-atomic accessors. Cons: We would be acquiring an exclusive
  // lock in more places.
  bit_field3_ = object->relaxed_bit_field3();
  unused_property_fields_ = object->UnusedPropertyFields();
  is_abandoned_prototype_map_ = object->is_abandoned_prototype_map();
  in_object_properties_ =
      object->IsJSObjectMap() ? object->GetInObjectProperties() : 0;

  // These fields are only needed to be serialized when not concurrent inlining
  // and thus disabling direct reads.
  if (!broker->is_concurrent_inlining()) {
    bit_field_ = object->relaxed_bit_field();
    bit_field2_ = object->bit_field2();
    can_be_deprecated_ = object->NumberOfOwnDescriptors() > 0
                             ? object->CanBeDeprecated()
                             : false;
    can_transition_ = object->CanTransition();
    in_object_properties_start_in_words_ =
        object->IsJSObjectMap() ? object->GetInObjectPropertiesStartInWords()
                                : 0;
    next_free_property_index_ = object->NextFreePropertyIndex();
    constructor_function_index_ = object->IsPrimitiveMap()
                                      ? object->GetConstructorFunctionIndex()
                                      : Map::kNoConstructorFunctionIndex;
    supports_fast_array_iteration_ = SupportsFastArrayIteration(broker, object);
    supports_fast_array_resize_ = SupportsFastArrayResize(broker, object);
  }
}

class FixedArrayBaseData : public HeapObjectData {
 public:
  FixedArrayBaseData(JSHeapBroker* broker, ObjectData** storage,
                     Handle<FixedArrayBase> object, ObjectDataKind kind)
      : HeapObjectData(broker, storage, object, kind),
        length_(object->length(kAcquireLoad)) {}

  int length() const { return length_; }

 private:
  int const length_;
};

class FixedArrayData : public FixedArrayBaseData {
 public:
  FixedArrayData(JSHeapBroker* broker, ObjectData** storage,
                 Handle<FixedArray> object, ObjectDataKind kind)
      : FixedArrayBaseData(broker, storage, object, kind) {}
};

// Only used in JSNativeContextSpecialization.
class ScriptContextTableData : public FixedArrayData {
 public:
  ScriptContextTableData(JSHeapBroker* broker, ObjectData** storage,
                         Handle<ScriptContextTable> object, ObjectDataKind kind)
      : FixedArrayData(broker, storage, object, kind) {}
};

bool JSBoundFunctionData::Serialize(JSHeapBroker* broker,
                                    NotConcurrentInliningTag tag) {
  DCHECK(!broker->is_concurrent_inlining());

  if (serialized_) return true;
  if (broker->StackHasOverflowed()) return false;

  TraceScope tracer(broker, this, "JSBoundFunctionData::Serialize");
  Handle<JSBoundFunction> function = Handle<JSBoundFunction>::cast(object());

  // We don't immediately set {serialized_} in order to correctly handle the
  // case where a recursive call to this method reaches the stack limit.

  DCHECK_NULL(bound_target_function_);
  bound_target_function_ =
      broker->GetOrCreateData(function->bound_target_function());
  bool serialized_nested = true;
  if (!bound_target_function_->should_access_heap()) {
    if (bound_target_function_->IsJSBoundFunction()) {
      serialized_nested =
          bound_target_function_->AsJSBoundFunction()->Serialize(broker, tag);
    }
  }
  if (!serialized_nested) {
    // We couldn't serialize all nested bound functions due to stack
    // overflow. Give up.
    DCHECK(!serialized_);
    bound_target_function_ = nullptr;  // Reset to sync with serialized_.
    return false;
  }

  serialized_ = true;

  DCHECK_NULL(bound_arguments_);
  bound_arguments_ = broker->GetOrCreateData(function->bound_arguments());

  DCHECK_NULL(bound_this_);
  bound_this_ = broker->GetOrCreateData(function->bound_this());

  return true;
}

JSObjectData::JSObjectData(JSHeapBroker* broker, ObjectData** storage,
                           Handle<JSObject> object, ObjectDataKind kind)
    : JSReceiverData(broker, storage, object, kind),
      inobject_fields_(broker->zone()),
      own_constant_elements_(broker->zone()),
      own_properties_(broker->zone()) {}

class JSArrayData : public JSObjectData {
 public:
  JSArrayData(JSHeapBroker* broker, ObjectData** storage,
              Handle<JSArray> object, ObjectDataKind kind)
      : JSObjectData(broker, storage, object, kind),
        own_elements_(broker->zone()) {}

  void Serialize(JSHeapBroker* broker, NotConcurrentInliningTag tag);
  ObjectData* length() const {
    CHECK(serialized_);
    return length_;
  }

  ObjectData* GetOwnElement(
      JSHeapBroker* broker, uint32_t index,
      SerializationPolicy policy = SerializationPolicy::kAssumeSerialized);

 private:
  bool serialized_ = false;
  ObjectData* length_ = nullptr;

  // Elements (indexed properties) that either
  // (1) are known to exist directly on the object, or
  // (2) are known not to (possibly they don't exist at all).
  // In case (2), the second pair component is nullptr.
  ZoneVector<std::pair<uint32_t, ObjectData*>> own_elements_;
};

void JSArrayData::Serialize(JSHeapBroker* broker,
                            NotConcurrentInliningTag tag) {
  if (serialized_) return;
  serialized_ = true;

  TraceScope tracer(broker, this, "JSArrayData::Serialize");
  Handle<JSArray> jsarray = Handle<JSArray>::cast(object());

  DCHECK_NULL(length_);
  length_ = broker->GetOrCreateData(jsarray->length());
}

ObjectData* JSArrayData::GetOwnElement(JSHeapBroker* broker, uint32_t index,
                                       SerializationPolicy policy) {
  for (auto const& p : own_elements_) {
    if (p.first == index) return p.second;
  }

  if (policy == SerializationPolicy::kAssumeSerialized) {
    TRACE_MISSING(broker, "knowledge about index " << index << " on " << this);
    return nullptr;
  }

  base::Optional<ObjectRef> element =
      GetOwnElementFromHeap(broker, object(), index, false);
  ObjectData* result = element.has_value() ? element->data() : nullptr;
  own_elements_.push_back({index, result});
  return result;
}

class JSGlobalObjectData : public JSObjectData {
 public:
  JSGlobalObjectData(JSHeapBroker* broker, ObjectData** storage,
                     Handle<JSGlobalObject> object, ObjectDataKind kind)
      : JSObjectData(broker, storage, object, kind),
        properties_(broker->zone()) {
    if (!broker->is_concurrent_inlining()) {
      is_detached_ = object->IsDetached();
    }
  }

  bool IsDetached() const {
    return is_detached_;
  }

  ObjectData* GetPropertyCell(
      JSHeapBroker* broker, ObjectData* name,
      SerializationPolicy policy = SerializationPolicy::kAssumeSerialized);

 private:
  // Only valid if not concurrent inlining.
  bool is_detached_ = false;

  // Properties that either
  // (1) are known to exist as property cells on the global object, or
  // (2) are known not to (possibly they don't exist at all).
  // In case (2), the second pair component is nullptr.
  ZoneVector<std::pair<ObjectData*, ObjectData*>> properties_;
};

class JSGlobalProxyData : public JSObjectData {
 public:
  JSGlobalProxyData(JSHeapBroker* broker, ObjectData** storage,
                    Handle<JSGlobalProxy> object, ObjectDataKind kind)
      : JSObjectData(broker, storage, object, kind) {}
};

namespace {

base::Optional<PropertyCellRef> GetPropertyCellFromHeap(JSHeapBroker* broker,
                                                        Handle<Name> name) {
  base::Optional<PropertyCell> maybe_cell =
      ConcurrentLookupIterator::TryGetPropertyCell(
          broker->isolate(), broker->local_isolate_or_isolate(),
          broker->target_native_context().global_object().object(), name);
  if (!maybe_cell.has_value()) return {};
  return TryMakeRef(broker, *maybe_cell);
}

}  // namespace

ObjectData* JSGlobalObjectData::GetPropertyCell(JSHeapBroker* broker,
                                                ObjectData* name,
                                                SerializationPolicy policy) {
  CHECK_NOT_NULL(name);
  for (auto const& p : properties_) {
    if (p.first == name) return p.second;
  }

  if (policy == SerializationPolicy::kAssumeSerialized) {
    TRACE_MISSING(broker, "knowledge about global property " << name);
    return nullptr;
  }

  ObjectData* result = nullptr;
  base::Optional<PropertyCellRef> cell =
      GetPropertyCellFromHeap(broker, Handle<Name>::cast(name->object()));
  if (cell.has_value()) {
    result = cell->data();
    if (!result->should_access_heap()) {
      result->AsPropertyCell()->Cache(broker);
    }
  }
  properties_.push_back({name, result});
  return result;
}

#define DEFINE_IS(Name)                                                 \
  bool ObjectData::Is##Name() const {                                   \
    if (should_access_heap()) {                                         \
      return object()->Is##Name();                                      \
    }                                                                   \
    if (is_smi()) return false;                                         \
    InstanceType instance_type =                                        \
        static_cast<const HeapObjectData*>(this)->GetMapInstanceType(); \
    return InstanceTypeChecker::Is##Name(instance_type);                \
  }
HEAP_BROKER_OBJECT_LIST(DEFINE_IS)
#undef DEFINE_IS

#define DEFINE_AS(Name)                              \
  Name##Data* ObjectData::As##Name() {               \
    CHECK(Is##Name());                               \
    CHECK(kind_ == kBackgroundSerializedHeapObject); \
    return static_cast<Name##Data*>(this);           \
  }
HEAP_BROKER_BACKGROUND_SERIALIZED_OBJECT_LIST(DEFINE_AS)
#undef DEFINE_AS

ObjectData* JSObjectData::GetInobjectField(int property_index) const {
  CHECK_LT(static_cast<size_t>(property_index), inobject_fields_.size());
  return inobject_fields_[property_index];
}

bool JSObjectData::cow_or_empty_elements_tenured() const {
  return cow_or_empty_elements_tenured_;
}

ObjectData* JSObjectData::elements() const {
  CHECK(serialized_elements_);
  return elements_;
}

void JSObjectData::SerializeElements(JSHeapBroker* broker,
                                     NotConcurrentInliningTag) {
  if (serialized_elements_) return;
  serialized_elements_ = true;

  TraceScope tracer(broker, this, "JSObjectData::SerializeElements");
  Handle<JSObject> boilerplate = Handle<JSObject>::cast(object());
  Handle<FixedArrayBase> elements_object(boilerplate->elements(),
                                         broker->isolate());
  DCHECK_NULL(elements_);
  elements_ = broker->GetOrCreateData(elements_object);
  DCHECK(elements_->IsFixedArrayBase());
}

void MapData::SerializeConstructor(JSHeapBroker* broker,
                                   NotConcurrentInliningTag tag) {
  if (serialized_constructor_) return;
  serialized_constructor_ = true;

  TraceScope tracer(broker, this, "MapData::SerializeConstructor");
  Handle<Map> map = Handle<Map>::cast(object());
  DCHECK(!map->IsContextMap());
  DCHECK_NULL(constructor_);
  constructor_ = broker->GetOrCreateData(map->GetConstructor());
}

void MapData::SerializeBackPointer(JSHeapBroker* broker,
                                   NotConcurrentInliningTag tag) {
  if (serialized_backpointer_) return;
  serialized_backpointer_ = true;

  TraceScope tracer(broker, this, "MapData::SerializeBackPointer");
  Handle<Map> map = Handle<Map>::cast(object());
  DCHECK_NULL(backpointer_);
  DCHECK(!map->IsContextMap());
  backpointer_ = broker->GetOrCreateData(map->GetBackPointer());
}

bool MapData::TrySerializePrototype(JSHeapBroker* broker,
                                    NotConcurrentInliningTag tag) {
  if (serialized_prototype_) return true;

  TraceScope tracer(broker, this, "MapData::SerializePrototype");
  Handle<Map> map = Handle<Map>::cast(object());
  DCHECK_NULL(prototype_);
  prototype_ = broker->TryGetOrCreateData(map->prototype());
  if (prototype_ == nullptr) return false;
  serialized_prototype_ = true;
  return true;
}

void MapData::SerializeRootMap(JSHeapBroker* broker,
                               NotConcurrentInliningTag tag) {
  if (serialized_root_map_) return;
  serialized_root_map_ = true;

  TraceScope tracer(broker, this, "MapData::SerializeRootMap");
  Handle<Map> map = Handle<Map>::cast(object());
  DCHECK_NULL(root_map_);
  root_map_ = broker->GetOrCreateData(map->FindRootMap(broker->isolate()));
}

ObjectData* MapData::FindRootMap() const { return root_map_; }

bool JSObjectData::SerializeAsBoilerplateRecursive(JSHeapBroker* broker,
                                                   NotConcurrentInliningTag tag,
                                                   int max_depth) {
  if (serialized_as_boilerplate_) return true;
  // If serialization succeeds, we set this to true at the end.

  TraceScope tracer(broker, this,
                    "JSObjectData::SerializeAsBoilerplateRecursive");
  Handle<JSObject> boilerplate = Handle<JSObject>::cast(object());

  DCHECK_GE(max_depth, 0);
  if (max_depth == 0) return false;

  // Serialize the elements.
  Isolate* const isolate = broker->isolate();
  Handle<FixedArrayBase> elements_object(boilerplate->elements(), isolate);

  // Boilerplate objects should only be reachable from their allocation site,
  // so it is safe to assume that the elements have not been serialized yet.

  bool const empty_or_cow =
      elements_object->length() == 0 ||
      elements_object->map() == ReadOnlyRoots(isolate).fixed_cow_array_map();
  if (empty_or_cow) {
    cow_or_empty_elements_tenured_ = !ObjectInYoungGeneration(*elements_object);
  }

  raw_properties_or_hash_ =
      broker->GetOrCreateData(boilerplate->raw_properties_or_hash());

  serialized_elements_ = true;
  elements_ = broker->GetOrCreateData(elements_object);
  DCHECK(elements_->IsFixedArrayBase());

  if (!boilerplate->HasFastProperties() ||
      boilerplate->property_array().length() != 0) {
    return false;
  }

  // Check the in-object properties.
  inobject_fields_.clear();
  Handle<DescriptorArray> descriptors(
      boilerplate->map().instance_descriptors(isolate), isolate);
  for (InternalIndex i : boilerplate->map().IterateOwnDescriptors()) {
    PropertyDetails details = descriptors->GetDetails(i);
    if (details.location() != kField) continue;
    DCHECK_EQ(kData, details.kind());

    FieldIndex field_index = FieldIndex::ForDescriptor(boilerplate->map(), i);
    // Make sure {field_index} agrees with {inobject_properties} on the index of
    // this field.
    DCHECK_EQ(field_index.property_index(),
              static_cast<int>(inobject_fields_.size()));
    Handle<Object> value(boilerplate->RawFastPropertyAt(field_index), isolate);
    ObjectData* value_data = broker->GetOrCreateData(value);
    inobject_fields_.push_back(value_data);
    if (value_data->IsJSObject() && !value_data->should_access_heap()) {
      if (!value_data->AsJSObject()->SerializeAsBoilerplateRecursive(
              broker, tag, max_depth - 1))
        return false;
    }
  }
  TRACE(broker, "Copied " << inobject_fields_.size() << " in-object fields");

  if (empty_or_cow || elements_->should_access_heap()) {
    // No need to do anything here. Empty or copy-on-write elements
    // do not need to be serialized because we only need to store the elements
    // reference to the allocated object.
  } else if (boilerplate->HasSmiOrObjectElements()) {
    Handle<FixedArray> fast_elements =
        Handle<FixedArray>::cast(elements_object);
    int length = elements_object->length();
    for (int i = 0; i < length; i++) {
      Handle<Object> value(fast_elements->get(i), isolate);
      if (value->IsJSObject()) {
        ObjectData* value_data = broker->GetOrCreateData(value);
        if (!value_data->should_access_heap()) {
          if (!value_data->AsJSObject()->SerializeAsBoilerplateRecursive(
                  broker, tag, max_depth - 1)) {
            return false;
          }
        }
      }
    }
  } else {
    if (!boilerplate->HasDoubleElements()) return false;
    int const size = FixedDoubleArray::SizeFor(elements_object->length());
    if (size > kMaxRegularHeapObjectSize) return false;
  }

  if (IsJSArray() && !broker->is_concurrent_inlining()) {
    AsJSArray()->Serialize(broker, NotConcurrentInliningTag{broker});
  }

  serialized_as_boilerplate_ = true;
  return true;
}

bool ObjectRef::equals(const ObjectRef& other) const {
  return data_ == other.data_;
}

Isolate* ObjectRef::isolate() const { return broker()->isolate(); }

ContextRef ContextRef::previous(size_t* depth) const {
  DCHECK_NOT_NULL(depth);

  Context current = *object();
  while (*depth != 0 && current.unchecked_previous().IsContext()) {
    current = Context::cast(current.unchecked_previous());
    (*depth)--;
  }
  // The `previous` field is immutable after initialization and the
  // context itself is read through an atomic load.
  return MakeRefAssumeMemoryFence(broker(), current);
}

base::Optional<ObjectRef> ContextRef::get(int index) const {
  CHECK_LE(0, index);
  // Length is immutable after initialization.
  if (index >= object()->length(kRelaxedLoad)) return {};
  return TryMakeRef(broker(), object()->get(index));
}

void JSHeapBroker::InitializeAndStartSerializing() {
  TraceScope tracer(this, "JSHeapBroker::InitializeAndStartSerializing");

  CHECK_EQ(mode_, kDisabled);
  mode_ = kSerializing;

  // Throw away the dummy data that we created while disabled.
  feedback_.clear();
  refs_->Clear();
  refs_ =
      zone()->New<RefsMap>(kInitialRefsBucketCount, AddressMatcher(), zone());

  CollectArrayAndObjectPrototypes();

  SetTargetNativeContextRef(target_native_context().object());
  if (!is_concurrent_inlining()) {
    target_native_context().Serialize(NotConcurrentInliningTag{this});

    Factory* const f = isolate()->factory();
    ObjectData* data;
    data = GetOrCreateData(f->array_buffer_detaching_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->array_constructor_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->array_iterator_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->array_species_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->no_elements_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->promise_hook_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->promise_species_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->promise_then_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    data = GetOrCreateData(f->string_length_protector());
    if (!data->should_access_heap()) {
      data->AsPropertyCell()->Cache(this);
    }
    GetOrCreateData(f->many_closures_cell());
    GetOrCreateData(CodeFactory::CEntry(isolate(), 1, SaveFPRegsMode::kIgnore,
                                        ArgvMode::kStack, true));
    TRACE(this, "Finished serializing standard objects");
  }
}

namespace {

constexpr ObjectDataKind ObjectDataKindFor(RefSerializationKind kind) {
  switch (kind) {
    case RefSerializationKind::kBackgroundSerialized:
      return kBackgroundSerializedHeapObject;
    case RefSerializationKind::kNeverSerialized:
      return kNeverSerializedHeapObject;
  }
}

}  // namespace

ObjectData* JSHeapBroker::TryGetOrCreateData(Handle<Object> object,
                                             GetOrCreateDataFlags flags) {
  RefsMap::Entry* entry = refs_->Lookup(object.address());
  if (entry != nullptr) return entry->value;

  if (mode() == JSHeapBroker::kDisabled) {
    entry = refs_->LookupOrInsert(object.address());
    ObjectData** storage = &entry->value;
    if (*storage == nullptr) {
      entry->value = zone()->New<ObjectData>(
          this, storage, object,
          object->IsSmi() ? kSmi : kUnserializedHeapObject);
    }
    return *storage;
  }

  CHECK(mode() == JSHeapBroker::kSerializing ||
        mode() == JSHeapBroker::kSerialized);

  ObjectData* object_data;
  if (object->IsSmi()) {
    entry = refs_->LookupOrInsert(object.address());
    return zone()->New<ObjectData>(this, &entry->value, object, kSmi);
  }

  DCHECK(!object->IsSmi());

  const bool crash_on_error = (flags & kCrashOnError) != 0;

  if ((flags & kAssumeMemoryFence) == 0 &&
      ObjectMayBeUninitialized(HeapObject::cast(*object))) {
    TRACE_BROKER_MISSING(this, "Object may be uninitialized " << *object);
    CHECK_WITH_MSG(!crash_on_error, "Ref construction failed");
    return nullptr;
  }

  if (IsReadOnlyHeapObjectForCompiler(HeapObject::cast(*object))) {
    entry = refs_->LookupOrInsert(object.address());
    return zone()->New<ObjectData>(this, &entry->value, object,
                                   kUnserializedReadOnlyHeapObject);
  }

#define CREATE_DATA(Name)                                             \
  if (object->Is##Name()) {                                           \
    RefsMap::Entry* entry = refs_->LookupOrInsert(object.address());  \
    object_data = zone()->New<ref_traits<Name>::data_type>(           \
        this, &entry->value, Handle<Name>::cast(object),              \
        ObjectDataKindFor(ref_traits<Name>::ref_serialization_kind)); \
    /* NOLINTNEXTLINE(readability/braces) */                          \
  } else
  HEAP_BROKER_OBJECT_LIST(CREATE_DATA)
#undef CREATE_DATA
  {
    UNREACHABLE();
  }
  // At this point the entry pointer is not guaranteed to be valid as
  // the refs_ hash hable could be resized by one of the constructors above.
  DCHECK_EQ(object_data, refs_->Lookup(object.address())->value);
  return object_data;
}

#define DEFINE_IS_AND_AS(Name)                                    \
  bool ObjectRef::Is##Name() const { return data()->Is##Name(); } \
  Name##Ref ObjectRef::As##Name() const {                         \
    DCHECK(Is##Name());                                           \
    return Name##Ref(broker(), data());                           \
  }
HEAP_BROKER_OBJECT_LIST(DEFINE_IS_AND_AS)
#undef DEFINE_IS_AND_AS

bool ObjectRef::IsSmi() const { return data()->is_smi(); }

int ObjectRef::AsSmi() const {
  DCHECK(IsSmi());
  // Handle-dereference is always allowed for Handle<Smi>.
  return Handle<Smi>::cast(object())->value();
}

#define DEF_TESTER(Type, ...)                              \
  bool MapRef::Is##Type##Map() const {                     \
    return InstanceTypeChecker::Is##Type(instance_type()); \
  }
INSTANCE_TYPE_CHECKERS(DEF_TESTER)
#undef DEF_TESTER

base::Optional<MapRef> MapRef::AsElementsKind(ElementsKind kind) const {
  const ElementsKind current_kind = elements_kind();
  if (kind == current_kind) return *this;

  base::Optional<Map> maybe_result = Map::TryAsElementsKind(
      broker()->isolate(), object(), kind, ConcurrencyMode::kConcurrent);

#ifdef DEBUG
  // If starting from an initial JSArray map, TryAsElementsKind must succeed
  // and return the expected transitioned JSArray map.
  NativeContextRef native_context = broker()->target_native_context();
  if (equals(native_context.GetInitialJSArrayMap(current_kind))) {
    CHECK_EQ(Map::TryAsElementsKind(broker()->isolate(), object(), kind,
                                    ConcurrencyMode::kConcurrent)
                 .value(),
             *native_context.GetInitialJSArrayMap(kind).object());
  }
#endif  // DEBUG

  if (!maybe_result.has_value()) {
    TRACE_BROKER_MISSING(broker(), "MapRef::AsElementsKind " << *this);
    return {};
  }
  return MakeRefAssumeMemoryFence(broker(), maybe_result.value());
}

void MapRef::SerializeForElementStore(NotConcurrentInliningTag tag) {
  if (data()->should_access_heap()) return;
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  data()->AsMap()->SerializeForElementStore(broker(), tag);
}

void MapData::SerializeForElementStore(JSHeapBroker* broker,
                                       NotConcurrentInliningTag tag) {
  if (serialized_for_element_store_) return;
  serialized_for_element_store_ = true;

  TraceScope tracer(broker, this, "MapData::SerializeForElementStore");
  // TODO(solanes, v8:7790): This should use MapData methods rather than
  // constructing MapRefs, but it involves non-trivial refactoring and this
  // method should go away anyway once the compiler is fully concurrent.
  MapRef map(broker, this);
  do {
    map.SerializePrototype(tag);
    map = map.prototype().value().map();
  } while (map.IsJSObjectMap() && map.is_stable() &&
           IsFastElementsKind(map.elements_kind()));
}

bool MapRef::HasOnlyStablePrototypesWithFastElements(
    ZoneVector<MapRef>* prototype_maps) {
  DCHECK_NOT_NULL(prototype_maps);
  MapRef prototype_map = prototype().value().map();
  while (prototype_map.oddball_type() != OddballType::kNull) {
    if (!prototype_map.IsJSObjectMap() || !prototype_map.is_stable() ||
        !IsFastElementsKind(prototype_map.elements_kind())) {
      return false;
    }
    prototype_maps->push_back(prototype_map);
    prototype_map = prototype_map.prototype().value().map();
  }
  return true;
}

bool MapRef::supports_fast_array_iteration() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return SupportsFastArrayIteration(broker(), object());
  }
  return data()->AsMap()->supports_fast_array_iteration();
}

bool MapRef::supports_fast_array_resize() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return SupportsFastArrayResize(broker(), object());
  }
  return data()->AsMap()->supports_fast_array_resize();
}

namespace {

void RecordConsistentJSFunctionViewDependencyIfNeeded(
    const JSHeapBroker* broker, const JSFunctionRef& ref, JSFunctionData* data,
    JSFunctionData::UsedField used_field) {
  if (!broker->is_concurrent_inlining()) return;
  if (!data->has_any_used_field()) {
    // Deduplicate dependencies.
    broker->dependencies()->DependOnConsistentJSFunctionView(ref);
  }
  data->set_used_field(used_field);
}

}  // namespace

int JSFunctionRef::InitialMapInstanceSizeWithMinSlack(
    CompilationDependencies* dependencies) const {
  if (data_->should_access_heap()) {
    return object()->ComputeInstanceSizeWithMinSlack(broker()->isolate());
  }
  RecordConsistentJSFunctionViewDependencyIfNeeded(
      broker(), *this, data()->AsJSFunction(),
      JSFunctionData::kInitialMapInstanceSizeWithMinSlack);
  return data()->AsJSFunction()->initial_map_instance_size_with_min_slack();
}

OddballType MapRef::oddball_type() const {
  if (instance_type() != ODDBALL_TYPE) {
    return OddballType::kNone;
  }
  Factory* f = broker()->isolate()->factory();
  if (equals(MakeRef(broker(), f->undefined_map()))) {
    return OddballType::kUndefined;
  }
  if (equals(MakeRef(broker(), f->null_map()))) {
    return OddballType::kNull;
  }
  if (equals(MakeRef(broker(), f->boolean_map()))) {
    return OddballType::kBoolean;
  }
  if (equals(MakeRef(broker(), f->the_hole_map()))) {
    return OddballType::kHole;
  }
  if (equals(MakeRef(broker(), f->uninitialized_map()))) {
    return OddballType::kUninitialized;
  }
  DCHECK(equals(MakeRef(broker(), f->termination_exception_map())) ||
         equals(MakeRef(broker(), f->arguments_marker_map())) ||
         equals(MakeRef(broker(), f->optimized_out_map())) ||
         equals(MakeRef(broker(), f->stale_register_map())));
  return OddballType::kOther;
}

FeedbackCellRef FeedbackVectorRef::GetClosureFeedbackCell(int index) const {
  return MakeRefAssumeMemoryFence(broker(),
                                  object()->closure_feedback_cell(index));
}

base::Optional<ObjectRef> JSObjectRef::raw_properties_or_hash() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return TryMakeRef(broker(), object()->raw_properties_or_hash());
  }
  return ObjectRef(broker(), data()->AsJSObject()->raw_properties_or_hash());
}

base::Optional<ObjectRef> JSObjectRef::RawInobjectPropertyAt(
    FieldIndex index) const {
  CHECK(index.is_inobject());
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    Handle<Object> value;
    {
      DisallowGarbageCollection no_gc;
      Map current_map = object()->map(kAcquireLoad);

      // If the map changed in some prior GC epoch, our {index} could be
      // outside the valid bounds of the cached map.
      if (*map().object() != current_map) {
        TRACE_BROKER_MISSING(broker(), "Map change detected in " << *this);
        return {};
      }

      base::Optional<Object> maybe_value =
          object()->RawInobjectPropertyAt(current_map, index);
      if (!maybe_value.has_value()) {
        TRACE_BROKER_MISSING(broker(),
                             "Unable to safely read property in " << *this);
        return {};
      }
      value = broker()->CanonicalPersistentHandle(maybe_value.value());
    }
    return TryMakeRef(broker(), value);
  }
  JSObjectData* object_data = data()->AsJSObject();
  return ObjectRef(broker(),
                   object_data->GetInobjectField(index.property_index()));
}

void JSObjectRef::SerializeAsBoilerplateRecursive(
    NotConcurrentInliningTag tag) {
  if (data_->should_access_heap()) return;
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  data()->AsJSObject()->SerializeAsBoilerplateRecursive(broker(), tag);
}

void AllocationSiteRef::SerializeRecursive(NotConcurrentInliningTag tag) {
  DCHECK(data_->should_access_heap());
  if (broker()->mode() == JSHeapBroker::kDisabled) return;
  DCHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  if (boilerplate().has_value()) {
    boilerplate()->SerializeAsBoilerplateRecursive(tag);
  }
  if (nested_site().IsAllocationSite()) {
    nested_site().AsAllocationSite().SerializeRecursive(tag);
  }
}

void JSObjectRef::SerializeElements(NotConcurrentInliningTag tag) {
  if (data_->should_access_heap()) return;
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  data()->AsJSObject()->SerializeElements(broker(), tag);
}

bool JSObjectRef::IsElementsTenured(const FixedArrayBaseRef& elements) {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return !ObjectInYoungGeneration(*elements.object());
  }
  return data()->AsJSObject()->cow_or_empty_elements_tenured();
}

FieldIndex MapRef::GetFieldIndexFor(InternalIndex descriptor_index) const {
  CHECK_LT(descriptor_index.as_int(), NumberOfOwnDescriptors());
  FieldIndex result = FieldIndex::ForDescriptor(*object(), descriptor_index);
  DCHECK(result.is_inobject());
  return result;
}

int MapRef::GetInObjectPropertyOffset(int i) const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return object()->GetInObjectPropertyOffset(i);
  }
  return (GetInObjectPropertiesStartInWords() + i) * kTaggedSize;
}

PropertyDetails MapRef::GetPropertyDetails(
    InternalIndex descriptor_index) const {
  CHECK_LT(descriptor_index.as_int(), NumberOfOwnDescriptors());
  return instance_descriptors().GetPropertyDetails(descriptor_index);
}

NameRef MapRef::GetPropertyKey(InternalIndex descriptor_index) const {
  CHECK_LT(descriptor_index.as_int(), NumberOfOwnDescriptors());
  return instance_descriptors().GetPropertyKey(descriptor_index);
}

bool MapRef::IsFixedCowArrayMap() const {
  Handle<Map> fixed_cow_array_map =
      ReadOnlyRoots(broker()->isolate()).fixed_cow_array_map_handle();
  return equals(MakeRef(broker(), fixed_cow_array_map));
}

bool MapRef::IsPrimitiveMap() const {
  return instance_type() <= LAST_PRIMITIVE_HEAP_OBJECT_TYPE;
}

MapRef MapRef::FindFieldOwner(InternalIndex descriptor_index) const {
  CHECK_LT(descriptor_index.as_int(), NumberOfOwnDescriptors());
  // TODO(solanes, v8:7790): Consider caching the result of the field owner on
  // the descriptor array. It would be useful for same map as well as any
  // other map sharing that descriptor array.
  return MakeRefAssumeMemoryFence(
      broker(),
      object()->FindFieldOwner(broker()->isolate(), descriptor_index));
}

ObjectRef MapRef::GetFieldType(InternalIndex descriptor_index) const {
  CHECK_LT(descriptor_index.as_int(), NumberOfOwnDescriptors());
  return instance_descriptors().GetFieldType(descriptor_index);
}

base::Optional<ObjectRef> StringRef::GetCharAsStringOrUndefined(
    uint32_t index, SerializationPolicy policy) const {
  if (broker()->is_concurrent_inlining()) {
    String maybe_char;
    auto result = ConcurrentLookupIterator::TryGetOwnChar(
        &maybe_char, broker()->isolate(), broker()->local_isolate(), *object(),
        index);

    if (result == ConcurrentLookupIterator::kGaveUp) {
      TRACE_BROKER_MISSING(broker(), "StringRef::GetCharAsStringOrUndefined on "
                                         << *this << " at index " << index);
      return {};
    }

    DCHECK_EQ(result, ConcurrentLookupIterator::kPresent);
    return TryMakeRef(broker(), maybe_char);
  }

  CHECK_EQ(data_->kind(), ObjectDataKind::kUnserializedHeapObject);
  return GetOwnElementFromHeap(broker(), object(), index, true);
}

bool StringRef::SupportedStringKind() const {
  if (!broker()->is_concurrent_inlining()) return true;
  return IsInternalizedString() || object()->IsThinString();
}

base::Optional<int> StringRef::length() const {
  if (data_->kind() == kNeverSerializedHeapObject && !SupportedStringKind()) {
    TRACE_BROKER_MISSING(
        broker(),
        "length for kNeverSerialized unsupported string kind " << *this);
    return base::nullopt;
  } else {
    return object()->length(kAcquireLoad);
  }
}

base::Optional<uint16_t> StringRef::GetFirstChar() {
  if (data_->kind() == kNeverSerializedHeapObject && !SupportedStringKind()) {
    TRACE_BROKER_MISSING(
        broker(),
        "first char for kNeverSerialized unsupported string kind " << *this);
    return base::nullopt;
  }

  if (!broker()->IsMainThread()) {
    return object()->Get(0, broker()->local_isolate());
  } else {
    // TODO(solanes, v8:7790): Remove this case once the inlining phase is
    // done concurrently all the time.
    return object()->Get(0);
  }
}

base::Optional<double> StringRef::ToNumber() {
  if (data_->kind() == kNeverSerializedHeapObject && !SupportedStringKind()) {
    TRACE_BROKER_MISSING(
        broker(),
        "number for kNeverSerialized unsupported string kind " << *this);
    return base::nullopt;
  }

  return TryStringToDouble(broker()->local_isolate(), object());
}

int ArrayBoilerplateDescriptionRef::constants_elements_length() const {
  return object()->constant_elements().length();
}

ObjectRef FixedArrayRef::get(int i) const { return TryGet(i).value(); }

base::Optional<ObjectRef> FixedArrayRef::TryGet(int i) const {
  Handle<Object> value;
  {
    DisallowGarbageCollection no_gc;
    CHECK_GE(i, 0);
    value = broker()->CanonicalPersistentHandle(object()->get(i, kAcquireLoad));
    if (i >= object()->length(kAcquireLoad)) {
      // Right-trimming happened.
      CHECK_LT(i, length());
      return {};
    }
  }
  return TryMakeRef(broker(), value);
}

Float64 FixedDoubleArrayRef::GetFromImmutableFixedDoubleArray(int i) const {
  STATIC_ASSERT(ref_traits<FixedDoubleArray>::ref_serialization_kind ==
                RefSerializationKind::kNeverSerialized);
  CHECK(data_->should_access_heap());
  return Float64::FromBits(object()->get_representation(i));
}

Handle<ByteArray> BytecodeArrayRef::SourcePositionTable() const {
  return broker()->CanonicalPersistentHandle(object()->SourcePositionTable());
}

Address BytecodeArrayRef::handler_table_address() const {
  return reinterpret_cast<Address>(
      object()->handler_table().GetDataStartAddress());
}

int BytecodeArrayRef::handler_table_size() const {
  return object()->handler_table().length();
}

#define IF_ACCESS_FROM_HEAP_C(name)  \
  if (data_->should_access_heap()) { \
    return object()->name();         \
  }

#define IF_ACCESS_FROM_HEAP(result, name)                     \
  if (data_->should_access_heap()) {                          \
    return MakeRef(broker(), result::cast(object()->name())); \
  }

// Macros for definining a const getter that, depending on the data kind,
// either looks into the heap or into the serialized data.
#define BIMODAL_ACCESSOR(holder, result, name)                             \
  result##Ref holder##Ref::name() const {                                  \
    IF_ACCESS_FROM_HEAP(result, name);                                     \
    return result##Ref(broker(), ObjectRef::data()->As##holder()->name()); \
  }

// Like above except that the result type is not an XYZRef.
#define BIMODAL_ACCESSOR_C(holder, result, name)    \
  result holder##Ref::name() const {                \
    IF_ACCESS_FROM_HEAP_C(name);                    \
    return ObjectRef::data()->As##holder()->name(); \
  }

// Like above but for BitFields.
#define BIMODAL_ACCESSOR_B(holder, field, name, BitField)              \
  typename BitField::FieldType holder##Ref::name() const {             \
    IF_ACCESS_FROM_HEAP_C(name);                                       \
    return BitField::decode(ObjectRef::data()->As##holder()->field()); \
  }

// Like IF_ACCESS_FROM_HEAP[_C] but we also allow direct heap access for
// kBackgroundSerialized only for methods that we identified to be safe.
#define IF_ACCESS_FROM_HEAP_WITH_FLAG(result, name)                        \
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) { \
    return MakeRef(broker(), result::cast(object()->name()));              \
  }
#define IF_ACCESS_FROM_HEAP_WITH_FLAG_C(name)                              \
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) { \
    return object()->name();                                               \
  }

// Like BIMODAL_ACCESSOR[_C] except that we force a direct heap access if
// broker()->is_concurrent_inlining() is true (even for kBackgroundSerialized).
// This is because we identified the method to be safe to use direct heap
// access, but the holder##Data class still needs to be serialized.
#define BIMODAL_ACCESSOR_WITH_FLAG(holder, result, name)                   \
  result##Ref holder##Ref::name() const {                                  \
    IF_ACCESS_FROM_HEAP_WITH_FLAG(result, name);                           \
    return result##Ref(broker(), ObjectRef::data()->As##holder()->name()); \
  }
#define BIMODAL_ACCESSOR_WITH_FLAG_C(holder, result, name) \
  result holder##Ref::name() const {                       \
    IF_ACCESS_FROM_HEAP_WITH_FLAG_C(name);                 \
    return ObjectRef::data()->As##holder()->name();        \
  }
#define BIMODAL_ACCESSOR_WITH_FLAG_B(holder, field, name, BitField)    \
  typename BitField::FieldType holder##Ref::name() const {             \
    IF_ACCESS_FROM_HEAP_WITH_FLAG_C(name);                             \
    return BitField::decode(ObjectRef::data()->As##holder()->field()); \
  }

#define HEAP_ACCESSOR_C(holder, result, name) \
  result holder##Ref::name() const { return object()->name(); }

ObjectRef AllocationSiteRef::nested_site() const {
  return MakeRefAssumeMemoryFence(broker(), object()->nested_site());
}

HEAP_ACCESSOR_C(AllocationSite, bool, CanInlineCall)
HEAP_ACCESSOR_C(AllocationSite, bool, PointsToLiteral)
HEAP_ACCESSOR_C(AllocationSite, ElementsKind, GetElementsKind)
HEAP_ACCESSOR_C(AllocationSite, AllocationType, GetAllocationType)

BIMODAL_ACCESSOR_C(BigInt, uint64_t, AsUint64)

int BytecodeArrayRef::register_count() const {
  return object()->register_count();
}
int BytecodeArrayRef::parameter_count() const {
  return object()->parameter_count();
}
interpreter::Register
BytecodeArrayRef::incoming_new_target_or_generator_register() const {
  return object()->incoming_new_target_or_generator_register();
}

BIMODAL_ACCESSOR(HeapObject, Map, map)

HEAP_ACCESSOR_C(HeapNumber, double, value)

uint64_t HeapNumberRef::value_as_bits() const {
  return object()->value_as_bits(kRelaxedLoad);
}

base::Optional<JSReceiverRef> JSBoundFunctionRef::bound_target_function()
    const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Immutable after initialization.
    return TryMakeRef(broker(), object()->bound_target_function(),
                      kAssumeMemoryFence);
  }
  return TryMakeRef<JSReceiver>(
      broker(), data()->AsJSBoundFunction()->bound_target_function());
}
base::Optional<ObjectRef> JSBoundFunctionRef::bound_this() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Immutable after initialization.
    return TryMakeRef(broker(), object()->bound_this(), kAssumeMemoryFence);
  }
  return TryMakeRef<Object>(broker(),
                            data()->AsJSBoundFunction()->bound_this());
}
FixedArrayRef JSBoundFunctionRef::bound_arguments() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Immutable after initialization.
    return MakeRefAssumeMemoryFence(broker(), object()->bound_arguments());
  }
  return FixedArrayRef(broker(),
                       data()->AsJSBoundFunction()->bound_arguments());
}

// Immutable after initialization.
BIMODAL_ACCESSOR_WITH_FLAG_C(JSDataView, size_t, byte_length)

BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field2, elements_kind,
                             Map::Bits2::ElementsKindBits)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field3, is_dictionary_map,
                             Map::Bits3::IsDictionaryMapBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field3, is_deprecated,
                             Map::Bits3::IsDeprecatedBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field3, NumberOfOwnDescriptors,
                             Map::Bits3::NumberOfOwnDescriptorsBits)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field3, is_migration_target,
                             Map::Bits3::IsMigrationTargetBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field, has_prototype_slot,
                             Map::Bits1::HasPrototypeSlotBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field, is_access_check_needed,
                             Map::Bits1::IsAccessCheckNeededBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field, is_callable,
                             Map::Bits1::IsCallableBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field, has_indexed_interceptor,
                             Map::Bits1::HasIndexedInterceptorBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field, is_constructor,
                             Map::Bits1::IsConstructorBit)
BIMODAL_ACCESSOR_WITH_FLAG_B(Map, bit_field, is_undetectable,
                             Map::Bits1::IsUndetectableBit)
BIMODAL_ACCESSOR_C(Map, int, instance_size)
BIMODAL_ACCESSOR_WITH_FLAG_C(Map, int, NextFreePropertyIndex)
BIMODAL_ACCESSOR_C(Map, int, UnusedPropertyFields)
BIMODAL_ACCESSOR_WITH_FLAG_C(Map, InstanceType, instance_type)
BIMODAL_ACCESSOR_WITH_FLAG(Map, Object, GetConstructor)
BIMODAL_ACCESSOR_WITH_FLAG(Map, HeapObject, GetBackPointer)
BIMODAL_ACCESSOR_C(Map, bool, is_abandoned_prototype_map)

int ObjectBoilerplateDescriptionRef::size() const { return object()->size(); }

BIMODAL_ACCESSOR(PropertyCell, Object, value)
BIMODAL_ACCESSOR_C(PropertyCell, PropertyDetails, property_details)

FixedArrayRef RegExpBoilerplateDescriptionRef::data() const {
  // Immutable after initialization.
  return MakeRefAssumeMemoryFence(broker(), object()->data());
}

StringRef RegExpBoilerplateDescriptionRef::source() const {
  // Immutable after initialization.
  return MakeRefAssumeMemoryFence(broker(), object()->source());
}

int RegExpBoilerplateDescriptionRef::flags() const { return object()->flags(); }

base::Optional<CallHandlerInfoRef> FunctionTemplateInfoRef::call_code() const {
  HeapObject call_code = object()->call_code(kAcquireLoad);
  if (call_code.IsUndefined()) return base::nullopt;
  return TryMakeRef(broker(), CallHandlerInfo::cast(call_code));
}

bool FunctionTemplateInfoRef::is_signature_undefined() const {
  return object()->signature().IsUndefined(broker()->isolate());
}

bool FunctionTemplateInfoRef::has_call_code() const {
  HeapObject call_code = object()->call_code(kAcquireLoad);
  return !call_code.IsUndefined();
}

HEAP_ACCESSOR_C(FunctionTemplateInfo, bool, accept_any_receiver)

HolderLookupResult FunctionTemplateInfoRef::LookupHolderOfExpectedType(
    MapRef receiver_map, SerializationPolicy policy) {
  const HolderLookupResult not_found;
  // There are currently two ways we can see a FunctionTemplateInfo on the
  // background thread: 1.) As part of a SharedFunctionInfo and 2.) in an
  // AccessorPair. In both cases, the FTI is fully constructed on the main
  // thread before.
  // TODO(nicohartmann@, v8:7790): Once the above no longer holds, we might
  // have to use the GC predicate to check whether objects are fully
  // initialized and safe to read.
  if (!receiver_map.IsJSReceiverMap() ||
      (receiver_map.is_access_check_needed() &&
       !object()->accept_any_receiver())) {
    return not_found;
  }

  if (!receiver_map.IsJSObjectMap()) return not_found;

  DCHECK(has_call_code());

  Handle<FunctionTemplateInfo> expected_receiver_type;
  {
    DisallowGarbageCollection no_gc;
    HeapObject signature = object()->signature();
    if (signature.IsUndefined()) {
      return HolderLookupResult(CallOptimization::kHolderIsReceiver);
    }
    expected_receiver_type = broker()->CanonicalPersistentHandle(
        FunctionTemplateInfo::cast(signature));
    if (expected_receiver_type->IsTemplateFor(*receiver_map.object())) {
      return HolderLookupResult(CallOptimization::kHolderIsReceiver);
    }

    if (!receiver_map.IsJSGlobalProxyMap()) return not_found;
  }

  if (policy == SerializationPolicy::kSerializeIfNeeded) {
    receiver_map.SerializePrototype(NotConcurrentInliningTag{broker()});
  }
  base::Optional<HeapObjectRef> prototype = receiver_map.prototype();
  if (!prototype.has_value()) return not_found;
  if (prototype->IsNull()) return not_found;

  if (!expected_receiver_type->IsTemplateFor(prototype->object()->map())) {
    return not_found;
  }
  return HolderLookupResult(CallOptimization::kHolderFound,
                            prototype->AsJSObject());
}

ObjectRef CallHandlerInfoRef::data() const {
  return MakeRefAssumeMemoryFence(broker(), object()->data());
}

HEAP_ACCESSOR_C(ScopeInfo, int, ContextLength)
HEAP_ACCESSOR_C(ScopeInfo, bool, HasContextExtensionSlot)
HEAP_ACCESSOR_C(ScopeInfo, bool, HasOuterScopeInfo)

ScopeInfoRef ScopeInfoRef::OuterScopeInfo() const {
  return MakeRefAssumeMemoryFence(broker(), object()->OuterScopeInfo());
}

HEAP_ACCESSOR_C(SharedFunctionInfo, Builtin, builtin_id)

BytecodeArrayRef SharedFunctionInfoRef::GetBytecodeArray() const {
  BytecodeArray bytecode_array;
  if (!broker()->IsMainThread()) {
    bytecode_array = object()->GetBytecodeArray(broker()->local_isolate());
  } else {
    bytecode_array = object()->GetBytecodeArray(broker()->isolate());
  }
  return MakeRefAssumeMemoryFence(broker(), bytecode_array);
}

#define DEF_SFI_ACCESSOR(type, name) \
  HEAP_ACCESSOR_C(SharedFunctionInfo, type, name)
BROKER_SFI_FIELDS(DEF_SFI_ACCESSOR)
#undef DEF_SFI_ACCESSOR

SharedFunctionInfo::Inlineability SharedFunctionInfoRef::GetInlineability()
    const {
  return broker()->IsMainThread()
             ? object()->GetInlineability(broker()->isolate(),
                                          broker()->is_turboprop())
             : object()->GetInlineability(broker()->local_isolate(),
                                          broker()->is_turboprop());
}

base::Optional<FeedbackVectorRef> FeedbackCellRef::value() const {
  DisallowGarbageCollection no_gc;
  DCHECK(data_->should_access_heap());
  Object value = object()->value(kAcquireLoad);
  if (!value.IsFeedbackVector()) return base::nullopt;
  return MakeRefAssumeMemoryFence(broker(), FeedbackVector::cast(value));
}

base::Optional<ObjectRef> MapRef::GetStrongValue(
    InternalIndex descriptor_index) const {
  CHECK_LT(descriptor_index.as_int(), NumberOfOwnDescriptors());
  return instance_descriptors().GetStrongValue(descriptor_index);
}

DescriptorArrayRef MapRef::instance_descriptors() const {
  return MakeRefAssumeMemoryFence(
      broker(),
      object()->instance_descriptors(broker()->isolate(), kAcquireLoad));
}

base::Optional<HeapObjectRef> MapRef::prototype() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return TryMakeRef(broker(), HeapObject::cast(object()->prototype()),
                      kAssumeMemoryFence);
  }
  ObjectData* prototype_data = data()->AsMap()->prototype();
  if (prototype_data == nullptr) {
    TRACE_BROKER_MISSING(broker(), "prototype for map " << *this);
    return {};
  }
  return HeapObjectRef(broker(), prototype_data);
}

void MapRef::SerializeRootMap(NotConcurrentInliningTag tag) {
  if (data_->should_access_heap()) return;
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  data()->AsMap()->SerializeRootMap(broker(), tag);
}

// TODO(solanes, v8:7790): Remove base::Optional from the return type when
// deleting serialization.
base::Optional<MapRef> MapRef::FindRootMap() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // TODO(solanes): Change TryMakeRef to MakeRef when Map is moved to
    // kNeverSerialized.
    // TODO(solanes, v8:7790): Consider caching the result of the root map.
    return TryMakeRef(broker(), object()->FindRootMap(broker()->isolate()));
  }
  ObjectData* map_data = data()->AsMap()->FindRootMap();
  if (map_data != nullptr) {
    return MapRef(broker(), map_data);
  }
  TRACE_BROKER_MISSING(broker(), "root map for object " << *this);
  return base::nullopt;
}

bool JSTypedArrayRef::is_on_heap() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Safe to read concurrently because:
    // - host object seen by serializer.
    // - underlying field written 1. during initialization or 2. with
    //   release-store.
    return object()->is_on_heap(kAcquireLoad);
  }
  return data()->AsJSTypedArray()->data_ptr();
}

size_t JSTypedArrayRef::length() const {
  CHECK(!is_on_heap());
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Safe to read concurrently because:
    // - immutable after initialization.
    // - host object seen by serializer.
    return object()->length();
  }
  return data()->AsJSTypedArray()->length();
}

HeapObjectRef JSTypedArrayRef::buffer() const {
  CHECK(!is_on_heap());
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Safe to read concurrently because:
    // - immutable after initialization.
    // - host object seen by serializer.
    return MakeRef<HeapObject>(broker(), object()->buffer());
  }
  return HeapObjectRef{broker(), data()->AsJSTypedArray()->buffer()};
}

void* JSTypedArrayRef::data_ptr() const {
  CHECK(!is_on_heap());
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Safe to read concurrently because:
    // - host object seen by serializer.
    // - underlying field written 1. during initialization or 2. protected by
    //   the is_on_heap release/acquire semantics (external_pointer store
    //   happens-before base_pointer store, and this external_pointer load
    //   happens-after base_pointer load).
    STATIC_ASSERT(JSTypedArray::kOffHeapDataPtrEqualsExternalPointer);
    return object()->DataPtr();
  }
  return data()->AsJSTypedArray()->data_ptr();
}

bool MapRef::IsInobjectSlackTrackingInProgress() const {
  IF_ACCESS_FROM_HEAP_WITH_FLAG_C(IsInobjectSlackTrackingInProgress);
  return Map::Bits3::ConstructionCounterBits::decode(
             data()->AsMap()->bit_field3()) != Map::kNoSlackTracking;
}

int MapRef::constructor_function_index() const {
  IF_ACCESS_FROM_HEAP_WITH_FLAG_C(GetConstructorFunctionIndex);
  CHECK(IsPrimitiveMap());
  return data()->AsMap()->constructor_function_index();
}

bool MapRef::is_stable() const {
  IF_ACCESS_FROM_HEAP_C(is_stable);
  return !Map::Bits3::IsUnstableBit::decode(data()->AsMap()->bit_field3());
}

bool MapRef::CanBeDeprecated() const {
  IF_ACCESS_FROM_HEAP_WITH_FLAG_C(CanBeDeprecated);
  CHECK_GT(NumberOfOwnDescriptors(), 0);
  return data()->AsMap()->can_be_deprecated();
}

bool MapRef::CanTransition() const {
  IF_ACCESS_FROM_HEAP_WITH_FLAG_C(CanTransition);
  return data()->AsMap()->can_transition();
}

int MapRef::GetInObjectPropertiesStartInWords() const {
  IF_ACCESS_FROM_HEAP_WITH_FLAG_C(GetInObjectPropertiesStartInWords);
  return data()->AsMap()->in_object_properties_start_in_words();
}

int MapRef::GetInObjectProperties() const {
  IF_ACCESS_FROM_HEAP_C(GetInObjectProperties);
  return data()->AsMap()->in_object_properties();
}

bool StringRef::IsExternalString() const {
  return object()->IsExternalString();
}

Address CallHandlerInfoRef::callback() const {
  return v8::ToCData<Address>(object()->callback());
}

ZoneVector<Address> FunctionTemplateInfoRef::c_functions() const {
  return GetCFunctions(FixedArray::cast(object()->GetCFunctionOverloads()),
                       broker()->zone());
}

ZoneVector<const CFunctionInfo*> FunctionTemplateInfoRef::c_signatures() const {
  return GetCSignatures(FixedArray::cast(object()->GetCFunctionOverloads()),
                        broker()->zone());
}

bool StringRef::IsSeqString() const { return object()->IsSeqString(); }

void NativeContextRef::Serialize(NotConcurrentInliningTag tag) {
  // TODO(jgruber): Disable visitation if should_access_heap() once all
  // NativeContext element refs can be created on background threads. Until
  // then, we *must* iterate them and create refs at serialization-time (even
  // though NativeContextRef itself is never-serialized).
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
#define SERIALIZE_MEMBER(type, name)                                          \
  {                                                                           \
    ObjectData* member_data = broker()->GetOrCreateData(object()->name());    \
    if (member_data->IsMap() && !InstanceTypeChecker::IsContext(              \
                                    member_data->AsMap()->instance_type())) { \
      member_data->AsMap()->SerializeConstructor(broker(), tag);              \
    }                                                                         \
  }
  BROKER_NATIVE_CONTEXT_FIELDS(SERIALIZE_MEMBER)
#undef SERIALIZE_MEMBER

  for (int i = Context::FIRST_FUNCTION_MAP_INDEX;
       i <= Context::LAST_FUNCTION_MAP_INDEX; i++) {
    MapData* member_data = broker()->GetOrCreateData(object()->get(i))->AsMap();
    if (!InstanceTypeChecker::IsContext(member_data->instance_type())) {
      member_data->SerializeConstructor(broker(), tag);
    }
  }
}

ScopeInfoRef NativeContextRef::scope_info() const {
  // The scope_info is immutable after initialization.
  return MakeRefAssumeMemoryFence(broker(), object()->scope_info());
}

MapRef NativeContextRef::GetFunctionMapFromIndex(int index) const {
  DCHECK_GE(index, Context::FIRST_FUNCTION_MAP_INDEX);
  DCHECK_LE(index, Context::LAST_FUNCTION_MAP_INDEX);
  CHECK_LT(index, object()->length());
  return MakeRefAssumeMemoryFence(
      broker(), Map::cast(object()->get(index, kAcquireLoad)));
}

MapRef NativeContextRef::GetInitialJSArrayMap(ElementsKind kind) const {
  switch (kind) {
    case PACKED_SMI_ELEMENTS:
      return js_array_packed_smi_elements_map();
    case HOLEY_SMI_ELEMENTS:
      return js_array_holey_smi_elements_map();
    case PACKED_DOUBLE_ELEMENTS:
      return js_array_packed_double_elements_map();
    case HOLEY_DOUBLE_ELEMENTS:
      return js_array_holey_double_elements_map();
    case PACKED_ELEMENTS:
      return js_array_packed_elements_map();
    case HOLEY_ELEMENTS:
      return js_array_holey_elements_map();
    default:
      UNREACHABLE();
  }
}

#define DEF_NATIVE_CONTEXT_ACCESSOR(ResultType, Name)              \
  ResultType##Ref NativeContextRef::Name() const {                 \
    return MakeRefAssumeMemoryFence(                               \
        broker(), ResultType::cast(object()->Name(kAcquireLoad))); \
  }
BROKER_NATIVE_CONTEXT_FIELDS(DEF_NATIVE_CONTEXT_ACCESSOR)
#undef DEF_NATIVE_CONTEXT_ACCESSOR

base::Optional<JSFunctionRef> NativeContextRef::GetConstructorFunction(
    const MapRef& map) const {
  CHECK(map.IsPrimitiveMap());
  switch (map.constructor_function_index()) {
    case Map::kNoConstructorFunctionIndex:
      return base::nullopt;
    case Context::BIGINT_FUNCTION_INDEX:
      return bigint_function();
    case Context::BOOLEAN_FUNCTION_INDEX:
      return boolean_function();
    case Context::NUMBER_FUNCTION_INDEX:
      return number_function();
    case Context::STRING_FUNCTION_INDEX:
      return string_function();
    case Context::SYMBOL_FUNCTION_INDEX:
      return symbol_function();
    default:
      UNREACHABLE();
  }
}

bool ObjectRef::IsNull() const { return object()->IsNull(); }

bool ObjectRef::IsNullOrUndefined() const {
  if (IsSmi()) return false;
  OddballType type = AsHeapObject().map().oddball_type();
  return type == OddballType::kNull || type == OddballType::kUndefined;
}

bool ObjectRef::IsTheHole() const {
  return IsHeapObject() &&
         AsHeapObject().map().oddball_type() == OddballType::kHole;
}

base::Optional<bool> ObjectRef::TryGetBooleanValue() const {
  if (data_->should_access_heap()) {
    return object()->BooleanValue(broker()->isolate());
  }
  if (IsSmi()) return AsSmi() != 0;
  return data()->AsHeapObject()->TryGetBooleanValue(broker());
}

Maybe<double> ObjectRef::OddballToNumber() const {
  OddballType type = AsHeapObject().map().oddball_type();

  switch (type) {
    case OddballType::kBoolean: {
      ObjectRef true_ref = MakeRef<Object>(
          broker(), broker()->isolate()->factory()->true_value());
      return this->equals(true_ref) ? Just(1.0) : Just(0.0);
    }
    case OddballType::kUndefined: {
      return Just(std::numeric_limits<double>::quiet_NaN());
    }
    case OddballType::kNull: {
      return Just(0.0);
    }
    default: {
      return Nothing<double>();
    }
  }
}

bool ObjectRef::should_access_heap() const {
  return data()->should_access_heap();
}

base::Optional<ObjectRef> JSObjectRef::GetOwnConstantElement(
    const FixedArrayBaseRef& elements_ref, uint32_t index,
    CompilationDependencies* dependencies, SerializationPolicy policy) const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    base::Optional<Object> maybe_element = GetOwnConstantElementFromHeap(
        *elements_ref.object(), map().elements_kind(), index);

    if (!maybe_element.has_value()) return {};

    base::Optional<ObjectRef> result =
        TryMakeRef(broker(), maybe_element.value());
    if (policy == SerializationPolicy::kAssumeSerialized &&
        result.has_value()) {
      dependencies->DependOnOwnConstantElement(*this, index, *result);
    }
    return result;
  } else {
    ObjectData* element =
        data()->AsJSObject()->GetOwnConstantElement(broker(), index, policy);
    return TryMakeRef<Object>(broker(), element);
  }
}

base::Optional<Object> JSObjectRef::GetOwnConstantElementFromHeap(
    FixedArrayBase elements, ElementsKind elements_kind, uint32_t index) const {
  DCHECK(data_->should_access_heap() || broker()->is_concurrent_inlining());
  DCHECK_LE(index, JSObject::kMaxElementIndex);

  Handle<JSObject> holder = object();

  // This block is carefully constructed to avoid Ref creation and access since
  // this method may be called after the broker has retired.
  // The relaxed `length` read is safe to use in this case since:
  // - GetOwnConstantElement only detects a constant for JSArray holders if
  //   the array is frozen/sealed.
  // - Frozen/sealed arrays can't change length.
  // - We've already seen a map with frozen/sealed elements_kinds (above);
  // - The release-load of that map ensures we read the newest value
  //   of `length` below.
  if (holder->IsJSArray()) {
    uint32_t array_length;
    if (!JSArray::cast(*holder)
             .length(broker()->isolate(), kRelaxedLoad)
             .ToArrayLength(&array_length)) {
      return {};
    }
    // See also ElementsAccessorBase::GetMaxIndex.
    if (index >= array_length) return {};
  }

  Object maybe_element;
  auto result = ConcurrentLookupIterator::TryGetOwnConstantElement(
      &maybe_element, broker()->isolate(), broker()->local_isolate(), *holder,
      elements, elements_kind, index);

  if (result == ConcurrentLookupIterator::kGaveUp) {
    TRACE_BROKER_MISSING(broker(), "JSObject::GetOwnConstantElement on "
                                       << *this << " at index " << index);
    return {};
  } else if (result == ConcurrentLookupIterator::kNotPresent) {
    return {};
  }

  DCHECK_EQ(result, ConcurrentLookupIterator::kPresent);
  return maybe_element;
}

base::Optional<ObjectRef> JSObjectRef::GetOwnFastDataProperty(
    Representation field_representation, FieldIndex index,
    CompilationDependencies* dependencies, SerializationPolicy policy) const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    base::Optional<ObjectRef> result = GetOwnFastDataPropertyFromHeap(
        broker(), *this, field_representation, index);
    if (policy == SerializationPolicy::kAssumeSerialized &&
        result.has_value()) {
      dependencies->DependOnOwnConstantDataProperty(
          *this, map(), field_representation, index, *result);
    }
    return result;
  }
  ObjectData* property = data()->AsJSObject()->GetOwnFastDataProperty(
      broker(), field_representation, index, policy);
  return TryMakeRef<Object>(broker(), property);
}

base::Optional<ObjectRef> JSObjectRef::GetOwnDictionaryProperty(
    InternalIndex index, CompilationDependencies* dependencies,
    SerializationPolicy policy) const {
  CHECK(index.is_found());
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    base::Optional<ObjectRef> result =
        GetOwnDictionaryPropertyFromHeap(broker(), object(), index);
    if (policy == SerializationPolicy::kAssumeSerialized &&
        result.has_value()) {
      dependencies->DependOnOwnConstantDictionaryProperty(*this, index,
                                                          *result);
    }
    return result;
  }
  ObjectData* property =
      data()->AsJSObject()->GetOwnDictionaryProperty(broker(), index, policy);
  CHECK_NE(property, nullptr);
  return ObjectRef(broker(), property);
}

ObjectRef JSArrayRef::GetBoilerplateLength() const {
  // Safe to read concurrently because:
  // - boilerplates are immutable after initialization.
  // - boilerplates are published into the feedback vector.
  return length_unsafe();
}

ObjectRef JSArrayRef::length_unsafe() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return MakeRef(broker(),
                   object()->length(broker()->isolate(), kRelaxedLoad));
  } else {
    return ObjectRef{broker(), data()->AsJSArray()->length()};
  }
}

base::Optional<ObjectRef> JSArrayRef::GetOwnCowElement(
    FixedArrayBaseRef elements_ref, uint32_t index,
    SerializationPolicy policy) const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Note: we'd like to check `elements_ref == elements()` here, but due to
    // concurrency this may not hold. The code below must be able to deal with
    // concurrent `elements` modifications.

    // Due to concurrency, the kind read here may not be consistent with
    // `elements_ref`. The caller has to guarantee consistency at runtime by
    // other means (e.g. through a runtime equality check or a compilation
    // dependency).
    ElementsKind elements_kind = map().elements_kind();

    // We only inspect fixed COW arrays, which may only occur for fast
    // smi/objects elements kinds.
    if (!IsSmiOrObjectElementsKind(elements_kind)) return {};
    DCHECK(IsFastElementsKind(elements_kind));
    if (!elements_ref.map().IsFixedCowArrayMap()) return {};

    // As the name says, the `length` read here is unsafe and may not match
    // `elements`. We rely on the invariant that any `length` change will
    // also result in an `elements` change to make this safe. The `elements`
    // consistency check in the caller thus also guards the value of `length`.
    ObjectRef length_ref = length_unsafe();

    // Likewise we only deal with smi lengths.
    if (!length_ref.IsSmi()) return {};

    base::Optional<Object> result =
        ConcurrentLookupIterator::TryGetOwnCowElement(
            broker()->isolate(), *elements_ref.AsFixedArray().object(),
            elements_kind, length_ref.AsSmi(), index);
    if (!result.has_value()) return {};

    return TryMakeRef(broker(), result.value());
  } else {
    DCHECK(!data_->should_access_heap());
    DCHECK(!broker()->is_concurrent_inlining());

    // Just to clarify that `elements_ref` is not used on this path.
    // GetOwnElement accesses the serialized `elements` field on its own.
    USE(elements_ref);

    if (!elements(kRelaxedLoad).value().map().IsFixedCowArrayMap()) return {};

    ObjectData* element =
        data()->AsJSArray()->GetOwnElement(broker(), index, policy);
    if (element == nullptr) return base::nullopt;
    return ObjectRef(broker(), element);
  }
}

base::Optional<CellRef> SourceTextModuleRef::GetCell(int cell_index) const {
  return TryMakeRef(broker(), object()->GetCell(cell_index));
}

base::Optional<ObjectRef> SourceTextModuleRef::import_meta() const {
  return TryMakeRef(broker(), object()->import_meta(kAcquireLoad));
}

base::Optional<MapRef> HeapObjectRef::map_direct_read() const {
  return TryMakeRef(broker(), object()->map(kAcquireLoad), kAssumeMemoryFence);
}

namespace {

OddballType GetOddballType(Isolate* isolate, Map map) {
  if (map.instance_type() != ODDBALL_TYPE) {
    return OddballType::kNone;
  }
  ReadOnlyRoots roots(isolate);
  if (map == roots.undefined_map()) {
    return OddballType::kUndefined;
  }
  if (map == roots.null_map()) {
    return OddballType::kNull;
  }
  if (map == roots.boolean_map()) {
    return OddballType::kBoolean;
  }
  if (map == roots.the_hole_map()) {
    return OddballType::kHole;
  }
  if (map == roots.uninitialized_map()) {
    return OddballType::kUninitialized;
  }
  DCHECK(map == roots.termination_exception_map() ||
         map == roots.arguments_marker_map() ||
         map == roots.optimized_out_map() || map == roots.stale_register_map());
  return OddballType::kOther;
}

}  // namespace

HeapObjectType HeapObjectRef::GetHeapObjectType() const {
  if (data_->should_access_heap()) {
    Map map = Handle<HeapObject>::cast(object())->map();
    HeapObjectType::Flags flags(0);
    if (map.is_undetectable()) flags |= HeapObjectType::kUndetectable;
    if (map.is_callable()) flags |= HeapObjectType::kCallable;
    return HeapObjectType(map.instance_type(), flags,
                          GetOddballType(broker()->isolate(), map));
  }
  HeapObjectType::Flags flags(0);
  if (map().is_undetectable()) flags |= HeapObjectType::kUndetectable;
  if (map().is_callable()) flags |= HeapObjectType::kCallable;
  return HeapObjectType(map().instance_type(), flags, map().oddball_type());
}

base::Optional<JSObjectRef> AllocationSiteRef::boilerplate() const {
  if (!PointsToLiteral()) return {};
  DCHECK(data_->should_access_heap());
  return TryMakeRef(broker(), object()->boilerplate(kAcquireLoad));
}

base::Optional<FixedArrayBaseRef> JSObjectRef::elements(
    RelaxedLoadTag tag) const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return TryMakeRef(broker(), object()->elements(tag));
  }
  const JSObjectData* d = data()->AsJSObject();
  if (!d->serialized_elements()) {
    TRACE(broker(), "'elements' on " << this);
    return base::nullopt;
  }
  return FixedArrayBaseRef(broker(), d->elements());
}

int FixedArrayBaseRef::length() const {
  IF_ACCESS_FROM_HEAP_C(length);
  return data()->AsFixedArrayBase()->length();
}

PropertyDetails DescriptorArrayRef::GetPropertyDetails(
    InternalIndex descriptor_index) const {
  return object()->GetDetails(descriptor_index);
}

NameRef DescriptorArrayRef::GetPropertyKey(
    InternalIndex descriptor_index) const {
  NameRef result = MakeRef(broker(), object()->GetKey(descriptor_index));
  CHECK(result.IsUniqueName());
  return result;
}

ObjectRef DescriptorArrayRef::GetFieldType(
    InternalIndex descriptor_index) const {
  return MakeRef(broker(),
                 Object::cast(object()->GetFieldType(descriptor_index)));
}

base::Optional<ObjectRef> DescriptorArrayRef::GetStrongValue(
    InternalIndex descriptor_index) const {
  HeapObject heap_object;
  if (!object()
           ->GetValue(descriptor_index)
           .GetHeapObjectIfStrong(&heap_object)) {
    return {};
  }
  // Since the descriptors in the descriptor array can be changed in-place
  // via DescriptorArray::Replace, we might get a value that we haven't seen
  // before.
  return TryMakeRef(broker(), heap_object);
}

base::Optional<SharedFunctionInfoRef> FeedbackCellRef::shared_function_info()
    const {
  base::Optional<FeedbackVectorRef> feedback_vector = value();
  if (!feedback_vector.has_value()) return {};
  return feedback_vector->shared_function_info();
}

SharedFunctionInfoRef FeedbackVectorRef::shared_function_info() const {
  return MakeRef(broker(), object()->shared_function_info());
}

bool NameRef::IsUniqueName() const {
  // Must match Name::IsUniqueName.
  return IsInternalizedString() || IsSymbol();
}

void RegExpBoilerplateDescriptionRef::Serialize(NotConcurrentInliningTag) {
  // TODO(jgruber,v8:7790): Remove once member types are also never serialized.
  // Until then, we have to call these functions once on the main thread to
  // trigger serialization.
  data();
}

Handle<Object> ObjectRef::object() const {
  return data_->object();
}

#ifdef DEBUG
#define DEF_OBJECT_GETTER(T)                                                 \
  Handle<T> T##Ref::object() const {                                         \
    return Handle<T>(reinterpret_cast<Address*>(data_->object().address())); \
  }
#else
#define DEF_OBJECT_GETTER(T)                                                 \
  Handle<T> T##Ref::object() const {                                         \
    return Handle<T>(reinterpret_cast<Address*>(data_->object().address())); \
  }
#endif  // DEBUG

HEAP_BROKER_OBJECT_LIST(DEF_OBJECT_GETTER)
#undef DEF_OBJECT_GETTER

JSHeapBroker* ObjectRef::broker() const { return broker_; }

ObjectData* ObjectRef::data() const {
  switch (broker()->mode()) {
    case JSHeapBroker::kDisabled:
      return data_;
    case JSHeapBroker::kSerializing:
      CHECK_NE(data_->kind(), kUnserializedHeapObject);
      return data_;
    case JSHeapBroker::kSerialized:
    case JSHeapBroker::kRetired:
      CHECK_NE(data_->kind(), kUnserializedHeapObject);
      return data_;
  }
}

template <class T>
typename TinyRef<T>::RefType TinyRef<T>::AsRef(JSHeapBroker* broker) const {
  if (data_->kind() == kUnserializedHeapObject &&
      broker->mode() != JSHeapBroker::kDisabled) {
    // Gotta reconstruct to avoid returning a stale unserialized ref.
    return MakeRefAssumeMemoryFence<T>(broker,
                                       Handle<T>::cast(data_->object()));
  }
  return TryMakeRef<T>(broker, data_).value();
}

template <class T>
Handle<T> TinyRef<T>::object() const {
  return Handle<T>::cast(data_->object());
}

#define V(Name)                                  \
  template class TinyRef<Name>;                  \
  /* TinyRef should contain only one pointer. */ \
  STATIC_ASSERT(sizeof(TinyRef<Name>) == kSystemPointerSize);
HEAP_BROKER_OBJECT_LIST(V)
#undef V

Reduction NoChangeBecauseOfMissingData(JSHeapBroker* broker,
                                       const char* function, int line) {
  TRACE_MISSING(broker, "data in function " << function << " at line " << line);
  return AdvancedReducer::NoChange();
}

bool JSBoundFunctionRef::Serialize(NotConcurrentInliningTag tag) {
  if (data_->should_access_heap()) {
    return true;
  }
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  return data()->AsJSBoundFunction()->Serialize(broker(), tag);
}

#define JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP(Result, Name, UsedField)    \
  Result##Ref JSFunctionRef::Name(CompilationDependencies* dependencies) \
      const {                                                            \
    IF_ACCESS_FROM_HEAP(Result, Name);                                   \
    RecordConsistentJSFunctionViewDependencyIfNeeded(                    \
        broker(), *this, data()->AsJSFunction(), UsedField);             \
    return Result##Ref(broker(), data()->AsJSFunction()->Name());        \
  }

#define JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP_C(Result, Name, UsedField)     \
  Result JSFunctionRef::Name(CompilationDependencies* dependencies) const { \
    IF_ACCESS_FROM_HEAP_C(Name);                                            \
    RecordConsistentJSFunctionViewDependencyIfNeeded(                       \
        broker(), *this, data()->AsJSFunction(), UsedField);                \
    return data()->AsJSFunction()->Name();                                  \
  }

JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP_C(bool, has_feedback_vector,
                                       JSFunctionData::kHasFeedbackVector)
JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP_C(bool, has_initial_map,
                                       JSFunctionData::kHasInitialMap)
JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP_C(bool, has_instance_prototype,
                                       JSFunctionData::kHasInstancePrototype)
JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP_C(
    bool, PrototypeRequiresRuntimeLookup,
    JSFunctionData::kPrototypeRequiresRuntimeLookup)
JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP(Map, initial_map,
                                     JSFunctionData::kInitialMap)
JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP(Object, instance_prototype,
                                     JSFunctionData::kInstancePrototype)
JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP(FeedbackCell, raw_feedback_cell,
                                     JSFunctionData::kFeedbackCell)
JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP(FeedbackVector, feedback_vector,
                                     JSFunctionData::kFeedbackVector)

BIMODAL_ACCESSOR(JSFunction, Context, context)
BIMODAL_ACCESSOR(JSFunction, NativeContext, native_context)
BIMODAL_ACCESSOR(JSFunction, SharedFunctionInfo, shared)

#undef JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP
#undef JSFUNCTION_BIMODAL_ACCESSOR_WITH_DEP_C

CodeRef JSFunctionRef::code() const {
  return MakeRefAssumeMemoryFence(broker(), object()->code(kAcquireLoad));
}

base::Optional<FunctionTemplateInfoRef>
SharedFunctionInfoRef::function_template_info() const {
  if (!object()->IsApiFunction()) return {};
  return TryMakeRef(broker(), FunctionTemplateInfo::cast(
                                  object()->function_data(kAcquireLoad)));
}

int SharedFunctionInfoRef::context_header_size() const {
  return object()->scope_info().ContextHeaderLength();
}

ScopeInfoRef SharedFunctionInfoRef::scope_info() const {
  return MakeRefAssumeMemoryFence(broker(), object()->scope_info(kAcquireLoad));
}

void JSObjectRef::SerializeObjectCreateMap(NotConcurrentInliningTag tag) {
  if (data_->should_access_heap()) return;
  data()->AsJSObject()->SerializeObjectCreateMap(broker(), tag);
}

base::Optional<MapRef> JSObjectRef::GetObjectCreateMap() const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    Handle<Map> map_handle = Handle<Map>::cast(map().object());
    // Note: implemented as an acquire-load.
    if (!map_handle->is_prototype_map()) return {};

    Handle<Object> maybe_proto_info = broker()->CanonicalPersistentHandle(
        map_handle->prototype_info(kAcquireLoad));
    if (!maybe_proto_info->IsPrototypeInfo()) return {};

    MaybeObject maybe_object_create_map =
        Handle<PrototypeInfo>::cast(maybe_proto_info)
            ->object_create_map(kAcquireLoad);
    if (!maybe_object_create_map->IsWeak()) return {};

    return MapRef(broker(),
                  broker()->GetOrCreateData(
                      maybe_object_create_map->GetHeapObjectAssumeWeak(),
                      kAssumeMemoryFence));
  }
  ObjectData* map_data = data()->AsJSObject()->object_create_map(broker());
  if (map_data == nullptr) return base::Optional<MapRef>();
  if (map_data->should_access_heap()) {
    return TryMakeRef(broker(), Handle<Map>::cast(map_data->object()));
  }
  return MapRef(broker(), map_data->AsMap());
}

void MapRef::SerializeBackPointer(NotConcurrentInliningTag tag) {
  if (data_->should_access_heap()) return;
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  data()->AsMap()->SerializeBackPointer(broker(), tag);
}

bool MapRef::TrySerializePrototype(NotConcurrentInliningTag tag) {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return true;
  }
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  return data()->AsMap()->TrySerializePrototype(broker(), tag);
}

void MapRef::SerializePrototype(NotConcurrentInliningTag tag) {
  CHECK(TrySerializePrototype(tag));
}

void JSTypedArrayRef::Serialize(NotConcurrentInliningTag tag) {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    // Nothing to do.
  } else {
    CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
    data()->AsJSTypedArray()->Serialize(broker(), tag);
  }
}

bool JSTypedArrayRef::serialized() const {
  if (data_->should_access_heap()) return true;
  if (broker()->is_concurrent_inlining()) return true;
  if (data_->AsJSTypedArray()->serialized()) return true;
  TRACE_BROKER_MISSING(broker(), "data for JSTypedArray " << this);
  return false;
}

bool PropertyCellRef::Cache() const {
  if (data_->should_access_heap()) return true;
  CHECK(broker()->mode() == JSHeapBroker::kSerializing ||
        broker()->mode() == JSHeapBroker::kSerialized);
  return data()->AsPropertyCell()->Cache(broker());
}

void FunctionTemplateInfoRef::SerializeCallCode(NotConcurrentInliningTag tag) {
  CHECK_EQ(broker()->mode(), JSHeapBroker::kSerializing);
  // CallHandlerInfo::data may still hold a serialized heap object, so we
  // have to make the broker aware of it.
  // TODO(v8:7790): Remove this case once ObjectRef is never serialized.
  Handle<HeapObject> call_code(object()->call_code(kAcquireLoad),
                               broker()->isolate());
  if (call_code->IsCallHandlerInfo()) {
    broker()->GetOrCreateData(Handle<CallHandlerInfo>::cast(call_code)->data());
  }
}

bool NativeContextRef::GlobalIsDetached() const {
  base::Optional<ObjectRef> proxy_proto =
      global_proxy_object().map().prototype();
  return !proxy_proto.has_value() || !proxy_proto->equals(global_object());
}

base::Optional<PropertyCellRef> JSGlobalObjectRef::GetPropertyCell(
    NameRef const& name, SerializationPolicy policy) const {
  if (data_->should_access_heap() || broker()->is_concurrent_inlining()) {
    return GetPropertyCellFromHeap(broker(), name.object());
  }

  ObjectData* property_cell_data = data()->AsJSGlobalObject()->GetPropertyCell(
      broker(), name.data(), policy);
  return TryMakeRef<PropertyCell>(broker(), property_cell_data);
}

std::ostream& operator<<(std::ostream& os, const ObjectRef& ref) {
  if (!FLAG_concurrent_recompilation) {
    // We cannot be in a background thread so it's safe to read the heap.
    AllowHandleDereference allow_handle_dereference;
    return os << ref.data() << " {" << ref.object() << "}";
  } else if (ref.data_->should_access_heap()) {
    return os << ref.data() << " {" << ref.object() << "}";
  } else {
    return os << ref.data();
  }
}

unsigned CodeRef::GetInlinedBytecodeSize() const {
  unsigned value = object()->inlined_bytecode_size();
  if (value > 0) {
    // Don't report inlined bytecode size if the code object was already
    // deoptimized.
    value = object()->marked_for_deoptimization() ? 0 : value;
  }
  return value;
}

#undef BIMODAL_ACCESSOR
#undef BIMODAL_ACCESSOR_B
#undef BIMODAL_ACCESSOR_C
#undef BIMODAL_ACCESSOR_WITH_FLAG
#undef BIMODAL_ACCESSOR_WITH_FLAG_B
#undef BIMODAL_ACCESSOR_WITH_FLAG_C
#undef HEAP_ACCESSOR_C
#undef IF_ACCESS_FROM_HEAP
#undef IF_ACCESS_FROM_HEAP_C
#undef IF_ACCESS_FROM_HEAP_WITH_FLAG
#undef IF_ACCESS_FROM_HEAP_WITH_FLAG_C
#undef TRACE
#undef TRACE_MISSING

}  // namespace compiler
}  // namespace internal
}  // namespace v8
