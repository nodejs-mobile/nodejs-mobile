'use strict';

require('../common');

const assert = require('assert');

setTimeout(() => {}, 0);

// nodejs-mobile patch to add PipeWrap
assert.deepStrictEqual(process.getActiveResourcesInfo(), ['PipeWrap', 'Timeout']);
