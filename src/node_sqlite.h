#ifndef SRC_NODE_SQLITE_H_
#define SRC_NODE_SQLITE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "base_object.h"
#include "node_mem.h"
#include "sqlite3.h"
#include "util.h"

#include <map>
#include <unordered_set>

namespace node {
namespace sqlite {

class StatementSync;

class DatabaseSync : public BaseObject {
 public:
  DatabaseSync(Environment* env,
               v8::Local<v8::Object> object,
               v8::Local<v8::String> location,
               bool open);
  void MemoryInfo(MemoryTracker* tracker) const override;
  static void New(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Open(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Close(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Prepare(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Exec(const v8::FunctionCallbackInfo<v8::Value>& args);
  void FinalizeStatements();
  void UntrackStatement(StatementSync* statement);
  bool IsOpen();
  sqlite3* Connection();

  SET_MEMORY_INFO_NAME(DatabaseSync)
  SET_SELF_SIZE(DatabaseSync)

 private:
  bool Open();

  ~DatabaseSync() override;
  std::string location_;
  sqlite3* connection_;
  std::unordered_set<StatementSync*> statements_;
};

class StatementSync : public BaseObject {
 public:
  StatementSync(Environment* env,
                v8::Local<v8::Object> object,
                DatabaseSync* db,
                sqlite3_stmt* stmt);
  void MemoryInfo(MemoryTracker* tracker) const override;
  static v8::Local<v8::FunctionTemplate> GetConstructorTemplate(
      Environment* env);
  static BaseObjectPtr<StatementSync> Create(Environment* env,
                                             DatabaseSync* db,
                                             sqlite3_stmt* stmt);
  static void All(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Get(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Run(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SourceSQL(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ExpandedSQL(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetAllowBareNamedParameters(
      const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetReadBigInts(const v8::FunctionCallbackInfo<v8::Value>& args);
  void Finalize();
  bool IsFinalized();

  SET_MEMORY_INFO_NAME(StatementSync)
  SET_SELF_SIZE(StatementSync)

 private:
  ~StatementSync() override;
  DatabaseSync* db_;
  sqlite3_stmt* statement_;
  bool use_big_ints_;
  bool allow_bare_named_params_;
  std::optional<std::map<std::string, std::string>> bare_named_params_;
  bool BindParams(const v8::FunctionCallbackInfo<v8::Value>& args);
  bool BindValue(const v8::Local<v8::Value>& value, const int index);
  v8::MaybeLocal<v8::Value> ColumnToValue(const int column);
  v8::MaybeLocal<v8::Name> ColumnNameToName(const int column);
};

}  // namespace sqlite
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_NODE_SQLITE_H_
