#!/bin/sh
set -e
# Shell script to update cjs-module-lexer in the source tree to a specific version

BASE_DIR=$(cd "$(dirname "$0")/../.." && pwd)

DEPS_DIR="$BASE_DIR/deps"
[ -z "$NODE" ] && NODE="$BASE_DIR/out/Release/node"
[ -x "$NODE" ] || NODE=$(command -v node)

NPM="$DEPS_DIR/npm/bin/npm-cli.js"

NEW_VERSION="$("$NODE" --input-type=module <<'EOF'
const res = await fetch('https://api.github.com/repos/nodejs/cjs-module-lexer/tags');
if (!res.ok) throw new Error(`FetchError: ${res.status} ${res.statusText}`, { cause: res });
const tags = await res.json();
const { name } = tags.at(0)
console.log(name);
EOF
)"

CURRENT_VERSION=$("$NODE" -p "require('./deps/cjs-module-lexer/package.json').version")

echo "Comparing $NEW_VERSION with $CURRENT_VERSION"

if [ "$NEW_VERSION" = "$CURRENT_VERSION" ]; then
  echo "Skipped because cjs-module-lexer is on the latest version."
  exit 0
fi

echo "Making temporary workspace"

WORKSPACE=$(mktemp -d 2> /dev/null || mktemp -d -t 'tmp')

cleanup () {
  EXIT_CODE=$?
  [ -d "$WORKSPACE" ] && rm -rf "$WORKSPACE"
  exit $EXIT_CODE
}

trap cleanup INT TERM EXIT

cd "$WORKSPACE"

"$NODE" "$NPM" init --yes

"$NODE" "$NPM" install --global-style --no-bin-links --ignore-scripts "cjs-module-lexer@$NEW_VERSION"

rm -rf "$DEPS_DIR/cjs-module-lexer"

mv node_modules/cjs-module-lexer "$DEPS_DIR/cjs-module-lexer"

echo "All done!"
echo ""
echo "Please git add cjs-module-lexer, commit the new version:"
echo ""
echo "$ git add -A deps/cjs-module-lexer src/cjs_module_lexer_version.h"
echo "$ git commit -m \"deps: update cjs-module-lexer to $NEW_VERSION\""
echo ""

# The last line of the script should always print the new version,
# as we need to add it to $GITHUB_ENV variable.
echo "NEW_VERSION=$NEW_VERSION"
