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
XCODE_PROJECT_PATH='tools/ios-framework/NodeMobile.xcodeproj/project.pbxproj'

declare -a outputs_common=(
    "libada.a"
    "libbrotli.a"
    "libcares.a"
    "libgtest.a"
    "libgtest_main.a"
    "libhistogram.a"
    "libllhttp.a"
    "libnbytes.a"
    "libncrypto.a"
    "libnghttp2.a"
    "libnghttp3.a"
    "libngtcp2.a"
    "libnode.a"
    "libopenssl.a"
    "libsimdjson.a"
    "libsimdutf.a"
    "libsqlite.a"
    "libtorque_base.a"
    "libuv.a"
    "libuvwasi.a"
    "libv8_abseil.a"
    "libv8_base_without_compiler.a"
    "libv8_compiler.a"
    "libv8_init.a"
    "libv8_initializers.a"
    "libv8_libbase.a"
    "libv8_libplatform.a"
    "libv8_snapshot.a"
    "libv8_turboshaft.a"
    "libv8_zlib.a"
    "libzlib.a"
)
declare -a outputs_x64_only=(
)
declare -a outputs_arm64_only=(
    "libzlib_inflate_chunk_simd.a"
)

declare -a outputs_x64=("${outputs_common[@]}" "${outputs_x64_only[@]}")
declare -a outputs_arm64=("${outputs_common[@]}" "${outputs_arm64_only[@]}")

build_for_arm64_device() {
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
  mkdir -p $TARGET_LIBRARY_PATH/arm64-device
  for output_file in "${outputs_arm64[@]}"; do
    cp $LIBRARY_PATH/$output_file $TARGET_LIBRARY_PATH/arm64-device/
  done
}

build_for_arm64_simulator() {
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
    --without-node-snapshot \
    --ios-simulator
  make -j$(getconf _NPROCESSORS_ONLN)

  # Move compilation outputs
  mkdir -p $TARGET_LIBRARY_PATH/arm64-simulator
  for output_file in "${outputs_arm64[@]}"; do
      cp $LIBRARY_PATH/$output_file $TARGET_LIBRARY_PATH/arm64-simulator/
  done
}

build_for_x64_simulator() {
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

  # Move compilation outputs
  mkdir -p $TARGET_LIBRARY_PATH/x64-simulator
  for output_file in "${outputs_x64[@]}"; do
    cp $LIBRARY_PATH/$output_file $TARGET_LIBRARY_PATH/x64-simulator/
  done
}

build_framework_for_arm64_device() {
  # Move libraries to the correct location
  for output_file in "${outputs_arm64[@]}"; do
    rm -f $TARGET_LIBRARY_PATH/$output_file
    mv $TARGET_LIBRARY_PATH/arm64-device/$output_file $TARGET_LIBRARY_PATH/$output_file
  done
  # Remove libraries that do not exist for this target
  cp $XCODE_PROJECT_PATH $XCODE_PROJECT_PATH.bak
  for output_file in "${outputs_x64_only[@]}"; do
    grep -vF "$output_file" $XCODE_PROJECT_PATH > temp && mv temp $XCODE_PROJECT_PATH
  done
  # Compile the Framework Xcode project for arm64 device
  xcodebuild build \
    -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj \
    -target "NodeMobile" \
    -configuration Release \
    -arch arm64 \
    -sdk "iphoneos" \
    SYMROOT=$FRAMEWORK_TARGET_DIR/iphoneos-arm64
  mv $XCODE_PROJECT_PATH.bak $XCODE_PROJECT_PATH
}

build_framework_for_arm64_simulator() {
  # Move libraries to the correct location
  for output_file in "${outputs_arm64[@]}"; do
    rm -f $TARGET_LIBRARY_PATH/$output_file
    mv $TARGET_LIBRARY_PATH/arm64-simulator/$output_file $TARGET_LIBRARY_PATH/$output_file
  done
  # Remove libraries that do not exist for this target
  cp $XCODE_PROJECT_PATH $XCODE_PROJECT_PATH.bak
  for output_file in "${outputs_x64_only[@]}"; do
    grep -vF "$output_file" $XCODE_PROJECT_PATH > temp && mv temp $XCODE_PROJECT_PATH
  done
  # Compile the Framework Xcode project for arm64 simulator
  xcodebuild build \
    -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj \
    -target "NodeMobile" \
    -configuration Release \
    -arch arm64 \
    -sdk "iphonesimulator" \
    SYMROOT=$FRAMEWORK_TARGET_DIR/iphonesimulator-arm64
  mv $XCODE_PROJECT_PATH.bak $XCODE_PROJECT_PATH
}

