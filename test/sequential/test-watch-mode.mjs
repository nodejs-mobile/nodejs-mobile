import * as common from '../common/index.mjs';
import tmpdir from '../common/tmpdir.js';
import assert from 'node:assert';
import path from 'node:path';
import { execPath } from 'node:process';
import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

if (common.isIBMi)
  common.skip('IBMi does not support `fs.watch()`');

const supportsRecursive = common.isOSX || common.isWindows;

function restart(file, content = readFileSync(file)) {
  // To avoid flakiness, we save the file repeatedly until test is done
  writeFileSync(file, content);
  const timer = setInterval(() => writeFileSync(file, content), common.platformTimeout(2500));
  return () => clearInterval(timer);
}

let tmpFiles = 0;
function createTmpFile(content = 'console.log("running");', ext = '.js', basename = tmpdir.path) {
  const file = path.join(basename, `${tmpFiles++}${ext}`);
  writeFileSync(file, content);
  return file;
}

async function runWriteSucceed({
  file, watchedFile, args = [file], completed = 'Completed running', restarts = 2
}) {
  const child = spawn(execPath, ['--watch', '--no-warnings', ...args], { encoding: 'utf8', stdio: 'pipe' });
  let completes = 0;
  let cancelRestarts = () => {};
  let stderr = '';
  const stdout = [];

  child.stderr.on('data', (data) => {
    stderr += data;
  });

  try {
    // Break the chunks into lines
    for await (const data of createInterface({ input: child.stdout })) {
      if (!data.startsWith('Waiting for graceful termination') && !data.startsWith('Gracefully restarted')) {
        stdout.push(data);
      }
      if (data.startsWith(completed)) {
        completes++;
        if (completes === restarts) {
          break;
        }
        if (completes === 1) {
          cancelRestarts = restart(watchedFile);
        }
      }
    }
  } finally {
    child.kill();
    cancelRestarts();
  }
  return { stdout, stderr };
}

async function failWriteSucceed({ file, watchedFile }) {
  const child = spawn(execPath, ['--watch', '--no-warnings', file], { encoding: 'utf8', stdio: 'pipe' });
  let cancelRestarts = () => {};

  try {
    // Break the chunks into lines
    for await (const data of createInterface({ input: child.stdout })) {
      if (data.startsWith('Completed running')) {
        break;
      }
      if (data.startsWith('Failed running')) {
        cancelRestarts = restart(watchedFile, 'console.log("test has ran");');
      }
    }
  } finally {
    child.kill();
    cancelRestarts();
  }
}

tmpdir.refresh();

