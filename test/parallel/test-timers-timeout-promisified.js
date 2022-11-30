// Flags: --no-warnings --expose-internals
'use strict';
const common = require('../common');
const assert = require('assert');
const timers = require('timers');
const { promisify } = require('util');
const child_process = require('child_process');

// TODO(benjamingr) - refactor to use getEventListeners when #35991 lands
const { NodeEventTarget } = require('internal/event_target');

const timerPromises = require('timers/promises');

const setPromiseTimeout = promisify(timers.setTimeout);
const exec = promisify(child_process.exec);

assert.strictEqual(setPromiseTimeout, timerPromises.setTimeout);

process.on('multipleResolves', common.mustNotCall());

{
  const promise = setPromiseTimeout(1);
  promise.then(common.mustCall((value) => {
    assert.strictEqual(value, undefined);
  }));
}

{
  const promise = setPromiseTimeout(1, 'foobar');
  promise.then(common.mustCall((value) => {
    assert.strictEqual(value, 'foobar');
  }));
}

{
  const ac = new AbortController();
  const signal = ac.signal;
  assert.rejects(setPromiseTimeout(10, undefined, { signal }), /AbortError/)
    .then(common.mustCall());
  ac.abort();
}

{
  const signal = AbortSignal.abort(); // Abort in advance
  assert.rejects(setPromiseTimeout(10, undefined, { signal }), /AbortError/)
    .then(common.mustCall());
}

{
  // Check that aborting after resolve will not reject.
  const ac = new AbortController();
  const signal = ac.signal;
  setPromiseTimeout(10, undefined, { signal })
    .then(common.mustCall(() => { ac.abort(); }))
    .then(common.mustCall());
}

{
  // Check that timer adding signals does not leak handlers
  const signal = new NodeEventTarget();
  signal.aborted = false;
  setPromiseTimeout(0, null, { signal }).finally(common.mustCall(() => {
    assert.strictEqual(signal.listenerCount('abort'), 0);
  }));
}

{
  Promise.all(
    [1, '', false, Infinity].map(
      (i) => assert.rejects(setPromiseTimeout(10, null, i), {
        code: 'ERR_INVALID_ARG_TYPE'
      })
    )
  ).then(common.mustCall());

  Promise.all(
    [1, '', false, Infinity, null, {}].map(
      (signal) => assert.rejects(setPromiseTimeout(10, null, { signal }), {
        code: 'ERR_INVALID_ARG_TYPE'
      })
    )
  ).then(common.mustCall());

  Promise.all(
    [1, '', Infinity, null, {}].map(
      (ref) => assert.rejects(setPromiseTimeout(10, null, { ref }), {
        code: 'ERR_INVALID_ARG_TYPE'
      })
    )
  ).then(common.mustCall());
}

{
  exec(`${process.execPath} -pe "const assert = require('assert');` +
    'require(\'timers/promises\').setTimeout(1000, null, { ref: false }).' +
    'then(assert.fail)"').then(common.mustCall(({ stderr }) => {
    assert.strictEqual(stderr, '');
  }));
}

(async () => {
  const signal = AbortSignal.abort('boom');
  await assert.rejects(timerPromises.setTimeout(1, undefined, { signal }), {
    cause: 'boom',
  });
})().then(common.mustCall());