build_framework_for_x64_simulator() {
  # Move libraries to the correct location
  for output_file in "${outputs_x64[@]}"; do
    rm -f $TARGET_LIBRARY_PATH/$output_file
    mv $TARGET_LIBRARY_PATH/x64-simulator/$output_file $TARGET_LIBRARY_PATH/$output_file
  done
  # Remove libraries that do not exist for this target
  cp $XCODE_PROJECT_PATH $XCODE_PROJECT_PATH.bak
  for output_file in "${outputs_arm64_only[@]}"; do
    grep -vF "$output_file" $XCODE_PROJECT_PATH > temp && mv temp $XCODE_PROJECT_PATH
  done
  # Compile the Framework Xcode project for x64 simulator
  xcodebuild build \
    -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj \
    -target "NodeMobile" \
    -configuration Release \
    -arch x86_64 \
    -sdk "iphonesimulator" \
    SYMROOT=$FRAMEWORK_TARGET_DIR/iphonesimulator-x64
  mv $XCODE_PROJECT_PATH.bak $XCODE_PROJECT_PATH
}

combine_frameworks() {
  # Join both simulator outputs into one
  mkdir -p $FRAMEWORK_TARGET_DIR/iphonesimulator-universal/NodeMobile.framework
  cp -r $FRAMEWORK_TARGET_DIR/iphonesimulator-arm64/Release-iphonesimulator/NodeMobile.framework/* \
    $FRAMEWORK_TARGET_DIR/iphonesimulator-universal/NodeMobile.framework/
  lipo -create \
    $FRAMEWORK_TARGET_DIR/iphonesimulator-arm64/Release-iphonesimulator/NodeMobile.framework/NodeMobile \
    $FRAMEWORK_TARGET_DIR/iphonesimulator-x64/Release-iphonesimulator/NodeMobile.framework/NodeMobile \
    -output $FRAMEWORK_TARGET_DIR/iphonesimulator-universal/NodeMobile.framework/NodeMobile

  # Create a .xcframework combining both iphoneos and iphonesimulator
  XCFRAMEWORK=$FRAMEWORK_TARGET_DIR/NodeMobile.xcframework
  xcodebuild -create-xcframework \
    -framework $FRAMEWORK_TARGET_DIR/iphoneos-arm64/Release-iphoneos/NodeMobile.framework \
    -framework $FRAMEWORK_TARGET_DIR/iphonesimulator-universal/NodeMobile.framework \
    -output $XCFRAMEWORK

  echo "Framework built: $XCFRAMEWORK"
}

# Create a path to build the framework into
set_framework_target_dir() {
  if [ -z "$1" ]; then
    mkdir -p out_ios
    cd out_ios
    FRAMEWORK_TARGET_DIR=${PWD}
    cd ../
  else
    rm -rf out_ios_$1
    mkdir -p out_ios_$1
    cd out_ios_$1
    FRAMEWORK_TARGET_DIR=${PWD}
    cd ../
  fi
}

# Interpret the command line arguments
if [[ $1 == "arm64" ]]; then
  set_framework_target_dir $1
  build_for_arm64_device
  build_framework_for_arm64_device
elif [[ $1 == "arm64-simulator" ]]; then
  set_framework_target_dir $1
  build_for_arm64_simulator
  build_framework_for_arm64_simulator
elif [[ $1 == "x64-simulator" ]]; then
  set_framework_target_dir $1
  build_for_x64_simulator
  build_framework_for_x64_simulator
elif [[ $1 == "combine_frameworks" ]]; then
  set_framework_target_dir
  combine_frameworks
elif [[ $1 == "--help" ]]; then
  echo "Usage: ios_framework_prepare.sh arm64|arm64-simulator|x64-simulator|combine_frameworks"
  exit 1
else
  build_for_arm64_device
  build_for_arm64_simulator
  build_for_x64_simulator

  set_framework_target_dir "arm64"
  build_framework_for_arm64_device
  set_framework_target_dir "arm64-simulator"
  build_framework_for_arm64_simulator
  set_framework_target_dir "x64-simulator"
  build_framework_for_x64_simulator
  set_framework_target_dir
  combine_frameworks

  source $SCRIPT_DIR/copy_libnode_headers.sh ios
fi

cd "$ROOT"
