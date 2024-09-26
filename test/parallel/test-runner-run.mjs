import * as common from '../common/index.mjs';
import * as fixtures from '../common/fixtures.mjs';
import { join } from 'node:path';
import { describe, it, run } from 'node:test';
import { dot, spec, tap } from 'node:test/reporters';
import assert from 'node:assert';

const testFixtures = fixtures.path('test-runner');

describe('require(\'node:test\').run', { concurrency: true }, () => {

  it('should run with no tests', async () => {
    const stream = run({ files: [] });
    stream.on('test:fail', common.mustNotCall());
    stream.on('test:pass', common.mustNotCall());
    // eslint-disable-next-line no-unused-vars
    for await (const _ of stream);
  });

  it('should fail with non existing file', async () => {
    const stream = run({ files: ['a-random-file-that-does-not-exist.js'] });
    stream.on('test:fail', common.mustCall(1));
    stream.on('test:pass', common.mustNotCall());
    // eslint-disable-next-line no-unused-vars
    for await (const _ of stream);
  });

  it('should succeed with a file', async () => {
    const stream = run({ files: [join(testFixtures, 'default-behavior/test/random.cjs')] });
    stream.on('test:fail', common.mustNotCall());
    stream.on('test:pass', common.mustCall(1));
    // eslint-disable-next-line no-unused-vars
    for await (const _ of stream);
  });

  it('should run same file twice', async () => {
    const stream = run({
      files: [
        join(testFixtures, 'default-behavior/test/random.cjs'),
        join(testFixtures, 'default-behavior/test/random.cjs'),
      ]
    });
    stream.on('test:fail', common.mustNotCall());
    stream.on('test:pass', common.mustCall(2));
    // eslint-disable-next-line no-unused-vars
    for await (const _ of stream);
  });

  it('should run a failed test', async () => {
    const stream = run({ files: [testFixtures] });
    stream.on('test:fail', common.mustCall(1));
    stream.on('test:pass', common.mustNotCall());
    // eslint-disable-next-line no-unused-vars
    for await (const _ of stream);
  });

  it('should support timeout', async () => {
    const stream = run({ timeout: 50, files: [
      fixtures.path('test-runner', 'never_ending_sync.js'),
      fixtures.path('test-runner', 'never_ending_async.js'),
    ] });
    stream.on('test:fail', common.mustCall(2));
    stream.on('test:pass', common.mustNotCall());
    // eslint-disable-next-line no-unused-vars
    for await (const _ of stream);
  });

  it('should validate files', async () => {
    [Symbol(), {}, () => {}, 0, 1, 0n, 1n, '', '1', Promise.resolve([]), true, false]
      .forEach((files) => assert.throws(() => run({ files }), {
        code: 'ERR_INVALID_ARG_TYPE'
      }));
  });

  it('should be piped with dot', async () => {
    const result = await run({
      files: [join(testFixtures, 'default-behavior/test/random.cjs')]
    }).compose(dot).toArray();
    assert.deepStrictEqual(result, [
      '.',
      '\n',
    ]);
  });

  describe('should be piped with spec reporter', () => {
    it('new spec', async () => {
      const specReporter = new spec();
      const result = await run({
        files: [join(testFixtures, 'default-behavior/test/random.cjs')]
      }).compose(specReporter).toArray();
      const stringResults = result.map((bfr) => bfr.toString());
      assert.match(stringResults[0], /this should pass/);
      assert.match(stringResults[1], /tests 1/);
      assert.match(stringResults[1], /pass 1/);
    });

    it('spec()', async () => {
      const specReporter = spec();
      const result = await run({
        files: [join(testFixtures, 'default-behavior/test/random.cjs')]
      }).compose(specReporter).toArray();
      const stringResults = result.map((bfr) => bfr.toString());
      assert.match(stringResults[0], /this should pass/);
      assert.match(stringResults[1], /tests 1/);
      assert.match(stringResults[1], /pass 1/);
    });
  });

  it('should be piped with tap', async () => {
    const result = await run({
      files: [join(testFixtures, 'default-behavior/test/random.cjs')]
    }).compose(tap).toArray();
    assert.strictEqual(result.length, 13);
    assert.strictEqual(result[0], 'TAP version 13\n');
    assert.strictEqual(result[1], '# Subtest: this should pass\n');
    assert.strictEqual(result[2], 'ok 1 - this should pass\n');
    assert.match(result[3], /duration_ms: \d+\.?\d*/);
    assert.strictEqual(result[4], '1..1\n');
    assert.strictEqual(result[5], '# tests 1\n');
    assert.strictEqual(result[6], '# suites 0\n');
    assert.strictEqual(result[7], '# pass 1\n');
    assert.strictEqual(result[8], '# fail 0\n');
    assert.strictEqual(result[9], '# cancelled 0\n');
    assert.strictEqual(result[10], '# skipped 0\n');
    assert.strictEqual(result[11], '# todo 0\n');
    assert.match(result[12], /# duration_ms \d+\.?\d*/);
  });

  it('should skip tests not matching testNamePatterns - RegExp', async () => {
    const result = await run({
      files: [join(testFixtures, 'default-behavior/test/skip_by_name.cjs')],
      testNamePatterns: [/executed/]
    })
      .compose(tap)
      .toArray();
    assert.strictEqual(result[2], 'ok 1 - this should be skipped # SKIP test name does not match pattern\n');
    assert.strictEqual(result[5], 'ok 2 - this should be executed\n');
  });

  it('should skip tests not matching testNamePatterns - string', async () => {
    const result = await run({
      files: [join(testFixtures, 'default-behavior/test/skip_by_name.cjs')],
      testNamePatterns: ['executed']
    })
      .compose(tap)
      .toArray();
    assert.strictEqual(result[2], 'ok 1 - this should be skipped # SKIP test name does not match pattern\n');
    assert.strictEqual(result[5], 'ok 2 - this should be executed\n');
  });

  it('should pass only to children', async () => {
    const result = await run({
      files: [join(testFixtures, 'test_only.js')],
      only: true
    })
      .compose(tap)
      .toArray();

    assert.strictEqual(result[2], 'ok 1 - this should be skipped # SKIP \'only\' option not set\n');
    assert.strictEqual(result[5], 'ok 2 - this should be executed\n');
  });

  it('should emit "test:watch:drained" event on watch mode', async () => {
    const controller = new AbortController();
    await run({
      files: [join(testFixtures, 'default-behavior/test/random.cjs')],
      watch: true,
      signal: controller.signal,
    }).on('data', function({ type }) {
      if (type === 'test:watch:drained') {
        controller.abort();
      }
    });
  });

  describe('AbortSignal', () => {
    it('should stop watch mode when abortSignal aborts', async () => {
      const controller = new AbortController();
      const result = await run({
        files: [join(testFixtures, 'default-behavior/test/random.cjs')],
        watch: true,
        signal: controller.signal,
      })
        .compose(async function* (source) {
          for await (const chunk of source) {
            if (chunk.type === 'test:pass') {
              controller.abort();
              yield chunk.data.name;
            }
          }
        })
        .toArray();
      assert.deepStrictEqual(result, ['this should pass']);
    });

    it('should abort when test succeeded', async () => {
      const stream = run({
        files: [
          fixtures.path(
            'test-runner',
            'aborts',
            'successful-test-still-call-abort.js'
          ),
        ],
      });

      let passedTestCount = 0;
      let failedTestCount = 0;

      let output = '';
      for await (const data of stream) {
        if (data.type === 'test:stdout') {
          output += data.data.message.toString();
        }
        if (data.type === 'test:fail') {
          failedTestCount++;
        }
        if (data.type === 'test:pass') {
          passedTestCount++;
        }
      }

      assert.match(output, /abort called for test 1/);
      assert.match(output, /abort called for test 2/);
      assert.strictEqual(failedTestCount, 0, new Error('no tests should fail'));
      assert.strictEqual(passedTestCount, 2);
    });

    it('should abort when test failed', async () => {
      const stream = run({
        files: [
          fixtures.path(
            'test-runner',
            'aborts',
            'failed-test-still-call-abort.js'
          ),
        ],
      });

      let passedTestCount = 0;
      let failedTestCount = 0;

      let output = '';
      for await (const data of stream) {
        if (data.type === 'test:stdout') {
          output += data.data.message.toString();
        }
        if (data.type === 'test:fail') {
          failedTestCount++;
        }
        if (data.type === 'test:pass') {
          passedTestCount++;
        }
      }

      assert.match(output, /abort called for test 1/);
      assert.match(output, /abort called for test 2/);
      assert.strictEqual(passedTestCount, 0, new Error('no tests should pass'));
      assert.strictEqual(failedTestCount, 2);
    });
  });

  describe('sharding', () => {
    const shardsTestsFixtures = fixtures.path('test-runner', 'shards');
    const shardsTestsFiles = [
      'a.cjs',
      'b.cjs',
      'c.cjs',
      'd.cjs',
      'e.cjs',
      'f.cjs',
      'g.cjs',
      'h.cjs',
      'i.cjs',
      'j.cjs',
    ].map((file) => join(shardsTestsFixtures, file));

    describe('validation', () => {
      it('should require shard.total when having shard option', () => {
        assert.throws(() => run({ files: shardsTestsFiles, shard: {} }), {
          name: 'TypeError',
          code: 'ERR_INVALID_ARG_TYPE',
          message: 'The "options.shard.total" property must be of type number. Received undefined'
        });
      });

      it('should require shard.index when having shards option', () => {
        assert.throws(() => run({
          files: shardsTestsFiles,
          shard: {
            total: 5
          }
        }), {
          name: 'TypeError',
          code: 'ERR_INVALID_ARG_TYPE',
          message: 'The "options.shard.index" property must be of type number. Received undefined'
        });
      });

      it('should require shard.total to be greater than 0 when having shard option', () => {
        assert.throws(() => run({
          files: shardsTestsFiles,
          shard: {
            total: 0,
            index: 1
          }
        }), {
          name: 'RangeError',
          code: 'ERR_OUT_OF_RANGE',
          message:
            'The value of "options.shard.total" is out of range. It must be >= 1 && <= 9007199254740991. Received 0'
        });
      });

      it('should require shard.index to be greater than 0 when having shard option', () => {
        assert.throws(() => run({
          files: shardsTestsFiles,
          shard: {
            total: 6,
            index: 0
          }
        }), {
          name: 'RangeError',
          code: 'ERR_OUT_OF_RANGE',
          // eslint-disable-next-line max-len
          message: 'The value of "options.shard.index" is out of range. It must be >= 1 && <= 6 ("options.shard.total"). Received 0'
        });
      });

      it('should require shard.index to not be greater than the shards total when having shard option', () => {
        assert.throws(() => run({
          files: shardsTestsFiles,
          shard: {
            total: 6,
            index: 7
          }
        }), {
          name: 'RangeError',
          code: 'ERR_OUT_OF_RANGE',
          // eslint-disable-next-line max-len
          message: 'The value of "options.shard.index" is out of range. It must be >= 1 && <= 6 ("options.shard.total"). Received 7'
        });
      });

      it('should require watch mode to be disabled when having shard option', () => {
        assert.throws(() => run({
          files: shardsTestsFiles,
          watch: true,
          shard: {
            total: 6,
            index: 1
          }
        }), {
          name: 'TypeError',
          code: 'ERR_INVALID_ARG_VALUE',
          message: 'The property \'options.shard\' shards not supported with watch mode. Received true'
        });
      });
    });

    it('should run only the tests files matching the shard index', async () => {
      const stream = run({
        files: shardsTestsFiles,
        shard: {
          total: 5,
          index: 1
        }
      });

      const executedTestFiles = [];
      stream.on('test:fail', common.mustNotCall());
      stream.on('test:pass', (passedTest) => {
        executedTestFiles.push(passedTest.file);
      });
      // eslint-disable-next-line no-unused-vars
      for await (const _ of stream) ;

      assert.deepStrictEqual(executedTestFiles, [
        join(shardsTestsFixtures, 'a.cjs'),
        join(shardsTestsFixtures, 'f.cjs'),
      ]);
    });

    it('different shards should not run the same file', async () => {
      const executedTestFiles = [];

      const testStreams = [];
      const shards = 5;
      for (let i = 1; i <= shards; i++) {
        const stream = run({
          files: shardsTestsFiles,
          shard: {
            total: shards,
            index: i
          }
        });
        stream.on('test:fail', common.mustNotCall());
        stream.on('test:pass', (passedTest) => {
          executedTestFiles.push(passedTest.file);
        });
        testStreams.push(stream);
      }

      await Promise.all(testStreams.map(async (stream) => {
        // eslint-disable-next-line no-unused-vars
        for await (const _ of stream) ;
      }));

      assert.deepStrictEqual(executedTestFiles, [...new Set(executedTestFiles)]);
    });

    it('combination of all shards should be all the tests', async () => {
      const executedTestFiles = [];

      const testStreams = [];
      const shards = 5;
      for (let i = 1; i <= shards; i++) {
        const stream = run({
          files: shardsTestsFiles,
          shard: {
            total: shards,
            index: i
          }
        });
        stream.on('test:fail', common.mustNotCall());
        stream.on('test:pass', (passedTest) => {
          executedTestFiles.push(passedTest.file);
        });
        testStreams.push(stream);
      }

      await Promise.all(testStreams.map(async (stream) => {
        // eslint-disable-next-line no-unused-vars
        for await (const _ of stream) ;
      }));

      assert.deepStrictEqual(executedTestFiles.sort(), [...shardsTestsFiles].sort());
    });
  });
});
