'use strict';

const assert = require('assert');
const fixtures = require('../common/fixtures');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const events = require('events');
const os = require('os');
const { inspect } = require('util');
const { Worker } = require('worker_threads');

function getBrowserProperties() {
  const { node: version } = process.versions; // e.g. 18.13.0, 20.0.0-nightly202302078e6e215481
  const release = /^\d+\.\d+\.\d+$/.test(version);
  const browser = {
    browser_channel: release ? 'stable' : 'experimental',
    browser_version: version,
  };

  return browser;
}

/**
 * Return one of three expected values
 * https://github.com/web-platform-tests/wpt/blob/1c6ff12/tools/wptrunner/wptrunner/tests/test_update.py#L953-L958
 */
function getOs() {
  switch (os.type()) {
    case 'Linux':
      return 'linux';
    case 'Darwin':
      return 'mac';
    case 'Windows_NT':
      return 'win';
    default:
      throw new Error('Unsupported os.type()');
  }
}

// https://github.com/web-platform-tests/wpt/blob/b24eedd/resources/testharness.js#L3705
function sanitizeUnpairedSurrogates(str) {
  return str.replace(
    /([\ud800-\udbff]+)(?![\udc00-\udfff])|(^|[^\ud800-\udbff])([\udc00-\udfff]+)/g,
    function(_, low, prefix, high) {
      let output = prefix || '';  // Prefix may be undefined
      const string = low || high;  // Only one of these alternates can match
      for (let i = 0; i < string.length; i++) {
        output += codeUnitStr(string[i]);
      }
      return output;
    });
}

function codeUnitStr(char) {
  return 'U+' + char.charCodeAt(0).toString(16);
}

class WPTReport {
  constructor() {
    this.results = [];
    this.time_start = Date.now();
  }

  addResult(name, status) {
    const result = {
      test: name,
      status,
      subtests: [],
      addSubtest(name, status, message) {
        const subtest = {
          status,
          // https://github.com/web-platform-tests/wpt/blob/b24eedd/resources/testharness.js#L3722
          name: sanitizeUnpairedSurrogates(name),
        };
        if (message) {
          // https://github.com/web-platform-tests/wpt/blob/b24eedd/resources/testharness.js#L4506
          subtest.message = sanitizeUnpairedSurrogates(message);
        }
        this.subtests.push(subtest);
        return subtest;
      },
    };
    this.results.push(result);
    return result;
  }

  write() {
    this.time_end = Date.now();
    this.results = this.results.filter((result) => {
      return result.status === 'SKIP' || result.subtests.length !== 0;
    }).map((result) => {
      const url = new URL(result.test, 'http://wpt');
      url.pathname = url.pathname.replace(/\.js$/, '.html');
      result.test = url.href.slice(url.origin.length);
      return result;
    });

    if (fs.existsSync('out/wpt/wptreport.json')) {
      const prev = JSON.parse(fs.readFileSync('out/wpt/wptreport.json'));
      this.results = [...prev.results, ...this.results];
      this.time_start = prev.time_start;
      this.time_end = Math.max(this.time_end, prev.time_end);
      this.run_info = prev.run_info;
    } else {
      /**
       * Return required and some optional properties
       * https://github.com/web-platform-tests/wpt.fyi/blob/60da175/api/README.md?plain=1#L331-L335
       */
      this.run_info = {
        product: 'node.js',
        ...getBrowserProperties(),
        revision: process.env.WPT_REVISION || 'unknown',
        os: getOs(),
      };
    }

    fs.writeFileSync('out/wpt/wptreport.json', JSON.stringify(this));
  }
}

// https://github.com/web-platform-tests/wpt/blob/HEAD/resources/testharness.js
// TODO: get rid of this half-baked harness in favor of the one
// pulled from WPT
const harnessMock = {
  test: (fn, desc) => {
    try {
      fn();
    } catch (err) {
      console.error(`In ${desc}:`);
      throw err;
    }
  },
  assert_equals: assert.strictEqual,
  assert_true: (value, message) => assert.strictEqual(value, true, message),
  assert_false: (value, message) => assert.strictEqual(value, false, message),
  assert_throws: (code, func, desc) => {
    assert.throws(func, function(err) {
      return typeof err === 'object' &&
             'name' in err &&
             err.name.startsWith(code.name);
    }, desc);
  },
  assert_array_equals: assert.deepStrictEqual,
  assert_unreached(desc) {
    assert.fail(`Reached unreachable code: ${desc}`);
  },
};

