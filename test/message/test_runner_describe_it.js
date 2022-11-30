// Flags: --no-warnings
'use strict';
require('../common');
const assert = require('node:assert');
const { describe, it } = require('node:test');
const util = require('util');


it.todo('sync pass todo', () => {

});

it('sync pass todo with message', { todo: 'this is a passing todo' }, () => {
});

it.todo('sync fail todo', () => {
  throw new Error('thrown from sync fail todo');
});

it('sync fail todo with message', { todo: 'this is a failing todo' }, () => {
  throw new Error('thrown from sync fail todo with message');
});

it.skip('sync skip pass', () => {
});

it('sync skip pass with message', { skip: 'this is skipped' }, () => {
});

it('sync pass', () => {
});

it('sync throw fail', () => {
  throw new Error('thrown from sync throw fail');
});

it.skip('async skip pass', async () => {
});

it('async pass', async () => {

});

it('async throw fail', async () => {
  throw new Error('thrown from async throw fail');
});

it('async skip fail', async (t) => {
  t.skip();
  throw new Error('thrown from async throw fail');
});

it('async assertion fail', async () => {
  // Make sure the assert module is handled.
  assert.strictEqual(true, false);
});

it('resolve pass', () => {
  return Promise.resolve();
});

it('reject fail', () => {
  return Promise.reject(new Error('rejected from reject fail'));
});

it('unhandled rejection - passes but warns', () => {
  Promise.reject(new Error('rejected from unhandled rejection fail'));
});

it('async unhandled rejection - passes but warns', async () => {
  Promise.reject(new Error('rejected from async unhandled rejection fail'));
});

it('immediate throw - passes but warns', () => {
  setImmediate(() => {
    throw new Error('thrown from immediate throw fail');
  });
});

it('immediate reject - passes but warns', () => {
  setImmediate(() => {
    Promise.reject(new Error('rejected from immediate reject fail'));
  });
});

it('immediate resolve pass', () => {
  return new Promise((resolve) => {
    setImmediate(() => {
      resolve();
    });
  });
});

describe('subtest sync throw fail', () => {
  it('+sync throw fail', () => {
    throw new Error('thrown from subtest sync throw fail');
  });
});

it('sync throw non-error fail', async () => {
  throw Symbol('thrown symbol from sync throw non-error fail');
});

describe('level 0a', { concurrency: 4 }, () => {
  it('level 1a', async () => {
    const p1a = new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1000);
    });

    return p1a;
  });

  it('level 1b', async () => {
    const p1b = new Promise((resolve) => {
      resolve();
    });

    return p1b;
  });

  it('level 1c', async () => {
    const p1c = new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 2000);
    });

    return p1c;
  });

  it('level 1d', async () => {
    const p1c = new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1500);
    });

    return p1c;
  });

  const p0a = new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 3000);
  });

  return p0a;
});

describe('top level', { concurrency: 2 }, () => {
  it('+long running', async () => {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, 3000).unref();
    });
  });

  describe('+short running', async () => {
    it('++short running', async () => {});
  });
});

describe('invalid subtest - pass but subtest fails', () => {
  setImmediate(() => {
    it('invalid subtest fail', () => {
      throw new Error('this should not be thrown');
    });
  });
});

it.skip('sync skip option', () => {
  throw new Error('this should not be executed');
});

it('sync skip option with message', { skip: 'this is skipped' }, () => {
  throw new Error('this should not be executed');
});

it('sync skip option is false fail', { skip: false }, () => {
  throw new Error('this should be executed');
});

// A test with no arguments provided.
it();

// A test with only a named function provided.
it(function functionOnly() {});

// A test with only an anonymous function provided.
it(() => {});

// A test with only a name provided.
it('test with only a name provided');

// A test with an empty string name.
it('');

// A test with only options provided.
it({ skip: true });

// A test with only a name and options provided.
it('test with a name and options provided', { skip: true });

// A test with only options and a function provided.
it({ skip: true }, function functionAndOptions() {});

// A test whose description needs to be escaped.
it('escaped description \\ # \\#\\');

// A test whose skip message needs to be escaped.
it('escaped skip message', { skip: '#skip' });

// A test whose todo message needs to be escaped.
it('escaped todo message', { todo: '#todo' });

it('callback pass', (done) => {
  setImmediate(done);
});

it('callback fail', (done) => {
  setImmediate(() => {
    done(new Error('callback failure'));
  });
});

it('sync t is this in test', function() {
  assert.deepStrictEqual(this, { signal: this.signal });
});

it('async t is this in test', async function() {
  assert.deepStrictEqual(this, { signal: this.signal });
});

it('callback t is this in test', function(done) {
  assert.deepStrictEqual(this, { signal: this.signal });
  done();
});

it('callback also returns a Promise', async (done) => {
  throw new Error('thrown from callback also returns a Promise');
});

it('callback throw', (done) => {
  throw new Error('thrown from callback throw');
});

it('callback called twice', (done) => {
  done();
  done();
});

it('callback called twice in different ticks', (done) => {
  setImmediate(done);
  done();
});

it('callback called twice in future tick', (done) => {
  setImmediate(() => {
    done();
    done();
  });
});

it('callback async throw', (done) => {
  setImmediate(() => {
    throw new Error('thrown from callback async throw');
  });
});

it('callback async throw after done', (done) => {
  setImmediate(() => {
    throw new Error('thrown from callback async throw after done');
  });

  done();
});

it('custom inspect symbol fail', () => {
  const obj = {
    [util.inspect.custom]() {
      return 'customized';
    },
    foo: 1
  };

  throw obj;
});

it('custom inspect symbol that throws fail', () => {
  const obj = {
    [util.inspect.custom]() {
      throw new Error('bad-inspect');
    },
    foo: 1
  };

  throw obj;
});

describe('subtest sync throw fails', () => {
  it('sync throw fails at first', () => {
    throw new Error('thrown from subtest sync throw fails at first');
  });
  it('sync throw fails at second', () => {
    throw new Error('thrown from subtest sync throw fails at second');
  });
});

describe('describe sync throw fails', () => {
  it('should not run', () => {});
  throw new Error('thrown from describe');
});

describe('describe async throw fails', async () => {
  it('should not run', () => {});
  throw new Error('thrown from describe');
});

describe('timeouts', () => {
  it('timed out async test', { timeout: 5 }, async () => {
    return new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  });

  it('timed out callback test', { timeout: 5 }, (done) => {
    setTimeout(done, 1000);
  });


  it('large timeout async test is ok', { timeout: 30_000_000 }, async () => {
    return new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });

  it('large timeout callback test is ok', { timeout: 30_000_000 }, (done) => {
    setTimeout(done, 10);
  });
});
