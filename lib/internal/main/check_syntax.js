'use strict';

// If user passed `-c` or `--check` arguments to Node, check its syntax
// instead of actually running the file.

const { URL } = require('internal/url');
const { getOptionValue } = require('internal/options');
const {
  prepareMainThreadExecution,
  markBootstrapComplete,
} = require('internal/process/pre_execution');

const {
  readStdin,
} = require('internal/process/execution');

const { pathToFileURL } = require('url');

const {
  Module: {
    _resolveFilename: resolveCJSModuleName,
  },
  wrapSafe,
} = require('internal/modules/cjs/loader');

// TODO(joyeecheung): not every one of these are necessary
prepareMainThreadExecution(true);

if (process.argv[1] && process.argv[1] !== '-') {
  // Expand process.argv[1] into a full path.
  const path = require('path');
  process.argv[1] = path.resolve(process.argv[1]);

  // Read the source.
  const filename = resolveCJSModuleName(process.argv[1]);

  const fs = require('fs');
  const source = fs.readFileSync(filename, 'utf-8');

  markBootstrapComplete();

  loadESMIfNeeded(() => checkSyntax(source, filename));
} else {
  markBootstrapComplete();

  loadESMIfNeeded(() => readStdin((code) => {
    checkSyntax(code, '[stdin]');
  }));
}

function loadESMIfNeeded(cb) {
  const { getOptionValue } = require('internal/options');
  const hasModulePreImport = getOptionValue('--import').length > 0;

  if (hasModulePreImport) {
    const { loadESM } = require('internal/process/esm_loader');
    loadESM(cb);
    return;
  }
  cb();
}

async function checkSyntax(source, filename) {
  let isModule = true;
  if (filename === '[stdin]' || filename === '[eval]') {
    isModule = getOptionValue('--input-type') === 'module' ||
      (getOptionValue('--experimental-default-type') === 'module' && getOptionValue('--input-type') !== 'commonjs');
  } else {
    const { defaultResolve } = require('internal/modules/esm/resolve');
    const { defaultGetFormat } = require('internal/modules/esm/get_format');
    const { url } = await defaultResolve(pathToFileURL(filename).toString());
    const format = await defaultGetFormat(new URL(url));
    isModule = format === 'module';
  }

  if (isModule) {
    const { ModuleWrap } = internalBinding('module_wrap');
    new ModuleWrap(filename, undefined, source, 0, 0);
    return;
  }

  const { loadESM } = require('internal/process/esm_loader');
  const { handleMainPromise } = require('internal/modules/run_main');
  handleMainPromise(loadESM((loader) => wrapSafe(filename, source)));
}
