#!/bin/bash
set -e

if [ "$DEVICE_ID" = "" ]; then
  TARGET_DEVICE=""
else
  TARGET_DEVICE="-i $DEVICE_ID"
fi

SCRIPT_BASE_DIR="$( cd "$( dirname "$0" )" && pwd )"
NODEJS_BASE_DIR="$( cd "$( dirname "$0" )" && cd .. && cd .. && cd .. && pwd )"
TEST_PROXY_TARGETDIR="$( cd "$NODEJS_BASE_DIR" && mkdir -p ./out/ios.release/ && cd ./out/ios.release/ && pwd )"

# Remove symbolic links, which might make the iOS application invalid to install
set +e
unlink "$NODEJS_BASE_DIR/test/fixtures/wasi/subdir/input_link.txt"
unlink "$NODEJS_BASE_DIR/test/fixtures/wasi/subdir/loop1"
unlink "$NODEJS_BASE_DIR/test/fixtures/wasi/subdir/loop2"
unlink "$NODEJS_BASE_DIR/test/fixtures/wasi/subdir/outside.txt"
set -e

xcodebuild build -project "$SCRIPT_BASE_DIR/testnode/testnode.xcodeproj" -target "testnode" -configuration Release -arch arm64 -sdk "iphoneos" SYMROOT="$TEST_PROXY_TARGETDIR"

cp "$SCRIPT_BASE_DIR/node-ios-proxy.sh" "$TEST_PROXY_TARGETDIR/node"

ios-deploy -t 120 --uninstall $TARGET_DEVICE -b "$TEST_PROXY_TARGETDIR/Release-iphoneos/testnode.app" -u --noninteractive --args "--copy-path-for-testing"

exit ${PIPESTATUS[0]}
