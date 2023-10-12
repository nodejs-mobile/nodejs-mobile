'use strict';

require('../common');

const assert = require('assert');

setTimeout(() => {}, 0);

// nodejs-mobile patch to add PipeWrap for Android and TTYWrap for iOS
assert.deepStrictEqual(process.getActiveResourcesInfo(), [
  process.platform === 'ios' ? 'TTYWrap' : 'PipeWrap',
  'Timeout'
]);
