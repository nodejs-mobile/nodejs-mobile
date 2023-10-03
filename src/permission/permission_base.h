#ifndef SRC_PERMISSION_PERMISSION_BASE_H_
#define SRC_PERMISSION_PERMISSION_BASE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <map>
#include <string>
#include <string_view>
#include "v8.h"

namespace node {

namespace permission {

#define FILESYSTEM_PERMISSIONS(V)                                              \
  V(FileSystem, "fs", PermissionsRoot)                                         \
  V(FileSystemRead, "fs.read", FileSystem)                                     \
  V(FileSystemWrite, "fs.write", FileSystem)

#define CHILD_PROCESS_PERMISSIONS(V) V(ChildProcess, "child", PermissionsRoot)

#define WORKER_THREADS_PERMISSIONS(V)                                          \
  V(WorkerThreads, "worker", PermissionsRoot)

#define PERMISSIONS(V)                                                         \
  FILESYSTEM_PERMISSIONS(V)                                                    \
  CHILD_PROCESS_PERMISSIONS(V)                                                 \
  WORKER_THREADS_PERMISSIONS(V)

#define V(name, _, __) k##name,
enum class PermissionScope {
  kPermissionsRoot = -1,
  PERMISSIONS(V) kPermissionsCount
};
#undef V

class PermissionBase {
 public:
  virtual void Apply(const std::string& allow, PermissionScope scope) = 0;
  virtual bool is_granted(PermissionScope perm,
                          const std::string_view& param = "") = 0;
};

}  // namespace permission

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_PERMISSION_PERMISSION_BASE_H_