class ResourceLoader {
  constructor(path) {
    this.path = path;
  }

  toRealFilePath(from, url) {
    // We need to patch this to load the WebIDL parser
    url = url.replace(
      '/resources/WebIDLParser.js',
      '/resources/webidl2/lib/webidl2.js',
    );
    const base = path.dirname(from);
    return url.startsWith('/') ?
      fixtures.path('wpt', url) :
      fixtures.path('wpt', base, url);
  }

  /**
   * Load a resource in test/fixtures/wpt specified with a URL
   * @param {string} from the path of the file loading this resource,
   *                      relative to the WPT folder.
   * @param {string} url the url of the resource being loaded.
   * @param {boolean} asFetch if true, return the resource in a
   *                          pseudo-Response object.
   */
  read(from, url, asFetch = true) {
    const file = this.toRealFilePath(from, url);
    if (asFetch) {
      return fsPromises.readFile(file)
        .then((data) => {
          return {
            ok: true,
            json() { return JSON.parse(data.toString()); },
            text() { return data.toString(); },
          };
        });
    }
    return fs.readFileSync(file, 'utf8');
  }
}

class StatusRule {
  constructor(key, value, pattern) {
    this.key = key;
    this.requires = value.requires || [];
    this.fail = value.fail;
    this.skip = value.skip;
    if (pattern) {
      this.pattern = this.transformPattern(pattern);
    }
    // TODO(joyeecheung): implement this
    this.scope = value.scope;
    this.comment = value.comment;
  }

  /**
   * Transform a filename pattern into a RegExp
   * @param {string} pattern
   * @returns {RegExp}
   */
  transformPattern(pattern) {
    const result = path.normalize(pattern).replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
    return new RegExp(result.replace('*', '.*'));
  }
}

class StatusRuleSet {
  constructor() {
    // We use two sets of rules to speed up matching
    this.exactMatch = {};
    this.patternMatch = [];
  }

  /**
   * @param {object} rules
   */
  addRules(rules) {
    for (const key of Object.keys(rules)) {
      if (key.includes('*')) {
        this.patternMatch.push(new StatusRule(key, rules[key], key));
      } else {
        const normalizedPath = path.normalize(key);
        this.exactMatch[normalizedPath] = new StatusRule(key, rules[key]);
      }
    }
  }

  match(file) {
    const result = [];
    const exact = this.exactMatch[file];
    if (exact) {
      result.push(exact);
    }
    for (const item of this.patternMatch) {
      if (item.pattern.test(file)) {
        result.push(item);
      }
    }
    return result;
  }
}

// A specification of WPT test
class WPTTestSpec {
  /**
   * @param {string} mod name of the WPT module, e.g.
   *                     'html/webappapis/microtask-queuing'
   * @param {string} filename path of the test, relative to mod, e.g.
   *                          'test.any.js'
   * @param {StatusRule[]} rules
   */
  constructor(mod, filename, rules) {
    this.module = mod;
    this.filename = filename;

    this.requires = new Set();
    this.failedTests = [];
    this.flakyTests = [];
    this.skipReasons = [];
    for (const item of rules) {
      if (item.requires.length) {
        for (const req of item.requires) {
          this.requires.add(req);
        }
      }
      if (Array.isArray(item.fail?.expected)) {
        this.failedTests.push(...item.fail.expected);
      }
      if (Array.isArray(item.fail?.flaky)) {
        this.failedTests.push(...item.fail.flaky);
        this.flakyTests.push(...item.fail.flaky);
      }
      if (item.skip) {
        this.skipReasons.push(item.skip);
      }
    }

    this.failedTests = [...new Set(this.failedTests)];
    this.flakyTests = [...new Set(this.flakyTests)];
    this.skipReasons = [...new Set(this.skipReasons)];
  }

