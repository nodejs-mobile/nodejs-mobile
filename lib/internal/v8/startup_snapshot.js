'use strict';

const {
  validateFunction,
} = require('internal/validators');
const {
  ERR_NOT_BUILDING_SNAPSHOT,
  ERR_DUPLICATE_STARTUP_SNAPSHOT_MAIN_FUNCTION
} = require('internal/errors');

const {
  setSerializeCallback,
  setDeserializeCallback,
  setDeserializeMainFunction: _setDeserializeMainFunction,
  markBootstrapComplete
} = internalBinding('mksnapshot');

function isBuildingSnapshot() {
  // For now this is the only way to build a snapshot.
  return require('internal/options').getOptionValue('--build-snapshot');
}

function throwIfNotBuildingSnapshot() {
  if (!isBuildingSnapshot()) {
    throw new ERR_NOT_BUILDING_SNAPSHOT();
  }
}

const deserializeCallbacks = [];
let deserializeCallbackIsSet = false;
function runDeserializeCallbacks() {
  while (deserializeCallbacks.length > 0) {
    const { 0: callback, 1: data } = deserializeCallbacks.shift();
    callback(data);
  }
}

function addDeserializeCallback(callback, data) {
  throwIfNotBuildingSnapshot();
  validateFunction(callback, 'callback');
  if (!deserializeCallbackIsSet) {
    // TODO(joyeecheung): when the main function handling is done in JS,
    // the deserialize callbacks can always be invoked. For now only
    // store it in C++ when it's actually used to avoid unnecessary
    // C++ -> JS costs.
    setDeserializeCallback(runDeserializeCallbacks);
    deserializeCallbackIsSet = true;
  }
  deserializeCallbacks.push([callback, data]);
}

const serializeCallbacks = [];
function runSerializeCallbacks() {
  while (serializeCallbacks.length > 0) {
    const { 0: callback, 1: data } = serializeCallbacks.shift();
    callback(data);
  }
  // Remove the hooks from the snapshot.
  require('v8').startupSnapshot = undefined;
}

function addSerializeCallback(callback, data) {
  throwIfNotBuildingSnapshot();
  validateFunction(callback, 'callback');
  serializeCallbacks.push([callback, data]);
}

function initializeCallbacks() {
  // Only run the serialize callbacks in snapshot building mode, otherwise
  // they throw.
  if (isBuildingSnapshot()) {
    setSerializeCallback(runSerializeCallbacks);
  }
}

let deserializeMainIsSet = false;
function setDeserializeMainFunction(callback, data) {
  throwIfNotBuildingSnapshot();
  // TODO(joyeecheung): In lib/internal/bootstrap/node.js, create a default
  // main function to run the lib/internal/main scripts and make sure that
  // the main function set in the snapshot building process takes precedence.
  validateFunction(callback, 'callback');
  if (deserializeMainIsSet) {
    throw new ERR_DUPLICATE_STARTUP_SNAPSHOT_MAIN_FUNCTION();
  }
  deserializeMainIsSet = true;

  _setDeserializeMainFunction(function deserializeMain() {
    const {
      prepareMainThreadExecution
    } = require('internal/bootstrap/pre_execution');

    // This should be in sync with run_main_module.js until we make that
    // a built-in main function.
    prepareMainThreadExecution(true);
    markBootstrapComplete();
    callback(data);
  });
}

module.exports = {
  initializeCallbacks,
  runDeserializeCallbacks,
  // Exposed to require('v8').startupSnapshot
  namespace: {
    addDeserializeCallback,
    addSerializeCallback,
    setDeserializeMainFunction,
    isBuildingSnapshot
  }
};
