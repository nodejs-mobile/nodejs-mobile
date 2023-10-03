'use strict';
const {
  RegExpPrototypeExec,
  ObjectPrototypeHasOwnProperty,
  PromisePrototypeThen,
  PromiseResolve,
  StringPrototypeSlice,
} = primordials;
const { basename, extname, relative } = require('path');
const { getOptionValue } = require('internal/options');
const { fetchModule } = require('internal/modules/esm/fetch_module');
const {
  extensionFormatMap,
  getLegacyExtensionFormat,
  mimeToFormat,
} = require('internal/modules/esm/formats');

const experimentalNetworkImports =
  getOptionValue('--experimental-network-imports');
const experimentalSpecifierResolution =
  getOptionValue('--experimental-specifier-resolution');
const { getPackageType, getPackageScopeConfig } = require('internal/modules/esm/resolve');
const { fileURLToPath } = require('internal/url');
const { ERR_UNKNOWN_FILE_EXTENSION } = require('internal/errors').codes;

const protocolHandlers = {
  '__proto__': null,
  'data:': getDataProtocolModuleFormat,
  'file:': getFileProtocolModuleFormat,
  'http:': getHttpProtocolModuleFormat,
  'https:': getHttpProtocolModuleFormat,
  'node:'() { return 'builtin'; },
};

/**
 * @param {URL} parsed
 * @returns {string | null}
 */
function getDataProtocolModuleFormat(parsed) {
  const { 1: mime } = RegExpPrototypeExec(
    /^([^/]+\/[^;,]+)(?:[^,]*?)(;base64)?,/,
    parsed.pathname,
  ) || [ null, null, null ];

  return mimeToFormat(mime);
}

/**
 * @param {URL} url
 * @param {{parentURL: string}} context
 * @param {boolean} ignoreErrors
 * @returns {string}
 */
function getFileProtocolModuleFormat(url, context, ignoreErrors) {
  const filepath = fileURLToPath(url);
  const ext = extname(filepath);
  if (ext === '.js') {
    return getPackageType(url) === 'module' ? 'module' : 'commonjs';
  }

  const format = extensionFormatMap[ext];
  if (format) return format;

  if (experimentalSpecifierResolution !== 'node') {
    // Explicit undefined return indicates load hook should rerun format check
    if (ignoreErrors) return undefined;
    let suggestion = '';
    if (getPackageType(url) === 'module' && ext === '') {
      const config = getPackageScopeConfig(url);
      const fileBasename = basename(filepath);
      const relativePath = StringPrototypeSlice(relative(config.pjsonPath, filepath), 1);
      suggestion = 'Loading extensionless files is not supported inside of ' +
        '"type":"module" package.json contexts. The package.json file ' +
        `${config.pjsonPath} caused this "type":"module" context. Try ` +
        `changing ${filepath} to have a file extension. Note the "bin" ` +
        'field of package.json can point to a file with an extension, for example ' +
        `{"type":"module","bin":{"${fileBasename}":"${relativePath}.js"}}`;
    }
    throw new ERR_UNKNOWN_FILE_EXTENSION(ext, filepath, suggestion);
  }

  return getLegacyExtensionFormat(ext) ?? null;
}

/**
 * @param {URL} url
 * @param {{parentURL: string}} context
 * @returns {Promise<string> | undefined} only works when enabled
 */
function getHttpProtocolModuleFormat(url, context) {
  if (experimentalNetworkImports) {
    return PromisePrototypeThen(
      PromiseResolve(fetchModule(url, context)),
      (entry) => {
        return mimeToFormat(entry.headers['content-type']);
      },
    );
  }
}

/**
 * @param {URL} url
 * @param {{parentURL: string}} context
 * @returns {Promise<string> | string | undefined} only works when enabled
 */
function defaultGetFormatWithoutErrors(url, context) {
  const protocol = url.protocol;
  if (!ObjectPrototypeHasOwnProperty(protocolHandlers, protocol)) {
    return null;
  }
  return protocolHandlers[protocol](url, context, true);
}

/**
 * @param {URL} url
 * @param {{parentURL: string}} context
 * @returns {Promise<string> | string | undefined} only works when enabled
 */
function defaultGetFormat(url, context) {
  const protocol = url.protocol;
  if (!ObjectPrototypeHasOwnProperty(protocolHandlers, protocol)) {
    return null;
  }
  return protocolHandlers[protocol](url, context, false);
}

module.exports = {
  defaultGetFormat,
  defaultGetFormatWithoutErrors,
  extensionFormatMap,
};
