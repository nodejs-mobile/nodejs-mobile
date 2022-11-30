// Flags: --expose-internals
'use strict';
const common = require('../common');
const tmpdir = require('../common/tmpdir');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

const { validateRmOptionsSync } = require('internal/fs/utils');

tmpdir.refresh();

let count = 0;
const nextDirPath = (name = 'rm') =>
  path.join(tmpdir.path, `${name}-${count++}`);

const isGitPresent = (() => {
  try { execSync('git --version'); return true; } catch { return false; }
})();

function gitInit(gitDirectory) {
  fs.mkdirSync(gitDirectory);
  execSync('git init', { cwd: gitDirectory });
}

function makeNonEmptyDirectory(depth, files, folders, dirname, createSymLinks) {
  fs.mkdirSync(dirname, { recursive: true });
  fs.writeFileSync(path.join(dirname, 'text.txt'), 'hello', 'utf8');

  const options = { flag: 'wx' };

  for (let f = files; f > 0; f--) {
    fs.writeFileSync(path.join(dirname, `f-${depth}-${f}`), '', options);
  }

  if (createSymLinks) {
    // Valid symlink
    fs.symlinkSync(
      `f-${depth}-1`,
      path.join(dirname, `link-${depth}-good`),
      'file'
    );

    // Invalid symlink
    fs.symlinkSync(
      'does-not-exist',
      path.join(dirname, `link-${depth}-bad`),
      'file'
    );
  }

  // File with a name that looks like a glob
  fs.writeFileSync(path.join(dirname, '[a-z0-9].txt'), '', options);

  depth--;
  if (depth <= 0) {
    return;
  }

  for (let f = folders; f > 0; f--) {
    fs.mkdirSync(
      path.join(dirname, `folder-${depth}-${f}`),
      { recursive: true }
    );
    makeNonEmptyDirectory(
      depth,
      files,
      folders,
      path.join(dirname, `d-${depth}-${f}`),
      createSymLinks
    );
  }
}

function removeAsync(dir) {
  // Removal should fail without the recursive option.
  fs.rm(dir, common.mustCall((err) => {
    assert.strictEqual(err.syscall, 'rm');

    // Removal should fail without the recursive option set to true.
    fs.rm(dir, { recursive: false }, common.mustCall((err) => {
      assert.strictEqual(err.syscall, 'rm');

      // Recursive removal should succeed.
      fs.rm(dir, { recursive: true }, common.mustSucceed(() => {

        // Attempted removal should fail now because the directory is gone.
        fs.rm(dir, common.mustCall((err) => {
          assert.strictEqual(err.syscall, 'stat');
        }));
      }));
    }));
  }));
}

