#!/bin/bash

set -e

ROOT=${PWD}

SCRIPT_DIR="$(dirname "$BASH_SOURCE")"
cd "$SCRIPT_DIR"
SCRIPT_DIR=${PWD}

#should be the node's source root
cd ../

LIBRARY_PATH='out/Release'

make clean

TARGET_LIBRARY_PATH='tools/ios-framework/bin/arm64'

GYP_DEFINES="target_arch=arm64 host_os=mac target_os=ios"
export GYP_DEFINES

./configure --dest-os=ios --dest-cpu=arm64 --with-intl=none --cross-compiling --enable-static --openssl-no-asm --v8-options=--jitless --without-node-code-cache --without-node-snapshot
make -j$(getconf _NPROCESSORS_ONLN)

mkdir -p $TARGET_LIBRARY_PATH

cp $LIBRARY_PATH/libbrotli.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libcares.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libhistogram.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libhttp_parser.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libllhttp.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libnghttp2.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libnode.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libopenssl.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libuv.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libuvwasi.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_base_without_compiler.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_compiler.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_initializers.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_libbase.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_libplatform.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_libsampler.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_snapshot.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libzlib.a $TARGET_LIBRARY_PATH/

make clean

TARGET_LIBRARY_PATH='tools/ios-framework/bin/x64'

GYP_DEFINES="target_arch=x64 host_os=mac target_os=ios"
export GYP_DEFINES

./configure --dest-os=ios --dest-cpu=x64 --with-intl=none --cross-compiling --enable-static --openssl-no-asm --v8-options=--jitless --without-node-code-cache --without-node-snapshot
make -j$(getconf _NPROCESSORS_ONLN)

mkdir -p $TARGET_LIBRARY_PATH

cp $LIBRARY_PATH/libbrotli.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libcares.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libhistogram.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libhttp_parser.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libllhttp.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libnghttp2.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libnode.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libopenssl.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libuv.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libuvwasi.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_base_without_compiler.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_compiler.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_initializers.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_libbase.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_libplatform.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_libsampler.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libv8_snapshot.a $TARGET_LIBRARY_PATH/
cp $LIBRARY_PATH/libzlib.a $TARGET_LIBRARY_PATH/

TARGET_LIBRARY_PATH='tools/ios-framework/bin'

lipo -create "$TARGET_LIBRARY_PATH/arm64/libbrotli.a" "$TARGET_LIBRARY_PATH/x64/libbrotli.a" -output "$TARGET_LIBRARY_PATH/libbrotli.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libcares.a" "$TARGET_LIBRARY_PATH/x64/libcares.a" -output "$TARGET_LIBRARY_PATH/libcares.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libhistogram.a" "$TARGET_LIBRARY_PATH/x64/libhistogram.a" -output "$TARGET_LIBRARY_PATH/libhistogram.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libhttp_parser.a" "$TARGET_LIBRARY_PATH/x64/libhttp_parser.a" -output "$TARGET_LIBRARY_PATH/libhttp_parser.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libllhttp.a" "$TARGET_LIBRARY_PATH/x64/libllhttp.a" -output "$TARGET_LIBRARY_PATH/libllhttp.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libnghttp2.a" "$TARGET_LIBRARY_PATH/x64/libnghttp2.a" -output "$TARGET_LIBRARY_PATH/libnghttp2.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libnode.a" "$TARGET_LIBRARY_PATH/x64/libnode.a" -output "$TARGET_LIBRARY_PATH/libnode.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libopenssl.a" "$TARGET_LIBRARY_PATH/x64/libopenssl.a" -output "$TARGET_LIBRARY_PATH/libopenssl.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libuv.a" "$TARGET_LIBRARY_PATH/x64/libuv.a" -output "$TARGET_LIBRARY_PATH/libuv.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libuvwasi.a" "$TARGET_LIBRARY_PATH/x64/libuvwasi.a" -output "$TARGET_LIBRARY_PATH/libuvwasi.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libv8_base_without_compiler.a" "$TARGET_LIBRARY_PATH/x64/libv8_base_without_compiler.a" -output "$TARGET_LIBRARY_PATH/libv8_base_without_compiler.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libv8_compiler.a" "$TARGET_LIBRARY_PATH/x64/libv8_compiler.a" -output "$TARGET_LIBRARY_PATH/libv8_compiler.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libv8_initializers.a" "$TARGET_LIBRARY_PATH/x64/libv8_initializers.a" -output "$TARGET_LIBRARY_PATH/libv8_initializers.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libv8_libbase.a" "$TARGET_LIBRARY_PATH/x64/libv8_libbase.a" -output "$TARGET_LIBRARY_PATH/libv8_libbase.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libv8_libplatform.a" "$TARGET_LIBRARY_PATH/x64/libv8_libplatform.a" -output "$TARGET_LIBRARY_PATH/libv8_libplatform.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libv8_libsampler.a" "$TARGET_LIBRARY_PATH/x64/libv8_libsampler.a" -output "$TARGET_LIBRARY_PATH/libv8_libsampler.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libv8_snapshot.a" "$TARGET_LIBRARY_PATH/x64/libv8_snapshot.a" -output "$TARGET_LIBRARY_PATH/libv8_snapshot.a"
lipo -create "$TARGET_LIBRARY_PATH/arm64/libzlib.a" "$TARGET_LIBRARY_PATH/x64/libzlib.a" -output "$TARGET_LIBRARY_PATH/libzlib.a"

#Create a path to build the frameworks into
rm -rf out_ios
mkdir -p out_ios
cd out_ios
FRAMEWORK_TARGET_DIR=${PWD}
cd ../

NODELIB_PROJECT_PATH='tools/ios-framework'

xcodebuild build -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj -target "NodeMobile" -configuration Release -arch arm64 -sdk "iphoneos" SYMROOT=$FRAMEWORK_TARGET_DIR
xcodebuild build -project $NODELIB_PROJECT_PATH/NodeMobile.xcodeproj -target "NodeMobile" -configuration Release -arch x86_64 -sdk "iphonesimulator" SYMROOT=$FRAMEWORK_TARGET_DIR
cp -RL $FRAMEWORK_TARGET_DIR/Release-iphoneos $FRAMEWORK_TARGET_DIR/Release-universal
lipo -create $FRAMEWORK_TARGET_DIR/Release-iphoneos/NodeMobile.framework/NodeMobile $FRAMEWORK_TARGET_DIR/Release-iphonesimulator/NodeMobile.framework/NodeMobile -output $FRAMEWORK_TARGET_DIR/Release-universal/NodeMobile.framework/NodeMobile

echo "Frameworks built to $FRAMEWORK_TARGET_DIR"

cd "$ROOT"
