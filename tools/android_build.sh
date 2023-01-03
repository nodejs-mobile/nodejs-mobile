#!/bin/bash

set -e

ROOT=${PWD}

if [ $# -lt 3 ]; then
  echo "Requires a path to the Android NDK, target arch, and an SDK version number"
  echo "Usage: android_build.sh <ndk_path> <target_arch> <sdk_version>"
  exit 1
fi

ANDROID_SDK_VERSION="$3"

SCRIPT_DIR="$(dirname "$BASH_SOURCE")"
cd "$SCRIPT_DIR"
SCRIPT_DIR=${PWD}

cd "$ROOT"
cd "$1"
ANDROID_NDK_PATH=${PWD}
cd "$SCRIPT_DIR"
cd ../

BUILD_ARCH() {
  # Clean previous compilation
  make clean
  rm -rf android-toolchain/

  # Compile
  source ./android-configure "$ANDROID_NDK_PATH" $TARGET_ARCH $ANDROID_SDK_VERSION
  make -j $(getconf _NPROCESSORS_ONLN)

  # Move binaries
  TARGET_ARCH_FOLDER="$TARGET_ARCH"
  if [ "$TARGET_ARCH_FOLDER" == "arm" ]; then
    # Use the Android NDK ABI name.
    TARGET_ARCH_FOLDER="armeabi-v7a"
  elif [ "$TARGET_ARCH_FOLDER" == "arm64" ]; then
    # Use the Android NDK ABI name.
    TARGET_ARCH_FOLDER="arm64-v8a"
  fi
  mkdir -p "out_android/$TARGET_ARCH_FOLDER/"
  OUTPUT1="out/Release/lib.target/libnode.so"
  OUTPUT2="out/Release/obj.target/libnode.so"
  if [ -f "$OUTPUT1" ]; then
    cp "$OUTPUT1" "out_android/$TARGET_ARCH_FOLDER/libnode.so"
  elif [ -f "$OUTPUT2" ]; then
    cp "$OUTPUT2" "out_android/$TARGET_ARCH_FOLDER/libnode.so"
  else
    echo "Could not find libnode.so file after compilation"
    exit 1
  fi
}

if [ $2 == "x" ]; then
  TARGET_ARCH="arm"
  BUILD_ARCH
  TARGET_ARCH="x86"
  BUILD_ARCH
  TARGET_ARCH="arm64"
  BUILD_ARCH
  TARGET_ARCH="x86_64"
  BUILD_ARCH
else
  TARGET_ARCH=$2
  BUILD_ARCH
fi

source $SCRIPT_DIR/copy_libnode_headers.sh android

cd "$ROOT"