  getRelativePath() {
    return path.join(this.module, this.filename);
  }

  getAbsolutePath() {
    return fixtures.path('wpt', this.getRelativePath());
  }

  getContent() {
    return fs.readFileSync(this.getAbsolutePath(), 'utf8');
  }
}

const kIntlRequirement = {
  none: 0,
  small: 1,
  full: 2,
  // TODO(joyeecheung): we may need to deal with --with-intl=system-icu
};

class IntlRequirement {
  constructor() {
    this.currentIntl = kIntlRequirement.none;
    if (process.config.variables.v8_enable_i18n_support === 0) {
      this.currentIntl = kIntlRequirement.none;
      return;
    }
    // i18n enabled
    if (process.config.variables.icu_small) {
      this.currentIntl = kIntlRequirement.small;
    } else {
      this.currentIntl = kIntlRequirement.full;
    }
  }

  /**
   * @param {Set} requires
   * @returns {string|false} The config that the build is lacking, or false
   */
  isLacking(requires) {
    const current = this.currentIntl;
    if (requires.has('full-icu') && current !== kIntlRequirement.full) {
      return 'full-icu';
    }
    if (requires.has('small-icu') && current < kIntlRequirement.small) {
      return 'small-icu';
    }
    return false;
  }
}

const intlRequirements = new IntlRequirement();

class StatusLoader {
  /**
   * @param {string} path relative path of the WPT subset
   */
  constructor(path) {
    this.path = path;
    this.loaded = false;
    this.rules = new StatusRuleSet();
    /** @type {WPTTestSpec[]} */
    this.specs = [];
  }

  /**
   * Grep for all .*.js file recursively in a directory.
   * @param {string} dir
   */
  grep(dir) {
    let result = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filepath = path.join(dir, file);
      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        const list = this.grep(filepath);
        result = result.concat(list);
      } else {
        if (!(/\.\w+\.js$/.test(filepath)) || filepath.endsWith('.helper.js')) {
          continue;
        }
        result.push(filepath);
      }
    }
    return result;
  }

  load() {
    const dir = path.join(__dirname, '..', 'wpt');
    const statusFile = path.join(dir, 'status', `${this.path}.json`);
    const result = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    this.rules.addRules(result);

    const subDir = fixtures.path('wpt', this.path);
    const list = this.grep(subDir);
    for (const file of list) {
      const relativePath = path.relative(subDir, file);
      const match = this.rules.match(relativePath);
      this.specs.push(new WPTTestSpec(this.path, relativePath, match));
    }
    this.loaded = true;
  }
}

const kPass = 'pass';
const kFail = 'fail';
const kSkip = 'skip';
const kTimeout = 'timeout';
const kIncomplete = 'incomplete';
const kUncaught = 'uncaught';
const NODE_UNCAUGHT = 100;

class WPTRunner {
  constructor(path) {
    this.path = path;
    this.resource = new ResourceLoader(path);

    this.flags = [];
    this.dummyGlobalThisScript = null;
    this.initScript = null;

    this.status = new StatusLoader(path);
    this.status.load();
    this.specMap = new Map(
      this.status.specs.map((item) => [item.filename, item]),
    );

    this.results = {};
    this.inProgress = new Set();
    this.workers = new Map();
    this.unexpectedFailures = [];

    this.scriptsModifier = null;

    if (process.env.WPT_REPORT != null) {
      this.report = new WPTReport();
    }
  }

  /**
   * Sets the Node.js flags passed to the worker.
   * @param {Array<string>} flags
   */
  setFlags(flags) {
    this.flags = flags;
  }

  /**
   * Sets a script to be run in the worker before executing the tests.
   * @param {string} script
   */
  setInitScript(script) {
    this.initScript = script;
  }

  /**
   * Set the scripts modifier for each script.
   * @param {(meta: { code: string, filename: string }) => void} modifier
   */
  setScriptModifier(modifier) {
    this.scriptsModifier = modifier;
  }

