'use strict';
const TEST_FAILED = 'RESULT:FAIL\n';
const TEST_PASSED = 'RESULT:PASS\n';

const originalExit = process.exit;
function remappedExit(val) {
  const { isMainThread } = require('worker_threads');
  if (isMainThread) {
    if (typeof val === 'undefined') {
      process.stdout.write(TEST_PASSED);
      originalExit();
    }
    if (val !== null && val !== 0) {
      process.stdout.write(TEST_FAILED);
    } else {
      process.stdout.write(TEST_PASSED);
    }
  }
  originalExit(val);
}

process.exit = remappedExit;
