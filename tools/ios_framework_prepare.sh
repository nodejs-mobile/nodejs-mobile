#!/bin/bash

set -e

ROOT=${PWD}

# iOS Simulator compilation disabled because of
# https://github.com/nodejs-mobile/nodejs-mobile/pull/9#issuecomment-1359289496
IOSSIM='' # Set this to '1' to enable iOS simulator compilation

SCRIPT_DIR="$(dirname "$BASH_SOURCE")"
cd "$SCRIPT_DIR"
SCRIPT_DIR=${PWD}

#should be the node's source root
cd ../

LIBRARY_PATH='out/Release'

declare -a outputs=(
    "libbrotli.a"
    "libcares.a"
    "libgtest_main.a"
    "libgtest.a"
    "libhistogram.a"
    "libllhttp.a"
    "libnghttp2.a"
    "libnghttp3.a"
    "libngtcp2.a"
    "libnode.a"
    "libopenssl.a"
    "libuv.a"
    "libuvwasi.a"
    "libv8_base_without_compiler.a"
    "libv8_compiler.a"
    "libv8_initializers.a"
    "libv8_libbase.a"
    "libv8_libplatform.a"
    "libv8_snapshot.a"
    "libv8_zlib.a"
    "libzlib.a"
)

# Compile node.js for arm64
make clean
GYP_DEFINES="target_arch=arm64 host_os=mac target_os=ios"
export GYP_DEFINES
./configure \
  --dest-os=ios \
  --dest-cpu=arm64 \
  --with-intl=none \
  --cross-compiling \
  --enable-static \
  --openssl-no-asm \
  --v8-options=--jitless \
  --without-node-code-cache \
  --without-node-snapshot
make -j$(getconf _NPROCESSORS_ONLN)

# Move compilation outputs
TARGET_LIBRARY_PATH='tools/ios-framework/bin/arm64'
mkdir -p $TARGET_LIBRARY_PATH
for output_file in "${outputs[@]}"; do
    cp $LIBRARY_PATH/$output_file $TARGET_LIBRARY_PATH/
done

if [ -n "$IOSSIM" ]; then
    # Compile node.js for x64 simulators
    make clean
    GYP_DEFINES="target_arch=x64 host_os=mac target_os=ios"
    export GYP_DEFINES
    ./configure \
      --dest-os=ios \
      --dest-cpu=x64 \
      --with-intl=none \
      --cross-compiling \
      --enable-static \
      --openssl-no-asm \
      --v8-options=--jitless \
      --without-node-code-cache \
      --without-node-snapshot
    make -j$(getconf _NPROCESSORS_ONLN)

    # Move compilation outputs
    TARGET_LIBRARY_PATH='tools/ios-framework/bin/x64'
    mkdir -p $TARGET_LIBRARY_PATH
    for output_file in "${outputs[@]}"; do
        cp $LIBRARY_PATH/$output_file $TARGET_LIBRARY_PATH/
    done
fi

# Combine both arch outputs into one output
TARGET_LIBRARY_PATH='tools/ios-framework/bin'
for output_file in "${outputs[@]}"; do
    if [ -n "$IOSSIM" ]; then
        lipo -create \
          "$TARGET_LIBRARY_PATH/arm64/$output_file" \
          "$TARGET_LIBRARY_PATH/x64/$output_file" \
          -output "$TARGET_LIBRARY_PATH/$output_file"
    else
        mv $TARGET_LIBRARY_PATH/arm64/$output_file $TARGET_LIBRARY_PATH/$output_file
    fi
done
rm -rf "$TARGET_LIBRARY_PATH/arm64/"
rm -rf "$TARGET_LIBRARY_PATH/x64/"

# Create a path to build the frameworks into
rm -rf out_ios
mkdir -p out_ios
cd out_ios
FRAMEWORK_TARGET_DIR=${PWD}
cd ../

# Compile the Framework Xcode project
NODELIB_PROJECT_PATH='tools/ios-framework'
xcodebuild build \
  -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj \
  -target "NodeMobile" \
  -configuration Release \
  -arch arm64 \
  -sdk "iphoneos" \
  SYMROOT=$FRAMEWORK_TARGET_DIR
if [ -n "$IOSSIM" ]; then
    xcodebuild build \
      -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj \
      -target "NodeMobile" \
      -configuration Release \
      -arch x86_64 \
      -sdk "iphonesimulator" \
      SYMROOT=$FRAMEWORK_TARGET_DIR
fi
cp -RL $FRAMEWORK_TARGET_DIR/Release-iphoneos $FRAMEWORK_TARGET_DIR/Release-universal
if [ -n "$IOSSIM" ]; then
    lipo -create \
      $FRAMEWORK_TARGET_DIR/Release-iphoneos/NodeMobile.framework/NodeMobile \
      $FRAMEWORK_TARGET_DIR/Release-iphonesimulator/NodeMobile.framework/NodeMobile \
      -output $FRAMEWORK_TARGET_DIR/Release-universal/NodeMobile.framework/NodeMobile
else
    lipo -create \
    $FRAMEWORK_TARGET_DIR/Release-iphoneos/NodeMobile.framework/NodeMobile \
    -output $FRAMEWORK_TARGET_DIR/Release-universal/NodeMobile.framework/NodeMobile
fi

# Create a .xcframework
if [ -n "$IOSSIM" ]; then
    xcodebuild -create-xcframework \
      -framework $FRAMEWORK_TARGET_DIR/Release-iphoneos/NodeMobile.framework \
      -framework $FRAMEWORK_TARGET_DIR/Release-iphonesimulator/NodeMobile.framework \
      -output $FRAMEWORK_TARGET_DIR/NodeMobile.xcframework
else
    xcodebuild -create-xcframework \
      -framework $FRAMEWORK_TARGET_DIR/Release-iphoneos/NodeMobile.framework \
      -output $FRAMEWORK_TARGET_DIR/NodeMobile.xcframework
fi

echo "Frameworks built to $FRAMEWORK_TARGET_DIR"

source $SCRIPT_DIR/copy_libnode_headers.sh ios

cd "$ROOT"
