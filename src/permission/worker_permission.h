#ifndef SRC_PERMISSION_WORKER_PERMISSION_H_
#define SRC_PERMISSION_WORKER_PERMISSION_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <vector>
#include "permission/permission_base.h"

namespace node {

namespace permission {

class WorkerPermission final : public PermissionBase {
 public:
  void Apply(const std::string& allow, PermissionScope scope) override;
  bool is_granted(PermissionScope perm,
                  const std::string_view& param = "") override;

 private:
  bool deny_all_;
};

}  // namespace permission

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_PERMISSION_WORKER_PERMISSION_H_
