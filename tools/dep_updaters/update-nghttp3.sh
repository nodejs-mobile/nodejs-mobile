#!/bin/sh
set -e
# Shell script to update nghttp3 in the source tree to a specific version

BASE_DIR=$(cd "$(dirname "$0")/../.." && pwd)
DEPS_DIR="$BASE_DIR/deps"
[ -z "$NODE" ] && NODE="$BASE_DIR/out/Release/node"
[ -x "$NODE" ] || NODE=$(command -v node)

# shellcheck disable=SC1091
. "$BASE_DIR/tools/dep_updaters/utils.sh"

NEW_VERSION="$("$NODE" --input-type=module <<'EOF'
const res = await fetch('https://api.github.com/repos/ngtcp2/nghttp3/releases');
if (!res.ok) throw new Error(`FetchError: ${res.status} ${res.statusText}`, { cause: res });
const releases = await res.json()
const { tag_name } = releases.at(0);
console.log(tag_name.replace('v', ''));
EOF
)"

NGHTTP3_VERSION_H="$DEPS_DIR/ngtcp2/nghttp3/lib/includes/nghttp3/version.h"

CURRENT_VERSION=$(grep "#define NGHTTP3_VERSION" "$NGHTTP3_VERSION_H" | sed -n "s/^.*VERSION \"\(.*\)\"/\1/p")

echo "Comparing $NEW_VERSION with $CURRENT_VERSION"

if [ "$NEW_VERSION" = "$CURRENT_VERSION" ]; then
  echo "Skipped because http3 is on the latest version."
  exit 0
fi

WORKSPACE=$(mktemp -d 2> /dev/null || mktemp -d -t 'tmp')

cleanup () {
  EXIT_CODE=$?
  [ -d "$WORKSPACE" ] && rm -rf "$WORKSPACE"
  exit $EXIT_CODE
}

trap cleanup INT TERM EXIT

NGHTTP3_REF="v$NEW_VERSION"
NGHTTP3_ZIP="nghttp3-$NEW_VERSION"

cd "$WORKSPACE"

echo "Fetching nghttp3 source archive..."
curl -sL -o "$NGHTTP3_ZIP.zip" "https://github.com/ngtcp2/nghttp3/archive/refs/tags/$NGHTTP3_REF.zip"
log_and_verify_sha256sum "nghttp3" "$NGHTTP3_ZIP.zip"
unzip "$NGHTTP3_ZIP.zip"
rm "$NGHTTP3_ZIP.zip"
mv "$NGHTTP3_ZIP" nghttp3

cd nghttp3

autoreconf -i

./configure --prefix="$PWD/build" --enable-lib-only

cp -R lib/* "$DEPS_DIR/ngtcp2/nghttp3/lib/"

echo "All done!"
echo ""
echo "Please git add nghttp3, commit the new version:"
echo ""
echo "$ git add -A deps/nghttp3"
echo "$ git commit -m \"deps: update nghttp3 to $NEW_VERSION\""
echo ""

# The last line of the script should always print the new version,
# as we need to add it to $GITHUB_ENV variable.
echo "NEW_VERSION=$NEW_VERSION"
