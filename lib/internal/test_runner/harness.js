'use strict';
const {
  ArrayPrototypeForEach,
  FunctionPrototypeBind,
  PromiseResolve,
  SafeMap,
} = primordials;
const {
  createHook,
  executionAsyncId,
} = require('async_hooks');
const {
  codes: {
    ERR_TEST_FAILURE,
  },
} = require('internal/errors');
const { kEmptyObject } = require('internal/util');
const { kCancelledByParent, Test, Suite } = require('internal/test_runner/test');
const {
  parseCommandLine,
  setupTestReporters,
} = require('internal/test_runner/utils');
const { bigint: hrtime } = process.hrtime;

const testResources = new SafeMap();

function createTestTree(options = kEmptyObject) {
  return setup(new Test({ __proto__: null, ...options, name: '<root>' }));
}

function createProcessEventHandler(eventName, rootTest) {
  return (err) => {
    if (!rootTest.harness.bootstrapComplete) {
      // Something went wrong during the asynchronous portion of bootstrapping
      // the test runner. Since the test runner is not setup properly, we can't
      // do anything but throw the error.
      throw err;
    }

    // Check if this error is coming from a test. If it is, fail the test.
    const test = testResources.get(executionAsyncId());

    if (!test || test.finished) {
      // If the test is already finished or the resource that created the error
      // is not mapped to a Test, report this as a top level diagnostic.
      let msg;

      if (test) {
        msg = `Warning: Test "${test.name}" generated asynchronous ` +
          'activity after the test ended. This activity created the error ' +
          `"${err}" and would have caused the test to fail, but instead ` +
          `triggered an ${eventName} event.`;
      } else {
        msg = 'Warning: A resource generated asynchronous activity after ' +
          `the test ended. This activity created the error "${err}" which ` +
          `triggered an ${eventName} event, caught by the test runner.`;
      }

      rootTest.diagnostic(msg);
      process.exitCode = 1;
      return;
    }

    test.fail(new ERR_TEST_FAILURE(err, eventName));
    test.postRun();
  };
}

function configureCoverage(rootTest, globalOptions) {
  if (!globalOptions.coverage) {
    return null;
  }

  const { setupCoverage } = require('internal/test_runner/coverage');

  try {
    return setupCoverage();
  } catch (err) {
    const msg = `Warning: Code coverage could not be enabled. ${err}`;

    rootTest.diagnostic(msg);
    process.exitCode = 1;
  }
}

function collectCoverage(rootTest, coverage) {
  if (!coverage) {
    return null;
  }

  let summary = null;

  try {
    summary = coverage.summary();
    coverage.cleanup();
  } catch (err) {
    const op = summary ? 'clean up' : 'report';
    const msg = `Warning: Could not ${op} code coverage. ${err}`;

    rootTest.diagnostic(msg);
    process.exitCode = 1;
  }

  return summary;
}

function setup(root) {
  if (root.startTime !== null) {
    return root;
  }

  // Parse the command line options before the hook is enabled. We don't want
  // global input validation errors to end up in the uncaughtException handler.
  const globalOptions = parseCommandLine();

  const hook = createHook({
    init(asyncId, type, triggerAsyncId, resource) {
      if (resource instanceof Test) {
        testResources.set(asyncId, resource);
        return;
      }

      const parent = testResources.get(triggerAsyncId);

      if (parent !== undefined) {
        testResources.set(asyncId, parent);
      }
    },
    destroy(asyncId) {
      testResources.delete(asyncId);
    },
  });

  hook.enable();

  const exceptionHandler =
    createProcessEventHandler('uncaughtException', root);
  const rejectionHandler =
    createProcessEventHandler('unhandledRejection', root);
  const coverage = configureCoverage(root, globalOptions);
  const exitHandler = async () => {
    await root.run(new ERR_TEST_FAILURE(
      'Promise resolution is still pending but the event loop has already resolved',
      kCancelledByParent));

    hook.disable();
    process.removeListener('unhandledRejection', rejectionHandler);
    process.removeListener('uncaughtException', exceptionHandler);
  };

  const terminationHandler = async () => {
    await exitHandler();
    process.exit();
  };

  process.on('uncaughtException', exceptionHandler);
  process.on('unhandledRejection', rejectionHandler);
  process.on('beforeExit', exitHandler);
  // TODO(MoLow): Make it configurable to hook when isTestRunner === false.
  if (globalOptions.isTestRunner) {
    process.on('SIGINT', terminationHandler);
    process.on('SIGTERM', terminationHandler);
  }

  root.harness = {
    __proto__: null,
    bootstrapComplete: false,
    coverage: FunctionPrototypeBind(collectCoverage, null, root, coverage),
    counters: {
      __proto__: null,
      all: 0,
      failed: 0,
      passed: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
      topLevel: 0,
      suites: 0,
    },
    shouldColorizeTestFiles: false,
  };
  root.startTime = hrtime();
  return root;
}

let globalRoot;
let reportersSetup;
function getGlobalRoot() {
  if (!globalRoot) {
    globalRoot = createTestTree();
    globalRoot.reporter.once('test:fail', () => {
      process.exitCode = 1;
    });
    reportersSetup = setupTestReporters(globalRoot);
  }
  return globalRoot;
}

async function startSubtest(subtest) {
  await reportersSetup;
  getGlobalRoot().harness.bootstrapComplete = true;
  await subtest.start();
}

function runInParentContext(Factory) {
  function run(name, options, fn, overrides) {
    const parent = testResources.get(executionAsyncId()) || getGlobalRoot();
    const subtest = parent.createSubtest(Factory, name, options, fn, overrides);
    if (!(parent instanceof Suite)) {
      return startSubtest(subtest);
    }
    return PromiseResolve();
  }

  const test = (name, options, fn) => run(name, options, fn);
  ArrayPrototypeForEach(['skip', 'todo', 'only'], (keyword) => {
    test[keyword] = (name, options, fn) => {
      run(name, options, fn, { [keyword]: true });
    };
  });
  return test;
}

function hook(hook) {
  return (fn, options) => {
    const parent = testResources.get(executionAsyncId()) || getGlobalRoot();
    parent.createHook(hook, fn, options);
  };
}

module.exports = {
  createTestTree,
  test: runInParentContext(Test),
  describe: runInParentContext(Suite),
  it: runInParentContext(Test),
  before: hook('before'),
  after: hook('after'),
  beforeEach: hook('beforeEach'),
  afterEach: hook('afterEach'),
};
