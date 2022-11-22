'use strict';
const common = require('../common');

if (common.isIBMi)
  common.skip('IBMi does not support `fs.watch()`');

// Tests if `filename` is provided to watcher on supported platforms

const fs = require('fs');
const assert = require('assert');
const { join } = require('path');

class WatchTestCase {
  constructor(shouldInclude, dirName, fileName, field) {
    this.dirName = dirName;
    this.fileName = fileName;
    this.field = field;
    this.shouldSkip = !shouldInclude;
  }
  get dirPath() { return join(tmpdir.path, this.dirName); }
  get filePath() { return join(this.dirPath, this.fileName); }
}

const cases = [
  // Watch on a directory should callback with a filename on supported systems
  new WatchTestCase(
    common.isLinux || common.isOSX || common.isWindows || common.isAIX || common.isAndroid || common.isIOS,
    'watch1',
    'foo',
    'filePath'
  ),
  // Watch on a file should callback with a filename on supported systems
  new WatchTestCase(
    common.isLinux || common.isOSX || common.isWindows || common.isAndroid,
    'watch2',
    'bar',
    'dirPath'
  )
];

const tmpdir = require('../common/tmpdir');
tmpdir.refresh();

for (const testCase of cases) {
  if (testCase.shouldSkip) continue;
  fs.mkdirSync(testCase.dirPath);
  // Long content so it's actually flushed.
  const content1 = Date.now() + testCase.fileName.toLowerCase().repeat(1e4);
  fs.writeFileSync(testCase.filePath, content1);

  let interval;
  const pathToWatch = testCase[testCase.field];
  const watcher = fs.watch(pathToWatch);
  watcher.on('error', (err) => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    assert.fail(err);
  });
  watcher.on('close', common.mustCall(() => {
    watcher.close(); // Closing a closed watcher should be a noop
    // Starting a closed watcher should be a noop
    watcher.start();
  }));
  watcher.on('change', common.mustCall(function(eventType, argFilename) {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (common.isOSX || common.isIOS)
      assert.strictEqual(['rename', 'change'].includes(eventType), true);
    else
      assert.strictEqual(eventType, 'change');
    assert.strictEqual(argFilename, testCase.fileName);

    // Starting a started watcher should be a noop
    watcher.start();
    watcher.start(pathToWatch);

    watcher.close();

    // We document that watchers cannot be used anymore when it's closed,
    // here we turn the methods into noops instead of throwing
    watcher.close(); // Closing a closed watcher should be a noop
    watcher.start();  // Starting a closed watcher should be a noop
  }));

  // Long content so it's actually flushed. toUpperCase so there's real change.
  const content2 = Date.now() + testCase.fileName.toUpperCase().repeat(1e4);
  interval = setInterval(() => {
    fs.writeFileSync(testCase.filePath, '');
    fs.writeFileSync(testCase.filePath, content2);
  }, 100);
}

[false, 1, {}, [], null, undefined].forEach((input) => {
  assert.throws(
    () => fs.watch(input, common.mustNotCall()),
    {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError'
    }
  );
});
