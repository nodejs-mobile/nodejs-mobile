'use strict';

const common = require('../common');
const assert = require('assert');
const { exec } = require('child_process');
const fixtures = require('../common/fixtures');

const node = process.execPath;

// Match on the name of the `Error` but not the message as it is different
// depending on the JavaScript engine.
const syntaxErrorRE = /^SyntaxError: \b/m;

// Should work with -r flags
['-c', '--check'].forEach(function(checkFlag) {
  ['-r', '--require'].forEach(function(requireFlag) {
    const preloadFile = fixtures.path('no-wrapper.js');
    const file = fixtures.path('syntax', 'illegal_if_not_wrapped.js');
    const args = [requireFlag, preloadFile, checkFlag, file];
    const cmd = [node, ...args].join(' ');
    exec(cmd, common.mustCall((err, stdout, stderr) => {
      assert.strictEqual(err instanceof Error, true);
      assert.strictEqual(err.code, 1,
                         `code ${err.code} !== 1 for error:\n\n${err}`);

      // No stdout should be produced
      assert.strictEqual(stdout, '');

      // stderr should have a syntax error message
      assert.match(stderr, syntaxErrorRE);

      // stderr should include the filename
      assert(stderr.startsWith(file), `${stderr} starts with ${file}`);
    }));
  });
});
