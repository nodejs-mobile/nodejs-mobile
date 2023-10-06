#!/bin/bash

set -e

ROOT=${PWD}

SCRIPT_DIR="$(dirname "$BASH_SOURCE")"
cd "$SCRIPT_DIR"
SCRIPT_DIR=${PWD}

#should be the node's source root
cd ../

LIBRARY_PATH='out/Release'
TARGET_LIBRARY_PATH='tools/ios-framework/bin'
NODELIB_PROJECT_PATH='tools/ios-framework'

declare -a outputs=(
    "libada.a"
    "libbase64_neon64.a"
    "libbase64.a"
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
    "libsimdutf.a"
    "libuv.a"
    "libuvwasi.a"
    "libv8_base_without_compiler.a"
    "libv8_compiler.a"
    "libv8_initializers.a"
    "libv8_libbase.a"
    "libv8_libplatform.a"
    "libv8_snapshot.a"
    "libv8_zlib.a"
    "libzlib_inflate_chunk_simd.a"
    "libzlib.a"
)

# Compile Node.js for iOS arm64 devices
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
mkdir -p $TARGET_LIBRARY_PATH/arm64
for output_file in "${outputs[@]}"; do
    cp $LIBRARY_PATH/$output_file $TARGET_LIBRARY_PATH/arm64/
done


# Compile Node.js for iOS simulators on x64 Macs
ARCH=$(arch)
if [ "$ARCH" = "arm64" ]; then
  # Build with the command arch -x86_64 on arm64.
  make clean
  GYP_DEFINES="target_arch=x64 host_os=mac target_os=ios"
  export GYP_DEFINES
  arch -x86_64 ./configure \
    --dest-os=ios \
    --dest-cpu=x64 \
    --with-intl=none \
    --cross-compiling \
    --enable-static \
    --openssl-no-asm \
    --v8-options=--jitless \
    --without-node-code-cache \
    --without-node-snapshot
  arch -x86_64 make -j$(getconf _NPROCESSORS_ONLN)
else
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
fi

# Move compilation outputs
mkdir -p $TARGET_LIBRARY_PATH/x64
for output_file in "${outputs[@]}"; do
  cp $LIBRARY_PATH/$output_file $TARGET_LIBRARY_PATH/x64/
done

# Create a path to build the frameworks into
rm -rf out_ios
mkdir -p out_ios
cd out_ios
FRAMEWORK_TARGET_DIR=${PWD}
cd ../

# Compile the Framework Xcode project for arm64 device
for output_file in "${outputs[@]}"; do
  rm -f $TARGET_LIBRARY_PATH/$output_file
  mv $TARGET_LIBRARY_PATH/arm64/$output_file $TARGET_LIBRARY_PATH/$output_file
done
xcodebuild build \
  -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj \
  -target "NodeMobile" \
  -configuration Release \
  -arch arm64 \
  -sdk "iphoneos" \
  SYMROOT=$FRAMEWORK_TARGET_DIR

# Compile the Framework Xcode project for iOS simulators on x64 Macs
for output_file in "${outputs[@]}"; do
  rm -f $TARGET_LIBRARY_PATH/$output_file
  mv $TARGET_LIBRARY_PATH/x64/$output_file $TARGET_LIBRARY_PATH/$output_file
done
xcodebuild build \
  -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj \
  -target "NodeMobile" \
  -configuration Release \
  -arch x86_64 \
  -sdk "iphonesimulator" \
  SYMROOT=$FRAMEWORK_TARGET_DIR

cp -RL $FRAMEWORK_TARGET_DIR/Release-iphoneos $FRAMEWORK_TARGET_DIR/Release-universal
lipo -create \
  $FRAMEWORK_TARGET_DIR/Release-iphoneos/NodeMobile.framework/NodeMobile \
  $FRAMEWORK_TARGET_DIR/Release-iphonesimulator/NodeMobile.framework/NodeMobile \
  -output $FRAMEWORK_TARGET_DIR/Release-universal/NodeMobile.framework/NodeMobile

# Create a .xcframework
xcodebuild -create-xcframework \
  -framework $FRAMEWORK_TARGET_DIR/Release-iphoneos/NodeMobile.framework \
  -framework $FRAMEWORK_TARGET_DIR/Release-iphonesimulator/NodeMobile.framework \
  -output $FRAMEWORK_TARGET_DIR/NodeMobile.xcframework

echo "Frameworks built to $FRAMEWORK_TARGET_DIR"

source $SCRIPT_DIR/copy_libnode_headers.sh ios

cd "$ROOT"
