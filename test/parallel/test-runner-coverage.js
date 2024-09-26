'use strict';
const common = require('../common');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { test } = require('node:test');
const fixtures = require('../common/fixtures');
const tmpdir = require('../common/tmpdir');
const skipIfNoInspector = {
  skip: !process.features.inspector ? 'inspector disabled' : false
};

tmpdir.refresh();

function findCoverageFileForPid(pid) {
  const pattern = `^coverage\\-${pid}\\-(\\d{13})\\-(\\d+)\\.json$`;
  const regex = new RegExp(pattern);

  return readdirSync(tmpdir.path).find((file) => {
    return regex.test(file);
  });
}

function getTapCoverageFixtureReport() {
  const report = [
    '# start of coverage report',
    '# file | line % | branch % | funcs % | uncovered lines',
    '# test/fixtures/test-runner/coverage.js | 78.65 | 38.46 | 60.00 | 12, ' +
    '13, 16, 17, 18, 19, 20, 21, 22, 27, 39, 43, 44, 61, 62, 66, 67, 71, 72',
    '# test/fixtures/test-runner/invalid-tap.js | 100.00 | 100.00 | 100.00 | ',
    '# test/fixtures/v8-coverage/throw.js | 71.43 | 50.00 | 100.00 | 5, 6',
    '# all files | 78.35 | 43.75 | 60.00 |',
    '# end of coverage report',
  ].join('\n');

  if (common.isWindows) {
    return report.replaceAll('/', '\\');
  }

  return report;
}

function getSpecCoverageFixtureReport() {
  /* eslint-disable max-len */
  const report = [
    '\u2139 start of coverage report',
    '\u2139 -------------------------------------------------------------------------------------------------------------------',
    '\u2139 file                                     | line % | branch % | funcs % | uncovered lines',
    '\u2139 -------------------------------------------------------------------------------------------------------------------',
    '\u2139 test/fixtures/test-runner/coverage.js    |  78.65 |    38.46 |   60.00 | 12-13 16-22 27 39 43-44 61-62 66-67 71-72',
    '\u2139 test/fixtures/test-runner/invalid-tap.js | 100.00 |   100.00 |  100.00 | ',
    '\u2139 test/fixtures/v8-coverage/throw.js       |  71.43 |    50.00 |  100.00 | 5-6',
    '\u2139 -------------------------------------------------------------------------------------------------------------------',
    '\u2139 all files                                |  78.35 |    43.75 |   60.00 |',
    '\u2139 -------------------------------------------------------------------------------------------------------------------',
    '\u2139 end of coverage report',
  ].join('\n');
  /* eslint-enable max-len */

  if (common.isWindows) {
    return report.replaceAll('/', '\\');
  }

  return report;
}

test('test coverage report', async (t) => {
  await t.test('handles the inspector not being available', (t) => {
    if (process.features.inspector) {
      return;
    }

    const fixture = fixtures.path('test-runner', 'coverage.js');
    const args = ['--experimental-test-coverage', fixture];
    const result = spawnSync(process.execPath, args);

    assert(!result.stdout.toString().includes('# start of coverage report'));
    assert(result.stderr.toString().includes('coverage could not be collected'));
    assert.strictEqual(result.status, 0);
    assert(!findCoverageFileForPid(result.pid));
  });
});

test('test tap coverage reporter', skipIfNoInspector, async (t) => {
  await t.test('coverage is reported and dumped to NODE_V8_COVERAGE if present', (t) => {
    const fixture = fixtures.path('test-runner', 'coverage.js');
    const args = ['--experimental-test-coverage', '--test-reporter', 'tap', fixture];
    const options = { env: { ...process.env, NODE_V8_COVERAGE: tmpdir.path } };
    const result = spawnSync(process.execPath, args, options);
    const report = getTapCoverageFixtureReport();

    assert(result.stdout.toString().includes(report));
    assert.strictEqual(result.stderr.toString(), '');
    assert.strictEqual(result.status, 0);
    assert(findCoverageFileForPid(result.pid));
  });

  await t.test('coverage is reported without NODE_V8_COVERAGE present', (t) => {
    const fixture = fixtures.path('test-runner', 'coverage.js');
    const args = ['--experimental-test-coverage', '--test-reporter', 'tap', fixture];
    const result = spawnSync(process.execPath, args);
    const report = getTapCoverageFixtureReport();

    assert(result.stdout.toString().includes(report));
    assert.strictEqual(result.stderr.toString(), '');
    assert.strictEqual(result.status, 0);
    assert(!findCoverageFileForPid(result.pid));
  });
});

