#ifndef SRC_NODE_METADATA_H_
#define SRC_NODE_METADATA_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <string>
#include "node_version.h"

namespace node {

// if this is a release build and no explicit base has been set
// substitute the standard release download URL
#ifndef NODE_RELEASE_URLBASE
#if NODE_VERSION_IS_RELEASE
#define NODE_RELEASE_URLBASE "https://nodejs.org/download/release/"
#endif  // NODE_VERSION_IS_RELEASE
#endif  // NODE_RELEASE_URLBASE

#if defined(NODE_RELEASE_URLBASE)
#define NODE_HAS_RELEASE_URLS
#endif

#define NODE_VERSIONS_KEYS_BASE(V)                                             \
  V(node)                                                                      \
  V(v8)                                                                        \
  V(uv)                                                                        \
  V(zlib)                                                                      \
  V(brotli)                                                                    \
  V(ares)                                                                      \
  V(modules)                                                                   \
  V(nghttp2)                                                                   \
  V(napi)                                                                      \
  V(llhttp)                                                                    \
  V(http_parser)                                                               \

#if HAVE_OPENSSL
#define NODE_VERSIONS_KEY_CRYPTO(V) V(openssl)
#else
#define NODE_VERSIONS_KEY_CRYPTO(V)
#endif

#ifdef NODE_HAVE_I18N_SUPPORT
#define NODE_VERSIONS_KEY_INTL(V)                                              \
  V(cldr)                                                                      \
  V(icu)                                                                       \
  V(tz)                                                                        \
  V(unicode)
#else
#define NODE_VERSIONS_KEY_INTL(V)
#endif  // NODE_HAVE_I18N_SUPPORT

#ifdef NODE_MOBILE
#define NODE_VERSIONS_KEY_MOBILE(V)                                            \
  V(mobile)
#else
#define NODE_VERSIONS_KEY_MOBILE(V)
#endif  //NODE_MOBILE

#define NODE_VERSIONS_KEYS(V)                                                  \
  NODE_VERSIONS_KEYS_BASE(V)                                                   \
  NODE_VERSIONS_KEY_CRYPTO(V)                                                  \
  NODE_VERSIONS_KEY_INTL(V)                                                    \
  NODE_VERSIONS_KEY_MOBILE(V)

class Metadata {
 public:
  Metadata();
  Metadata(Metadata&) = delete;
  Metadata(Metadata&&) = delete;
  Metadata operator=(Metadata&) = delete;
  Metadata operator=(Metadata&&) = delete;

  struct Versions {
    Versions();

#ifdef NODE_HAVE_I18N_SUPPORT
    // Must be called on the main thread after
    // i18n::InitializeICUDirectory()
    void InitializeIntlVersions();
#endif  // NODE_HAVE_I18N_SUPPORT

#define V(key) std::string key;
    NODE_VERSIONS_KEYS(V)
#undef V
  };

  struct Release {
    Release();

    std::string name;
#if NODE_VERSION_IS_LTS
    std::string lts;
#endif  // NODE_VERSION_IS_LTS

#ifdef NODE_HAS_RELEASE_URLS
    std::string source_url;
    std::string headers_url;
#ifdef _WIN32
    std::string lib_url;
#endif  // _WIN32
#endif  // NODE_HAS_RELEASE_URLS
  };

  Versions versions;
  const Release release;
  const std::string arch;
  const std::string platform;
};

// Per-process global
namespace per_process {
extern Metadata metadata;
extern const char* const llhttp_version;
extern const char* const http_parser_version;
}

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_NODE_METADATA_H_