  fullInitScript(hasSubsetScript, locationSearchString) {
    let { initScript } = this;
    if (hasSubsetScript || locationSearchString) {
      initScript = `${initScript}\n\n//===\nglobalThis.location ||= {};`;
    }

    if (locationSearchString) {
      initScript = `${initScript}\n\n//===\nglobalThis.location.search = "${locationSearchString}";`;
    }

    if (initScript === null && this.dummyGlobalThisScript === null) {
      return null;
    }

    if (initScript === null) {
      return this.dummyGlobalThisScript;
    } else if (this.dummyGlobalThisScript === null) {
      return initScript;
    }

    return `${this.dummyGlobalThisScript}\n\n//===\n${initScript}`;
  }

  /**
   * Pretend the runner is run in `name`'s environment (globalThis).
   * @param {'Window'} name
   * @see {@link https://github.com/nodejs/node/blob/24673ace8ae196bd1c6d4676507d6e8c94cf0b90/test/fixtures/wpt/resources/idlharness.js#L654-L671}
   */
  pretendGlobalThisAs(name) {
    switch (name) {
      case 'Window': {
        this.dummyGlobalThisScript =
          'global.Window = Object.getPrototypeOf(globalThis).constructor;';
        break;
      }

      // TODO(XadillaX): implement `ServiceWorkerGlobalScope`,
      // `DedicateWorkerGlobalScope`, etc.
      //
      // e.g. `ServiceWorkerGlobalScope` should implement dummy
      // `addEventListener` and so on.

      default: throw new Error(`Invalid globalThis type ${name}.`);
    }
  }

