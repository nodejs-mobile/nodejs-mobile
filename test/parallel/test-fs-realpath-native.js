'use strict';
const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const filename = __filename.toLowerCase();

if(common.isIOS || common.isAndroid) {
  // Change the working dir for what would be expected of the test framework
  //running in a Desktop environment.
  process.chdir(path.join(__dirname,'..','..'));
}

assert.strictEqual(
  fs.realpathSync.native('./test/parallel/test-fs-realpath-native.js')
    .toLowerCase(),
  filename);

fs.realpath.native(
  './test/parallel/test-fs-realpath-native.js',
  common.mustCall(function(err, res) {
    assert.ifError(err);
    assert.strictEqual(res.toLowerCase(), filename);
    assert.strictEqual(this, undefined);
  }));
