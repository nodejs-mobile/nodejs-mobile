'use strict';

const { spawnPromisified } = require('../common');
const fixtures = require('../common/fixtures.js');
const assert = require('node:assert');
const { execPath } = require('node:process');
const { describe, it } = require('node:test');


describe('ESM: importing CJS', { concurrency: true }, () => {
  it('should support valid CJS exports', async () => {
    const validEntry = fixtures.path('/es-modules/cjs-exports.mjs');
    const { code, signal, stdout } = await spawnPromisified(execPath, [validEntry]);

    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    assert.strictEqual(stdout, 'ok\n');
  });

  it('should eror on invalid CJS exports', async () => {
    const invalidEntry = fixtures.path('/es-modules/cjs-exports-invalid.mjs');
    const { code, signal, stderr } = await spawnPromisified(execPath, [invalidEntry]);

    assert.strictEqual(code, 1);
    assert.strictEqual(signal, null);
    assert.ok(stderr.includes('Warning: To load an ES module'));
    assert.ok(stderr.includes('Unexpected token \'export\''));
  });
});
