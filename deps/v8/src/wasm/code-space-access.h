// Copyright 2020 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#if !V8_ENABLE_WEBASSEMBLY
#error This header should only be included if WebAssembly is enabled.
#endif  // !V8_ENABLE_WEBASSEMBLY

#ifndef V8_WASM_CODE_SPACE_ACCESS_H_
#define V8_WASM_CODE_SPACE_ACCESS_H_

#include "src/base/build_config.h"
#include "src/base/macros.h"
#include "src/common/globals.h"

namespace v8 {
namespace internal {

namespace wasm {

class NativeModule;

// Within the scope, the code space is writable (and for Apple M1 also not
// executable). After the last (nested) scope is destructed, the code space is
// not writable.
// This uses three different implementations, depending on the platform, flags,
// and runtime support:
// - On MacOS on ARM64 ("Apple M1"/Apple Silicon), it uses APRR/MAP_JIT to
// switch only the calling thread between writable and executable. This achieves
// "real" W^X and is thread-local and fast.
// - When Intel PKU (aka. memory protection keys) are available, it switches
// the protection keys' permission between writable and not writable. The
// executable permission cannot be retracted with PKU. That is, this "only"
// achieves write-protection, but is similarly thread-local and fast.
// - As a fallback, we switch with {mprotect()} between R-X and RWX (due to
// concurrent compilation and execution). This is slow and process-wide. With
// {mprotect()}, we currently switch permissions for the entire module's memory:
//  - for AOT, that's as efficient as it can be.
//  - for Lazy, we don't have a heuristic for functions that may need patching,
//    and even if we did, the resulting set of pages may be fragmented.
//    Currently, we try and keep the number of syscalls low.
// -  similar argument for debug time.
// MAP_JIT on Apple M1 cannot switch permissions for smaller ranges of memory,
// and for PKU we would need multiple keys, so both of them also switch
// permissions for all code pages.
class V8_NODISCARD CodeSpaceWriteScope final {
 public:
  explicit V8_EXPORT_PRIVATE CodeSpaceWriteScope(NativeModule* native_module);
  V8_EXPORT_PRIVATE ~CodeSpaceWriteScope();

  // Disable copy constructor and copy-assignment operator, since this manages
  // a resource and implicit copying of the scope can yield surprising errors.
  CodeSpaceWriteScope(const CodeSpaceWriteScope&) = delete;
  CodeSpaceWriteScope& operator=(const CodeSpaceWriteScope&) = delete;

 private:
  static thread_local int code_space_write_nesting_level_;

  void SetWritable() const;
  void SetExecutable() const;

  // The M1 implementation knows implicitly from the {MAP_JIT} flag during
  // allocation which region to switch permissions for. On non-M1 hardware
  // without memory protection key support, we need the code space from the
  // {native_module_}.
#if !V8_HAS_PTHREAD_JIT_WRITE_PROTECT
  NativeModule* const native_module_;
#endif
};

}  // namespace wasm
}  // namespace internal
}  // namespace v8

#endif  // V8_WASM_CODE_SPACE_ACCESS_H_
