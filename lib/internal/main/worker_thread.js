'use strict';

// In worker threads, execute the script sent through the
// message port.

const {
  ArrayPrototypeForEach,
  ArrayPrototypePushApply,
  ArrayPrototypeSplice,
  ObjectDefineProperty,
  PromisePrototypeThen,
  RegExpPrototypeExec,
  globalThis: {
    Atomics,
    SharedArrayBuffer,
  },
} = primordials;

const {
  prepareWorkerThreadExecution,
  setupUserModules,
  markBootstrapComplete,
} = require('internal/process/pre_execution');

const {
  threadId,
  getEnvMessagePort,
} = internalBinding('worker');

const workerIo = require('internal/worker/io');
const {
  messageTypes: {
    // Messages that may be received by workers
    LOAD_SCRIPT,
    // Messages that may be posted from workers
    UP_AND_RUNNING,
    ERROR_MESSAGE,
    COULD_NOT_SERIALIZE_ERROR,
    // Messages that may be either received or posted
    STDIO_PAYLOAD,
    STDIO_WANTS_MORE_DATA,
  },
  kStdioWantsMoreDataCallback,
} = workerIo;

const {
  onGlobalUncaughtException,
} = require('internal/process/execution');

let debug = require('internal/util/debuglog').debuglog('worker', (fn) => {
  debug = fn;
});

const assert = require('internal/assert');

prepareWorkerThreadExecution();

debug(`[${threadId}] is setting up worker child environment`);

// Set up the message port and start listening
const port = getEnvMessagePort();

// If the main thread is spawned with env NODE_CHANNEL_FD, it's probably
// spawned by our child_process module. In the work threads, mark the
// related IPC properties as unavailable.
if (process.env.NODE_CHANNEL_FD) {
  const workerThreadSetup = require('internal/process/worker_thread_only');
  ObjectDefineProperty(process, 'channel', {
    __proto__: null,
    enumerable: false,
    get: workerThreadSetup.unavailable('process.channel'),
  });

  ObjectDefineProperty(process, 'connected', {
    __proto__: null,
    enumerable: false,
    get: workerThreadSetup.unavailable('process.connected'),
  });

  process.send = workerThreadSetup.unavailable('process.send()');
  process.disconnect =
    workerThreadSetup.unavailable('process.disconnect()');
}

port.on('message', (message) => {
  if (message.type === LOAD_SCRIPT) {
    port.unref();
    const {
      argv,
      cwdCounter,
      filename,
      doEval,
      workerData,
      environmentData,
      publicPort,
      manifestSrc,
      manifestURL,
      hasStdin,
    } = message;

    if (argv !== undefined) {
      ArrayPrototypePushApply(process.argv, argv);
    }

    const publicWorker = require('worker_threads');
    publicWorker.parentPort = publicPort;
    publicWorker.workerData = workerData;

    require('internal/worker').assignEnvironmentData(environmentData);

    if (SharedArrayBuffer !== undefined && Atomics !== undefined) {
      // The counter is only passed to the workers created by the main thread,
      // not to workers created by other workers.
      let cachedCwd = '';
      let lastCounter = -1;
      const originalCwd = process.cwd;

      process.cwd = function() {
        const currentCounter = Atomics.load(cwdCounter, 0);
        if (currentCounter === lastCounter)
          return cachedCwd;
        lastCounter = currentCounter;
        cachedCwd = originalCwd();
        return cachedCwd;
      };
      workerIo.sharedCwdCounter = cwdCounter;
    }

    if (manifestSrc) {
      require('internal/process/policy').setup(manifestSrc, manifestURL);
    }
    setupUserModules();

    if (!hasStdin)
      process.stdin.push(null);

    debug(`[${threadId}] starts worker script ${filename} ` +
          `(eval = ${doEval}) at cwd = ${process.cwd()}`);
    port.postMessage({ type: UP_AND_RUNNING });
    if (doEval === 'classic') {
      const { evalScript } = require('internal/process/execution');
      const name = '[worker eval]';
      // This is necessary for CJS module compilation.
      // TODO: pass this with something really internal.
      ObjectDefineProperty(process, '_eval', {
        __proto__: null,
        configurable: true,
        enumerable: true,
        value: filename,
      });
      ArrayPrototypeSplice(process.argv, 1, 0, name);
      evalScript(name, filename);
    } else if (doEval === 'module') {
      const { evalModule } = require('internal/process/execution');
      PromisePrototypeThen(evalModule(filename), undefined, (e) => {
        workerOnGlobalUncaughtException(e, true);
      });
    } else {
      // script filename
      // runMain here might be monkey-patched by users in --require.
      // XXX: the monkey-patchability here should probably be deprecated.
      ArrayPrototypeSplice(process.argv, 1, 0, filename);
      const CJSLoader = require('internal/modules/cjs/loader');
      CJSLoader.Module.runMain(filename);
    }
  } else if (message.type === STDIO_PAYLOAD) {
    const { stream, chunks } = message;
    ArrayPrototypeForEach(chunks, ({ chunk, encoding }) => {
      process[stream].push(chunk, encoding);
    });
  } else {
    assert(
      message.type === STDIO_WANTS_MORE_DATA,
      `Unknown worker message type ${message.type}`,
    );
    const { stream } = message;
    process[stream][kStdioWantsMoreDataCallback]();
  }
});

function workerOnGlobalUncaughtException(error, fromPromise) {
  debug(`[${threadId}] gets uncaught exception`);
  let handled = false;
  let handlerThrew = false;
  try {
    handled = onGlobalUncaughtException(error, fromPromise);
  } catch (e) {
    error = e;
    handlerThrew = true;
  }
  debug(`[${threadId}] uncaught exception handled = ${handled}`);

  if (handled) {
    return true;
  }

  if (!process._exiting) {
    try {
      process._exiting = true;
      process.exitCode = 1;
      if (!handlerThrew) {
        process.emit('exit', process.exitCode);
      }
    } catch {
      // Continue regardless of error.
    }
  }

  let serialized;
  try {
    const { serializeError } = require('internal/error_serdes');
    serialized = serializeError(error);
  } catch {
    // Continue regardless of error.
  }
  debug(`[${threadId}] uncaught exception serialized = ${!!serialized}`);
  if (serialized)
    port.postMessage({
      type: ERROR_MESSAGE,
      error: serialized,
    });
  else
    port.postMessage({ type: COULD_NOT_SERIALIZE_ERROR });

  const { clearAsyncIdStack } = require('internal/async_hooks');
  clearAsyncIdStack();

  process.exit();
}

// Patch the global uncaught exception handler so it gets picked up by
// node::errors::TriggerUncaughtException().
process._fatalException = workerOnGlobalUncaughtException;

markBootstrapComplete();

// Necessary to reset RegExp statics before user code runs.
RegExpPrototypeExec(/^/, '');

port.start();
