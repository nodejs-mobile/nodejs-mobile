'use strict';

const common = require('../common');

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (common.isAndroid) {
  // Change the working dir for what would be expected of the test framework
  //running in a Desktop environment.
  process.chdir(path.join(__dirname, '..', '..'));
}

function recurse() {
  fs.readdirSync('.');
  recurse();
}

assert.throws(
  () => recurse(),
  {
    name: 'RangeError',
    message: 'Maximum call stack size exceeded'
  }
);