describe('watch mode', { concurrency: true, timeout: 60_000 }, () => {
  it('should watch changes to a file - event loop ended', async () => {
    const file = createTmpFile();
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
    ]);
  });

  it('should watch changes to a failing file', async () => {
    const file = createTmpFile('throw new Error("fails");');
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file, completed: 'Failed running' });

    assert.match(stderr, /Error: fails\r?\n/);
    assert.deepStrictEqual(stdout, [
      `Failed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      `Failed running ${inspect(file)}`,
    ]);
  });

  it('should watch changes to a file with watch-path', {
    skip: !supportsRecursive,
  }, async () => {
    const dir = path.join(tmpdir.path, 'subdir1');
    mkdirSync(dir);
    const file = createTmpFile();
    const watchedFile = createTmpFile('', '.js', dir);
    const args = ['--watch-path', dir, file];
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile, args });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
    ]);
    assert.strictEqual(stderr, '');
  });

  it('should watch when running an non-existing file - when specified under --watch-path', {
    skip: !supportsRecursive
  }, async () => {
    const dir = path.join(tmpdir.path, 'subdir2');
    mkdirSync(dir);
    const file = path.join(dir, 'non-existing.js');
    const watchedFile = createTmpFile('', '.js', dir);
    const args = ['--watch-path', dir, file];
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile, args, completed: 'Failed running' });

    assert.match(stderr, /Error: Cannot find module/g);
    assert.deepStrictEqual(stdout, [
      `Failed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      `Failed running ${inspect(file)}`,
    ]);
  });

  it('should watch when running an non-existing file - when specified under --watch-path with equals', {
    skip: !supportsRecursive
  }, async () => {
    const dir = path.join(tmpdir.path, 'subdir3');
    mkdirSync(dir);
    const file = path.join(dir, 'non-existing.js');
    const watchedFile = createTmpFile('', '.js', dir);
    const args = [`--watch-path=${dir}`, file];
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile, args, completed: 'Failed running' });

    assert.match(stderr, /Error: Cannot find module/g);
    assert.deepStrictEqual(stdout, [
      `Failed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      `Failed running ${inspect(file)}`,
    ]);
  });

  it('should watch changes to a file - event loop blocked', { timeout: 10_000 }, async () => {
    const file = createTmpFile(`
console.log("running");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
console.log("don't show me");`);
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file, completed: 'running' });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Restarting ${inspect(file)}`,
      'running',
    ]);
  });

  it('should watch changes to dependencies - cjs', async () => {
    const dependency = createTmpFile('module.exports = {};');
    const file = createTmpFile(`
const dependency = require(${JSON.stringify(dependency)});
console.log(dependency);
`);
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: dependency });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      '{}',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      '{}',
      `Completed running ${inspect(file)}`,
    ]);
  });

  it('should watch changes to dependencies - esm', async () => {
    const dependency = createTmpFile('module.exports = {};');
    const file = createTmpFile(`
import dependency from ${JSON.stringify(pathToFileURL(dependency))};
console.log(dependency);
`, '.mjs');
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: dependency });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      '{}',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      '{}',
      `Completed running ${inspect(file)}`,
    ]);
  });

  it('should restart multiple times', async () => {
    const file = createTmpFile();
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file, restarts: 3 });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
    ]);
  });

  it('should pass arguments to file', async () => {
    const file = createTmpFile(`
const { parseArgs } = require('node:util');
const { values } = parseArgs({ options: { random: { type: 'string' } } });
console.log(values.random);
    `);
    const random = Date.now().toString();
    const args = [file, '--random', random];
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file, args });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      random,
      `Completed running ${inspect(`${file} --random ${random}`)}`,
      `Restarting ${inspect(`${file} --random ${random}`)}`,
      random,
      `Completed running ${inspect(`${file} --random ${random}`)}`,
    ]);
  });

  it('should not load --require modules in main process', async () => {
    const file = createTmpFile();
    const required = createTmpFile('setImmediate(() => process.exit(0));');
    const args = ['--require', required, file];
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file, args });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
    ]);
  });

  it('should not load --import modules in main process', {
    skip: 'enable once --import is backported',
  }, async () => {
    const file = createTmpFile();
    const imported = pathToFileURL(createTmpFile('setImmediate(() => process.exit(0));'));
    const args = ['--import', imported, file];
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file, args });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
    ]);
  });

  // TODO: Remove skip after https://github.com/nodejs/node/pull/45271 lands
  it('should not watch when running an missing file', {
    skip: !supportsRecursive
  }, async () => {
    const nonExistingfile = path.join(tmpdir.path, `${tmpFiles++}.js`);
    await failWriteSucceed({ file: nonExistingfile, watchedFile: nonExistingfile });
  });

  it('should not watch when running an missing mjs file', {
    skip: !supportsRecursive
  }, async () => {
    const nonExistingfile = path.join(tmpdir.path, `${tmpFiles++}.mjs`);
    await failWriteSucceed({ file: nonExistingfile, watchedFile: nonExistingfile });
  });

  it('should watch changes to previously missing dependency', {
    skip: !supportsRecursive
  }, async () => {
    const dependency = path.join(tmpdir.path, `${tmpFiles++}.js`);
    const relativeDependencyPath = `./${path.basename(dependency)}`;
    const dependant = createTmpFile(`console.log(require('${relativeDependencyPath}'))`);

    await failWriteSucceed({ file: dependant, watchedFile: dependency });
  });

  it('should watch changes to previously missing ESM dependency', {
    skip: !supportsRecursive
  }, async () => {
    const relativeDependencyPath = `./${tmpFiles++}.mjs`;
    const dependency = path.join(tmpdir.path, relativeDependencyPath);
    const dependant = createTmpFile(`import ${JSON.stringify(relativeDependencyPath)}`, '.mjs');

    await failWriteSucceed({ file: dependant, watchedFile: dependency });
  });

  it('should clear output between runs', async () => {
    const file = createTmpFile();
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
    ]);
  });

  it('should preserve output when --watch-preserve-output flag is passed', async () => {
    const file = createTmpFile();
    const args = ['--watch-preserve-output', file];
    const { stderr, stdout } = await runWriteSucceed({ file, watchedFile: file, args });

    assert.strictEqual(stderr, '');
    assert.deepStrictEqual(stdout, [
      'running',
      `Completed running ${inspect(file)}`,
      `Restarting ${inspect(file)}`,
      'running',
      `Completed running ${inspect(file)}`,
    ]);
  });
});
