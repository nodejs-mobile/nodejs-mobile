'use strict';

const common = require('../common');
const assert = require('assert');

const { PerformanceObserver, performance } = require('perf_hooks');
const DELAY = 1000;

const expected = ['Start to Now', 'A to Now', 'A to B'];
const obs = new PerformanceObserver(common.mustCall((items) => {
  items.getEntries().forEach(({ name, duration }) => {
    assert.ok(duration > DELAY);
    assert.strictEqual(expected.shift(), name);
  });
}));
obs.observe({ entryTypes: ['measure'] });

performance.mark('A');
setTimeout(common.mustCall(() => {
  performance.measure('Start to Now');
  performance.measure('A to Now', 'A');

  performance.mark('B');
  performance.measure('A to B', 'A', 'B');
}), DELAY);
