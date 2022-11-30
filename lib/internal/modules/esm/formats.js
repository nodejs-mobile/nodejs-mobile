'use strict';

const {
  RegExpPrototypeExec,
} = primordials;
const { getOptionValue } = require('internal/options');


const experimentalWasmModules = getOptionValue('--experimental-wasm-modules');

const extensionFormatMap = {
  '__proto__': null,
  '.cjs': 'commonjs',
  '.js': 'module',
  '.json': 'json',
  '.mjs': 'module',
};

const legacyExtensionFormatMap = {
  '__proto__': null,
  '.cjs': 'commonjs',
  '.js': 'commonjs',
  '.json': 'commonjs',
  '.mjs': 'module',
  '.node': 'commonjs',
};

if (experimentalWasmModules) {
  extensionFormatMap['.wasm'] = legacyExtensionFormatMap['.wasm'] = 'wasm';
}

/**
 * @param {string} mime
 * @returns {string | null}
 */
function mimeToFormat(mime) {
  if (
    RegExpPrototypeExec(
      /\s*(text|application)\/javascript\s*(;\s*charset=utf-?8\s*)?/i,
      mime
    ) !== null
  ) return 'module';
  if (mime === 'application/json') return 'json';
  if (experimentalWasmModules && mime === 'application/wasm') return 'wasm';
  return null;
}

function getLegacyExtensionFormat(ext) {
  return legacyExtensionFormatMap[ext];
}

module.exports = {
  extensionFormatMap,
  getLegacyExtensionFormat,
  legacyExtensionFormatMap,
  mimeToFormat,
};
