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

#include "node.h"
#include <cstdio>

#ifdef _WIN32
#include <windows.h>
#include <VersionHelpers.h>
#include <WinError.h>

#define SKIP_CHECK_VAR "NODE_SKIP_PLATFORM_CHECK"
#define SKIP_CHECK_SIZE 1
#define SKIP_CHECK_VALUE "1"

int wmain(int argc, wchar_t* wargv[]) {
  // Windows Server 2012 (not R2) is supported until 10/10/2023, so we allow it
  // to run in the experimental support tier.
  char buf[SKIP_CHECK_SIZE + 1];
  if (!IsWindows8Point1OrGreater() &&
      !(IsWindowsServer() && IsWindows8OrGreater()) &&
      (GetEnvironmentVariableA(SKIP_CHECK_VAR, buf, sizeof(buf)) !=
       SKIP_CHECK_SIZE ||
       strncmp(buf, SKIP_CHECK_VALUE, SKIP_CHECK_SIZE + 1) != 0)) {
    fprintf(stderr, "Node.js is only supported on Windows 8.1, Windows "
                    "Server 2012 R2, or higher.\n"
                    "Setting the " SKIP_CHECK_VAR " environment variable "
                    "to 1 skips this\ncheck, but Node.js might not execute "
                    "correctly. Any issues encountered on\nunsupported "
                    "platforms will not be fixed.");
    exit(ERROR_EXE_MACHINE_TYPE_MISMATCH);
  }

  // Convert argv to UTF8
  char** argv = new char*[argc + 1];
  for (int i = 0; i < argc; i++) {
    // Compute the size of the required buffer
    DWORD size = WideCharToMultiByte(CP_UTF8,
                                     0,
                                     wargv[i],
                                     -1,
                                     nullptr,
                                     0,
                                     nullptr,
                                     nullptr);
    if (size == 0) {
      // This should never happen.
      fprintf(stderr, "Could not convert arguments to utf8.");
      exit(1);
    }
    // Do the actual conversion
    argv[i] = new char[size];
    DWORD result = WideCharToMultiByte(CP_UTF8,
                                       0,
                                       wargv[i],
                                       -1,
                                       argv[i],
                                       size,
                                       nullptr,
                                       nullptr);
    if (result == 0) {
      // This should never happen.
      fprintf(stderr, "Could not convert arguments to utf8.");
      exit(1);
    }
  }
  argv[argc] = nullptr;
  // Now that conversion is done, we can finally start.
  return node::Start(argc, argv);
}
#else
// UNIX
#ifdef __linux__
#include <sys/auxv.h>
#endif  // __linux__
#if defined(__POSIX__) && defined(NODE_SHARED_MODE)
#include <string.h>
#include <signal.h>
#endif

namespace node {
namespace per_process {
extern bool linux_at_secure;
}  // namespace per_process
}  // namespace node

int main(int argc, char* argv[]) {
#if defined(__POSIX__) && defined(NODE_SHARED_MODE)
  // In node::PlatformInit(), we squash all signal handlers for non-shared lib
  // build. In order to run test cases against shared lib build, we also need
  // to do the same thing for shared lib build here, but only for SIGPIPE for
  // now. If node::PlatformInit() is moved to here, then this section could be
  // removed.
  {
    struct sigaction act;
    memset(&act, 0, sizeof(act));
    act.sa_handler = SIG_IGN;
    sigaction(SIGPIPE, &act, nullptr);
  }
#endif

#if defined(__linux__)
  node::per_process::linux_at_secure = getauxval(AT_SECURE);
#endif
  // Disable stdio buffering, it interacts poorly with printf()
  // calls elsewhere in the program (e.g., any logging from V8.)
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  return node::Start(argc, argv);
}
#endif