// Test the asynchronous version
{
  // Create a 4-level folder hierarchy including symlinks
  let dir = nextDirPath();
  makeNonEmptyDirectory(4, 10, 2, dir, true);
  removeAsync(dir);

  // Create a 2-level folder hierarchy without symlinks
  dir = nextDirPath();
  makeNonEmptyDirectory(2, 10, 2, dir, false);
  removeAsync(dir);

  // Same test using URL instead of a path
  dir = nextDirPath();
  makeNonEmptyDirectory(2, 10, 2, dir, false);
  removeAsync(pathToFileURL(dir));

  // Create a flat folder including symlinks
  dir = nextDirPath();
  makeNonEmptyDirectory(1, 10, 2, dir, true);
  removeAsync(dir);

  // Should fail if target does not exist
  fs.rm(
    path.join(tmpdir.path, 'noexist.txt'),
    { recursive: true },
    common.mustCall((err) => {
      assert.strictEqual(err.code, 'ENOENT');
    })
  );

  // Should delete a file
  const filePath = path.join(tmpdir.path, 'rm-async-file.txt');
  fs.writeFileSync(filePath, '');
  fs.rm(filePath, { recursive: true }, common.mustCall((err) => {
    try {
      assert.strictEqual(err, null);
      assert.strictEqual(fs.existsSync(filePath), false);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  }));
}

// Removing a .git directory should not throw an EPERM.
// Refs: https://github.com/isaacs/rimraf/issues/21.
if (isGitPresent) {
  const gitDirectory = nextDirPath();
  gitInit(gitDirectory);
  fs.rm(gitDirectory, { recursive: true }, common.mustSucceed(() => {
    assert.strictEqual(fs.existsSync(gitDirectory), false);
  }));
}

// Test the synchronous version.
{
  const dir = nextDirPath();
  makeNonEmptyDirectory(4, 10, 2, dir, true);

  // Removal should fail without the recursive option set to true.
  assert.throws(() => {
    fs.rmSync(dir);
  }, { syscall: 'rm' });
  assert.throws(() => {
    fs.rmSync(dir, { recursive: false });
  }, { syscall: 'rm' });

  // Should fail if target does not exist
  assert.throws(() => {
    fs.rmSync(path.join(tmpdir.path, 'noexist.txt'), { recursive: true });
  }, {
    code: 'ENOENT',
    name: 'Error',
    message: /^ENOENT: no such file or directory, stat/
  });

  // Should delete a file
  const filePath = path.join(tmpdir.path, 'rm-file.txt');
  fs.writeFileSync(filePath, '');

  try {
    fs.rmSync(filePath, { recursive: true });
  } finally {
    fs.rmSync(filePath, { force: true });
  }

  // Should accept URL
  const fileURL = pathToFileURL(path.join(tmpdir.path, 'rm-file.txt'));
  fs.writeFileSync(fileURL, '');

  try {
    fs.rmSync(fileURL, { recursive: true });
  } finally {
    fs.rmSync(fileURL, { force: true });
  }

  // Recursive removal should succeed.
  fs.rmSync(dir, { recursive: true });

  // Attempted removal should fail now because the directory is gone.
  assert.throws(() => fs.rmSync(dir), { syscall: 'stat' });
}

// Removing a .git directory should not throw an EPERM.
// Refs: https://github.com/isaacs/rimraf/issues/21.
if (isGitPresent) {
  const gitDirectory = nextDirPath();
  gitInit(gitDirectory);
  fs.rmSync(gitDirectory, { recursive: true });
  assert.strictEqual(fs.existsSync(gitDirectory), false);
}

// Test the Promises based version.
(async () => {
  const dir = nextDirPath();
  makeNonEmptyDirectory(4, 10, 2, dir, true);

  // Removal should fail without the recursive option set to true.
  await assert.rejects(fs.promises.rm(dir), { syscall: 'rm' });
  await assert.rejects(fs.promises.rm(dir, { recursive: false }), {
    syscall: 'rm'
  });

  // Recursive removal should succeed.
  await fs.promises.rm(dir, { recursive: true });

  // Attempted removal should fail now because the directory is gone.
  await assert.rejects(fs.promises.rm(dir), { syscall: 'stat' });

  // Should fail if target does not exist
  await assert.rejects(fs.promises.rm(
    path.join(tmpdir.path, 'noexist.txt'),
    { recursive: true }
  ), {
    code: 'ENOENT',
    name: 'Error',
    message: /^ENOENT: no such file or directory, stat/
  });

  // Should not fail if target does not exist and force option is true
  await fs.promises.rm(path.join(tmpdir.path, 'noexist.txt'), { force: true });

  // Should delete file
  const filePath = path.join(tmpdir.path, 'rm-promises-file.txt');
  fs.writeFileSync(filePath, '');

  try {
    await fs.promises.rm(filePath, { recursive: true });
  } finally {
    fs.rmSync(filePath, { force: true });
  }

  // Should accept URL
  const fileURL = pathToFileURL(path.join(tmpdir.path, 'rm-promises-file.txt'));
  fs.writeFileSync(fileURL, '');

  try {
    await fs.promises.rm(fileURL, { recursive: true });
  } finally {
    fs.rmSync(fileURL, { force: true });
  }
})().then(common.mustCall());

// Removing a .git directory should not throw an EPERM.
// Refs: https://github.com/isaacs/rimraf/issues/21.
if (isGitPresent) {
  (async () => {
    const gitDirectory = nextDirPath();
    gitInit(gitDirectory);
    await fs.promises.rm(gitDirectory, { recursive: true });
    assert.strictEqual(fs.existsSync(gitDirectory), false);
  })().then(common.mustCall());
}

// Test input validation.
{
  const dir = nextDirPath();
  makeNonEmptyDirectory(4, 10, 2, dir, true);
  const filePath = (path.join(tmpdir.path, 'rm-args-file.txt'));
  fs.writeFileSync(filePath, '');

  const defaults = {
    retryDelay: 100,
    maxRetries: 0,
    recursive: false,
    force: false
  };
  const modified = {
    retryDelay: 953,
    maxRetries: 5,
    recursive: true,
    force: false
  };

  assert.deepStrictEqual(validateRmOptionsSync(filePath), defaults);
  assert.deepStrictEqual(validateRmOptionsSync(filePath, {}), defaults);
  assert.deepStrictEqual(validateRmOptionsSync(filePath, modified), modified);
  assert.deepStrictEqual(validateRmOptionsSync(filePath, {
    maxRetries: 99
  }), {
    retryDelay: 100,
    maxRetries: 99,
    recursive: false,
    force: false
  });

  [null, 'foo', 5, NaN].forEach((bad) => {
    assert.throws(() => {
      validateRmOptionsSync(filePath, bad);
    }, {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: /^The "options" argument must be of type object\./
    });
  });

  [undefined, null, 'foo', Infinity, function() {}].forEach((bad) => {
    assert.throws(() => {
      validateRmOptionsSync(filePath, { recursive: bad });
    }, {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: /^The "options\.recursive" property must be of type boolean\./
    });
  });

  [undefined, null, 'foo', Infinity, function() {}].forEach((bad) => {
    assert.throws(() => {
      validateRmOptionsSync(filePath, { force: bad });
    }, {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: /^The "options\.force" property must be of type boolean\./
    });
  });

  assert.throws(() => {
    validateRmOptionsSync(filePath, { retryDelay: -1 });
  }, {
    code: 'ERR_OUT_OF_RANGE',
    name: 'RangeError',
    message: /^The value of "options\.retryDelay" is out of range\./
  });

  assert.throws(() => {
    validateRmOptionsSync(filePath, { maxRetries: -1 });
  }, {
    code: 'ERR_OUT_OF_RANGE',
    name: 'RangeError',
    message: /^The value of "options\.maxRetries" is out of range\./
  });
}
