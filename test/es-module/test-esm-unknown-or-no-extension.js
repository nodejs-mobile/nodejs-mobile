'use strict';

const { spawnPromisified } = require('../common');
const fixtures = require('../common/fixtures.js');
const assert = require('node:assert');
const { execPath } = require('node:process');
const { describe, it } = require('node:test');


// In a "type": "module" package scope, files with unknown extensions or no
// extensions should throw; both when used as a main entry point and also when
// referenced via `import`.
describe('ESM: extensionless and unknown specifiers', { concurrency: true }, () => {
  for (
    const fixturePath of [
      '/es-modules/package-type-module/noext-esm',
      '/es-modules/package-type-module/imports-noext.mjs',
      '/es-modules/package-type-module/extension.unknown',
      '/es-modules/package-type-module/imports-unknownext.mjs',
    ]
  ) {
    it('should throw', async () => {
      const entry = fixtures.path(fixturePath);
      const { code, signal, stderr, stdout } = await spawnPromisified(execPath, [entry]);

      assert.strictEqual(code, 1);
      assert.strictEqual(signal, null);
      assert.strictEqual(stdout, '');
      assert.ok(stderr.includes('ERR_UNKNOWN_FILE_EXTENSION'));
      if (fixturePath.includes('noext')) {
        // Check for explanation to users
        assert.ok(stderr.includes('extensionless'));
      }
    });
  }
});