  // TODO(joyeecheung): work with the upstream to port more tests in .html
  // to .js.
  async runJsTests() {
    let queue = [];

    // If the tests are run as `node test/wpt/test-something.js subset.any.js`,
    // only `subset.any.js` will be run by the runner.
    if (process.argv[2]) {
      const filename = process.argv[2];
      if (!this.specMap.has(filename)) {
        throw new Error(`${filename} not found!`);
      }
      queue.push(this.specMap.get(filename));
    } else {
      queue = this.buildQueue();
    }

    this.inProgress = new Set(queue.map((spec) => spec.filename));

    for (const spec of queue) {
      const testFileName = spec.filename;
      const content = spec.getContent();
      const meta = spec.meta = this.getMeta(content);

      const absolutePath = spec.getAbsolutePath();
      const relativePath = spec.getRelativePath();
      const harnessPath = fixtures.path('wpt', 'resources', 'testharness.js');
      const scriptsToRun = [];
      let hasSubsetScript = false;

      // Scripts specified with the `// META: script=` header
      if (meta.script) {
        for (const script of meta.script) {
          if (script === '/common/subset-tests.js' || script === '/common/subset-tests-by-key.js') {
            hasSubsetScript = true;
          }
          const obj = {
            filename: this.resource.toRealFilePath(relativePath, script),
            code: this.resource.read(relativePath, script, false),
          };
          this.scriptsModifier?.(obj);
          scriptsToRun.push(obj);
        }
      }
      // The actual test
      const obj = {
        code: content,
        filename: absolutePath,
      };
      this.scriptsModifier?.(obj);
      scriptsToRun.push(obj);

      /**
       * Example test with no META variant
       * https://github.com/nodejs/node/blob/03854f6/test/fixtures/wpt/WebCryptoAPI/sign_verify/hmac.https.any.js#L1-L4
       *
       * Example test with multiple META variants
       * https://github.com/nodejs/node/blob/03854f6/test/fixtures/wpt/WebCryptoAPI/generateKey/successes_RSASSA-PKCS1-v1_5.https.any.js#L1-L9
       */
      for (const variant of meta.variant || ['']) {
        const workerPath = path.join(__dirname, 'wpt/worker.js');
        const worker = new Worker(workerPath, {
          execArgv: this.flags,
          workerData: {
            testRelativePath: relativePath,
            wptRunner: __filename,
            wptPath: this.path,
            initScript: this.fullInitScript(hasSubsetScript, variant),
            harness: {
              code: fs.readFileSync(harnessPath, 'utf8'),
              filename: harnessPath,
            },
            scriptsToRun,
          },
        });
        this.workers.set(testFileName, worker);

        let reportResult;
        worker.on('message', (message) => {
          switch (message.type) {
            case 'result':
              reportResult ||= this.report?.addResult(`/${relativePath}${variant}`, 'OK');
              return this.resultCallback(testFileName, message.result, reportResult);
            case 'completion':
              return this.completionCallback(testFileName, message.status);
            default:
              throw new Error(`Unexpected message from worker: ${message.type}`);
          }
        });

        worker.on('error', (err) => {
          if (!this.inProgress.has(testFileName)) {
            // The test is already finished. Ignore errors that occur after it.
            // This can happen normally, for example in timers tests.
            return;
          }
          this.fail(
            testFileName,
            {
              status: NODE_UNCAUGHT,
              name: 'evaluation in WPTRunner.runJsTests()',
              message: err.message,
              stack: inspect(err),
            },
            kUncaught,
          );
          this.inProgress.delete(testFileName);
        });

        await events.once(worker, 'exit').catch(() => {});
      }
    }

    process.on('exit', () => {
      for (const spec of this.inProgress) {
        this.fail(spec, { name: 'Incomplete' }, kIncomplete);
      }
      inspect.defaultOptions.depth = Infinity;
      // Sorts the rules to have consistent output
      console.log(JSON.stringify(Object.keys(this.results).sort().reduce(
        (obj, key) => {
          obj[key] = this.results[key];
          return obj;
        },
        {},
      ), null, 2));

      const failures = [];
      let expectedFailures = 0;
      let skipped = 0;
      for (const [key, item] of Object.entries(this.results)) {
        if (item.fail?.unexpected) {
          failures.push(key);
        }
        if (item.fail?.expected) {
          expectedFailures++;
        }
        if (item.skip) {
          skipped++;
        }
      }

      const unexpectedPasses = [];
      for (const specMap of queue) {
        const key = specMap.filename;

        // File has no expected failures
        if (!specMap.failedTests.length) {
          continue;
        }

        // File was (maybe even conditionally) skipped
        if (this.results[key]?.skip) {
          continue;
        }

        // Full check: every expected to fail test is present
        if (specMap.failedTests.some((expectedToFail) => {
          if (specMap.flakyTests.includes(expectedToFail)) {
            return false;
          }
          return this.results[key]?.fail?.expected?.includes(expectedToFail) !== true;
        })) {
          unexpectedPasses.push(key);
          continue;
        }
      }

      this.report?.write();

      const ran = queue.length;
      const total = ran + skipped;
      const passed = ran - expectedFailures - failures.length;
      console.log(`Ran ${ran}/${total} tests, ${skipped} skipped,`,
                  `${passed} passed, ${expectedFailures} expected failures,`,
                  `${failures.length} unexpected failures,`,
                  `${unexpectedPasses.length} unexpected passes`);
      if (failures.length > 0) {
        const file = path.join('test', 'wpt', 'status', `${this.path}.json`);
        throw new Error(
          `Found ${failures.length} unexpected failures. ` +
          `Consider updating ${file} for these files:\n${failures.join('\n')}`);
      }
      if (unexpectedPasses.length > 0) {
        const file = path.join('test', 'wpt', 'status', `${this.path}.json`);
        throw new Error(
          `Found ${unexpectedPasses.length} unexpected passes. ` +
          `Consider updating ${file} for these files:\n${unexpectedPasses.join('\n')}`);
      }
    });
  }

  getTestTitle(filename) {
    const spec = this.specMap.get(filename);
    return spec.meta?.title || filename.split('.')[0];
  }

  // Map WPT test status to strings
  getTestStatus(status) {
    switch (status) {
      case 1:
        return kFail;
      case 2:
        return kTimeout;
      case 3:
        return kIncomplete;
      case NODE_UNCAUGHT:
        return kUncaught;
      default:
        return kPass;
    }
  }

