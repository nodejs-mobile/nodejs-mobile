'use strict';

const {
  ArrayPrototypePush,
  RegExpPrototypeExec,
  decodeURIComponent,
} = primordials;
const { kEmptyObject } = require('internal/util');

const { defaultGetFormat } = require('internal/modules/esm/get_format');
const { validateAttributes, emitImportAssertionWarning } = require('internal/modules/esm/assert');
const { getOptionValue } = require('internal/options');

// Do not eagerly grab .manifest, it may be in TDZ
const policy = getOptionValue('--experimental-policy') ?
  require('internal/process/policy') :
  null;
const experimentalNetworkImports =
  getOptionValue('--experimental-network-imports');

const { Buffer: { from: BufferFrom } } = require('buffer');

const { URL } = require('internal/url');
const {
  ERR_INVALID_URL,
  ERR_UNKNOWN_MODULE_FORMAT,
  ERR_UNSUPPORTED_ESM_URL_SCHEME,
} = require('internal/errors').codes;

const DATA_URL_PATTERN = /^[^/]+\/[^,;]+(?:[^,]*?)(;base64)?,([\s\S]*)$/;

/**
 * @param {URL} url URL to the module
 * @param {ESModuleContext} context used to decorate error messages
 * @returns {{ responseURL: string, source: string | BufferView }}
 */
async function getSource(url, context) {
  const { protocol, href } = url;
  let responseURL = href;
  let source;
  if (protocol === 'file:') {
    const { readFile: readFileAsync } = require('internal/fs/promises').exports;
    source = await readFileAsync(url);
  } else if (protocol === 'data:') {
    const match = RegExpPrototypeExec(DATA_URL_PATTERN, url.pathname);
    if (!match) {
      throw new ERR_INVALID_URL(responseURL);
    }
    const { 1: base64, 2: body } = match;
    source = BufferFrom(decodeURIComponent(body), base64 ? 'base64' : 'utf8');
  } else if (experimentalNetworkImports && (
    protocol === 'https:' ||
    protocol === 'http:'
  )) {
    const { fetchModule } = require('internal/modules/esm/fetch_module');
    const res = await fetchModule(url, context);
    source = await res.body;
    responseURL = res.resolvedHREF;
  } else {
    const supportedSchemes = ['file', 'data'];
    if (experimentalNetworkImports) {
      ArrayPrototypePush(supportedSchemes, 'http', 'https');
    }
    throw new ERR_UNSUPPORTED_ESM_URL_SCHEME(url, supportedSchemes);
  }
  if (policy?.manifest) {
    policy.manifest.assertIntegrity(href, source);
  }
  return { __proto__: null, responseURL, source };
}


/**
 * Node.js default load hook.
 * @param {string} url
 * @param {object} context
 * @returns {object}
 */
async function defaultLoad(url, context = kEmptyObject) {
  let responseURL = url;
  let {
    importAttributes,
    format,
    source,
  } = context;

  if (importAttributes == null && !('importAttributes' in context) && 'importAssertions' in context) {
    emitImportAssertionWarning();
    importAttributes = context.importAssertions;
    // Alias `importAssertions` to `importAttributes`
    context = {
      ...context,
      importAttributes,
    };
  }

  const urlInstance = new URL(url);

  throwIfUnsupportedURLScheme(urlInstance, experimentalNetworkImports);

  format ??= await defaultGetFormat(urlInstance, context);

  validateAttributes(url, format, importAttributes);

  if (
    format === 'builtin' ||
    format === 'commonjs'
  ) {
    source = null;
  } else if (source == null) {
    ({ responseURL, source } = await getSource(urlInstance, context));
  }

  return {
    __proto__: null,
    format,
    responseURL,
    source,
  };
}


/**
 * throws an error if the protocol is not one of the protocols
 * that can be loaded in the default loader
 * @param {URL} parsed
 * @param {boolean} experimentalNetworkImports
 */
function throwIfUnsupportedURLScheme(parsed, experimentalNetworkImports) {
  // Avoid accessing the `protocol` property due to the lazy getters.
  const protocol = parsed?.protocol;
  if (
    protocol &&
    protocol !== 'file:' &&
    protocol !== 'data:' &&
    protocol !== 'node:' &&
    (
      !experimentalNetworkImports ||
      (
        protocol !== 'https:' &&
        protocol !== 'http:'
      )
    )
  ) {
    const schemes = ['file', 'data', 'node'];
    if (experimentalNetworkImports) {
      ArrayPrototypePush(schemes, 'https', 'http');
    }
    throw new ERR_UNSUPPORTED_ESM_URL_SCHEME(parsed, schemes);
  }
}

/**
 * For a falsy `format` returned from `load`, throw an error.
 * This could happen from either a custom user loader _or_ from the default loader, because the default loader tries to
 * determine formats for data URLs.
 * @param {string} url The resolved URL of the module
 * @param {null | undefined | false | 0 | -0 | 0n | ''} format Falsy format returned from `load`
 */
function throwUnknownModuleFormat(url, format) {
  const dataUrl = RegExpPrototypeExec(
    /^data:([^/]+\/[^;,]+)(?:[^,]*?)(;base64)?,/,
    url,
  );

  throw new ERR_UNKNOWN_MODULE_FORMAT(
    dataUrl ? dataUrl[1] : format,
    url);
}


module.exports = {
  defaultLoad,
  throwUnknownModuleFormat,
};
