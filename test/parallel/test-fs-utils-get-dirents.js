// Flags: --expose-internals
'use strict';

const common = require('../common');
const { getDirents, getDirent } = require('internal/fs/utils');
const assert = require('assert');
const { internalBinding } = require('internal/test/binding');
const { UV_DIRENT_UNKNOWN } = internalBinding('constants').fs;
const fs = require('fs');

const tmpdir = require('../common/tmpdir');
const filename = 'foo';

{
  // setup
  tmpdir.refresh();
  fs.writeFileSync(tmpdir.resolve(filename), '');
}
// getDirents
{
  // string + string
  getDirents(
    tmpdir.path,
    [[filename], [UV_DIRENT_UNKNOWN]],
    common.mustCall((err, names) => {
      assert.strictEqual(err, null);
      assert.strictEqual(names.length, 1);
    },
    ));
}
{
  // string + Buffer
  getDirents(
    tmpdir.path,
    [[Buffer.from(filename)], [UV_DIRENT_UNKNOWN]],
    common.mustCall((err, names) => {
      assert.strictEqual(err, null);
      assert.strictEqual(names.length, 1);
    },
    ));
}
{
  // Buffer + Buffer
  getDirents(
    Buffer.from(tmpdir.path),
    [[Buffer.from(filename)], [UV_DIRENT_UNKNOWN]],
    common.mustCall((err, names) => {
      assert.strictEqual(err, null);
      assert.strictEqual(names.length, 1);
    },
    ));
}
{
  // wrong combination
  getDirents(
    42,
    [[Buffer.from(filename)], [UV_DIRENT_UNKNOWN]],
    common.mustCall((err) => {
      assert.strictEqual(
        err.message,
        [
          'The "path" argument must be of type string or an ' +
          'instance of Buffer. Received type number (42)',
        ].join(''));
    },
    ));
}
// getDirent
{
  // string + string
  getDirent(
    tmpdir.path,
    filename,
    UV_DIRENT_UNKNOWN,
    common.mustCall((err, dirent) => {
      assert.strictEqual(err, null);
      assert.strictEqual(dirent.name, filename);
    },
    ));
}
{
  // string + Buffer
  const filenameBuffer = Buffer.from(filename);
  getDirent(
    tmpdir.path,
    filenameBuffer,
    UV_DIRENT_UNKNOWN,
    common.mustCall((err, dirent) => {
      assert.strictEqual(err, null);
      assert.strictEqual(dirent.name, filenameBuffer);
    },
    ));
}
{
  // Buffer + Buffer
  const filenameBuffer = Buffer.from(filename);
  getDirent(
    Buffer.from(tmpdir.path),
    filenameBuffer,
    UV_DIRENT_UNKNOWN,
    common.mustCall((err, dirent) => {
      assert.strictEqual(err, null);
      assert.strictEqual(dirent.name, filenameBuffer);
    },
    ));
}
{
  // wrong combination
  getDirent(
    42,
    Buffer.from(filename),
    UV_DIRENT_UNKNOWN,
    common.mustCall((err) => {
      assert.strictEqual(
        err.message,
        [
          'The "path" argument must be of type string or an ' +
          'instance of Buffer. Received type number (42)',
        ].join(''));
    },
    ));
}