test('test spec coverage reporter', skipIfNoInspector, async (t) => {
  await t.test('coverage is reported and dumped to NODE_V8_COVERAGE if present', (t) => {
    const fixture = fixtures.path('test-runner', 'coverage.js');
    const args = ['--experimental-test-coverage', '--test-reporter', 'spec', fixture];
    const options = { env: { ...process.env, NODE_V8_COVERAGE: tmpdir.path } };
    const result = spawnSync(process.execPath, args, options);
    const report = getSpecCoverageFixtureReport();

    assert(result.stdout.toString().includes(report));
    assert.strictEqual(result.stderr.toString(), '');
    assert.strictEqual(result.status, 0);
    assert(findCoverageFileForPid(result.pid));
  });

  await t.test('coverage is reported without NODE_V8_COVERAGE present', (t) => {
    const fixture = fixtures.path('test-runner', 'coverage.js');
    const args = ['--experimental-test-coverage', '--test-reporter', 'spec', fixture];
    const result = spawnSync(process.execPath, args);
    const report = getSpecCoverageFixtureReport();

    assert(result.stdout.toString().includes(report));
    assert.strictEqual(result.stderr.toString(), '');
    assert.strictEqual(result.status, 0);
    assert(!findCoverageFileForPid(result.pid));
  });
});

test('single process coverage is the same with --test', skipIfNoInspector, () => {
  const fixture = fixtures.path('test-runner', 'coverage.js');
  const args = [
    '--test', '--experimental-test-coverage', '--test-reporter', 'tap', fixture,
  ];
  const result = spawnSync(process.execPath, args);
  const report = getTapCoverageFixtureReport();

  assert.strictEqual(result.stderr.toString(), '');
  assert(result.stdout.toString().includes(report));
  assert.strictEqual(result.status, 0);
  assert(!findCoverageFileForPid(result.pid));
});

test('coverage is combined for multiple processes', skipIfNoInspector, () => {
  let report = [
    '# start of coverage report',
    '# file | line % | branch % | funcs % | uncovered lines',
    '# test/fixtures/v8-coverage/combined_coverage/common.js | 89.86 | ' +
    '62.50 | 100.00 | 8, 13, 14, 18, 34, 35, 53',
    '# test/fixtures/v8-coverage/combined_coverage/first.test.js | 83.33 | ' +
    '100.00 | 50.00 | 5, 6',
    '# test/fixtures/v8-coverage/combined_coverage/second.test.js | 100.00 ' +
    '| 100.00 | 100.00 | ',
    '# test/fixtures/v8-coverage/combined_coverage/third.test.js | 100.00 | ' +
    '100.00 | 100.00 | ',
    '# all files | 92.11 | 72.73 | 88.89 |',
    '# end of coverage report',
  ].join('\n');

  if (common.isWindows) {
    report = report.replaceAll('/', '\\');
  }

  const fixture = fixtures.path('v8-coverage', 'combined_coverage');
  const args = [
    '--test', '--experimental-test-coverage', '--test-reporter', 'tap', fixture,
  ];
  const result = spawnSync(process.execPath, args, {
    env: { ...process.env, NODE_TEST_TMPDIR: tmpdir.path }
  });

  assert.strictEqual(result.stderr.toString(), '');
  assert(result.stdout.toString().includes(report));
  assert.strictEqual(result.status, 0);
});