  /**
   * Report the status of each specific test case (there could be multiple
   * in one test file).
   * @param {string} filename
   * @param {Test} test  The Test object returned by WPT harness
   */
  resultCallback(filename, test, reportResult) {
    const status = this.getTestStatus(test.status);
    const title = this.getTestTitle(filename);
    if (/^Untitled( \d+)?$/.test(test.name)) {
      test.name = `${title}${test.name.slice(8)}`;
    }
    console.log(`---- ${title} ----`);
    if (status !== kPass) {
      this.fail(filename, test, status, reportResult);
    } else {
      this.succeed(filename, test, status, reportResult);
    }
  }

  /**
   * Report the status of each WPT test (one per file)
   * @param {string} filename
   * @param {object} harnessStatus - The status object returned by WPT harness.
   */
  completionCallback(filename, harnessStatus) {
    const status = this.getTestStatus(harnessStatus.status);

    // Treat it like a test case failure
    if (status === kTimeout) {
      this.fail(filename, { name: 'WPT testharness timeout' }, kTimeout);
    }
    this.inProgress.delete(filename);
    // Always force termination of the worker. Some tests allocate resources
    // that would otherwise keep it alive.
    this.workers.get(filename).terminate();
  }

  addTestResult(filename, item) {
    let result = this.results[filename];
    if (!result) {
      result = this.results[filename] = {};
    }
    if (item.status === kSkip) {
      // { filename: { skip: 'reason' } }
      result[kSkip] = item.reason;
    } else {
      // { filename: { fail: { expected: [ ... ],
      //                      unexpected: [ ... ] } }}
      if (!result[item.status]) {
        result[item.status] = {};
      }
      const key = item.expected ? 'expected' : 'unexpected';
      if (!result[item.status][key]) {
        result[item.status][key] = [];
      }
      const hasName = result[item.status][key].includes(item.name);
      if (!hasName) {
        result[item.status][key].push(item.name);
      }
    }
  }

  succeed(filename, test, status, reportResult) {
    console.log(`[${status.toUpperCase()}] ${test.name}`);
    reportResult?.addSubtest(test.name, 'PASS');
  }

  fail(filename, test, status, reportResult) {
    const spec = this.specMap.get(filename);
    const expected = spec.failedTests.includes(test.name);
    if (expected) {
      console.log(`[EXPECTED_FAILURE][${status.toUpperCase()}] ${test.name}`);
      console.log(test.message || status);
    } else {
      console.log(`[UNEXPECTED_FAILURE][${status.toUpperCase()}] ${test.name}`);
    }
    if (status === kFail || status === kUncaught) {
      console.log(test.message);
      console.log(test.stack);
    }
    const command = `${process.execPath} ${process.execArgv}` +
                    ` ${require.main.filename} ${filename}`;
    console.log(`Command: ${command}\n`);

    reportResult?.addSubtest(test.name, 'FAIL', test.message);

    this.addTestResult(filename, {
      name: test.name,
      expected,
      status: kFail,
      reason: test.message || status,
    });
  }

  skip(filename, reasons) {
    const title = this.getTestTitle(filename);
    console.log(`---- ${title} ----`);
    const joinedReasons = reasons.join('; ');
    console.log(`[SKIPPED] ${joinedReasons}`);
    this.addTestResult(filename, {
      status: kSkip,
      reason: joinedReasons,
    });
  }

  getMeta(code) {
    const matches = code.match(/\/\/ META: .+/g);
    if (!matches) {
      return {};
    }
    const result = {};
    for (const match of matches) {
      const parts = match.match(/\/\/ META: ([^=]+?)=(.+)/);
      const key = parts[1];
      const value = parts[2];
      if (key === 'script' || key === 'variant') {
        if (result[key]) {
          result[key].push(value);
        } else {
          result[key] = [value];
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  buildQueue() {
    const queue = [];
    for (const spec of this.specMap.values()) {
      const filename = spec.filename;
      if (spec.skipReasons.length > 0) {
        this.skip(filename, spec.skipReasons);
        continue;
      }

      const lackingIntl = intlRequirements.isLacking(spec.requires);
      if (lackingIntl) {
        this.skip(filename, [ `requires ${lackingIntl}` ]);
        continue;
      }

      queue.push(spec);
    }
    return queue;
  }
}

module.exports = {
  harness: harnessMock,
  ResourceLoader,
  WPTRunner,
};
