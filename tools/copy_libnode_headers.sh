#!/bin/bash

set -e

SCRIPT_DIR="$(dirname "$BASH_SOURCE")"

if [ $# -ne 1 ]; then
  echo "Requires either the string 'ios' or the string 'android' as argument"
  exit 1
fi

if [ $1 == "ios" ]; then
  OUT_DIR=out_ios
elif [ $1 == "android" ]; then
  OUT_DIR=out_android
else
  echo "Requires either the string 'ios' or the string 'android' as argument"
  exit 1
fi

cd $SCRIPT_DIR
cd ..

HEADERS=$OUT_DIR/libnode/include/node
mkdir -p $HEADERS

# node headers
cp src/js_native_api.h $HEADERS/
cp src/js_native_api_types.h $HEADERS/
cp src/node_api_types.h $HEADERS/
cp src/node_api.h $HEADERS/
cp src/node_buffer.h $HEADERS/
cp src/node_object_wrap.h $HEADERS/
cp src/node_version.h $HEADERS/
cp src/node.h $HEADERS/

# uv headers
rsync -am --include='*.h' -f 'hide,! */' deps/uv/include/ $HEADERS

# v8 headers
cp deps/v8/include/v8*.h $HEADERS/
mkdir -p $HEADERS/libplatform
cp deps/v8/include/libplatform/*.h $HEADERS/libplatform/
mkdir -p $HEADERS/cppgc
cp deps/v8/include/cppgc/*.h $HEADERS/cppgc/
mkdir -p $HEADERS/cppgc/internal
cp deps/v8/include/cppgc/internal/*.h $HEADERS/cppgc/internal/
