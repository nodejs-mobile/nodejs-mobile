// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const {
  Array,
  ArrayIsArray,
  ArrayPrototypeForEach,
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  ArrayPrototypeReduce,
  ArrayPrototypeSome,
  JSONParse,
  ObjectDefineProperty,
  ObjectFreeze,
  RegExpPrototypeExec,
  RegExpPrototypeSymbolReplace,
  StringFromCharCode,
  StringPrototypeCharCodeAt,
  StringPrototypeEndsWith,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeSubstring,
} = primordials;

const {
  ERR_TLS_CERT_ALTNAME_FORMAT,
  ERR_TLS_CERT_ALTNAME_INVALID,
  ERR_OUT_OF_RANGE
} = require('internal/errors').codes;
const internalUtil = require('internal/util');
internalUtil.assertCrypto();
const {
  isArrayBufferView,
  isUint8Array,
} = require('internal/util/types');

const net = require('net');
const { getOptionValue } = require('internal/options');
const { getRootCertificates, getSSLCiphers } = internalBinding('crypto');
const { Buffer } = require('buffer');
const { URL } = require('internal/url');  // Only used for Security Revert
const { canonicalizeIP } = internalBinding('cares_wrap');
const _tls_common = require('_tls_common');
const _tls_wrap = require('_tls_wrap');
const { createSecurePair } = require('internal/tls/secure-pair');
const { parseCertString } = require('internal/tls/parse-cert-string');

// Allow {CLIENT_RENEG_LIMIT} client-initiated session renegotiations
// every {CLIENT_RENEG_WINDOW} seconds. An error event is emitted if more
// renegotiations are seen. The settings are applied to all remote client
// connections.
exports.CLIENT_RENEG_LIMIT = 3;
exports.CLIENT_RENEG_WINDOW = 600;

exports.DEFAULT_CIPHERS = getOptionValue('--tls-cipher-list');

exports.DEFAULT_ECDH_CURVE = 'auto';

if (getOptionValue('--tls-min-v1.0'))
  exports.DEFAULT_MIN_VERSION = 'TLSv1';
else if (getOptionValue('--tls-min-v1.1'))
  exports.DEFAULT_MIN_VERSION = 'TLSv1.1';
else if (getOptionValue('--tls-min-v1.2'))
  exports.DEFAULT_MIN_VERSION = 'TLSv1.2';
else if (getOptionValue('--tls-min-v1.3'))
  exports.DEFAULT_MIN_VERSION = 'TLSv1.3';
else
  exports.DEFAULT_MIN_VERSION = 'TLSv1.2';

if (getOptionValue('--tls-max-v1.3'))
  exports.DEFAULT_MAX_VERSION = 'TLSv1.3';
else if (getOptionValue('--tls-max-v1.2'))
  exports.DEFAULT_MAX_VERSION = 'TLSv1.2';
else
  exports.DEFAULT_MAX_VERSION = 'TLSv1.3'; // Will depend on node version.


exports.getCiphers = internalUtil.cachedResult(
  () => internalUtil.filterDuplicateStrings(getSSLCiphers(), true)
);

let rootCertificates;

function cacheRootCertificates() {
  rootCertificates = ObjectFreeze(getRootCertificates());
}

ObjectDefineProperty(exports, 'rootCertificates', {
  __proto__: null,
  configurable: false,
  enumerable: true,
  get: () => {
    // Out-of-line caching to promote inlining the getter.
    if (!rootCertificates) cacheRootCertificates();
    return rootCertificates;
  },
});

// Convert protocols array into valid OpenSSL protocols list
// ("\x06spdy/2\x08http/1.1\x08http/1.0")
function convertProtocols(protocols) {
  const lens = new Array(protocols.length);
  const buff = Buffer.allocUnsafe(ArrayPrototypeReduce(protocols, (p, c, i) => {
    const len = Buffer.byteLength(c);
    if (len > 255) {
      throw new ERR_OUT_OF_RANGE('The byte length of the protocol at index ' +
        `${i} exceeds the maximum length.`, '<= 255', len, true);
    }
    lens[i] = len;
    return p + 1 + len;
  }, 0));

  let offset = 0;
  for (let i = 0, c = protocols.length; i < c; i++) {
    buff[offset++] = lens[i];
    buff.write(protocols[i], offset);
    offset += lens[i];
  }

  return buff;
}

exports.convertALPNProtocols = function convertALPNProtocols(protocols, out) {
  // If protocols is Array - translate it into buffer
  if (ArrayIsArray(protocols)) {
    out.ALPNProtocols = convertProtocols(protocols);
  } else if (isUint8Array(protocols)) {
    // Copy new buffer not to be modified by user.
    out.ALPNProtocols = Buffer.from(protocols);
  } else if (isArrayBufferView(protocols)) {
    out.ALPNProtocols = Buffer.from(protocols.buffer.slice(
      protocols.byteOffset,
      protocols.byteOffset + protocols.byteLength
    ));
  }
};

function unfqdn(host) {
  return RegExpPrototypeSymbolReplace(/[.]$/, host, '');
}

// String#toLowerCase() is locale-sensitive so we use
// a conservative version that only lowercases A-Z.
function toLowerCase(c) {
  return StringFromCharCode(32 + StringPrototypeCharCodeAt(c, 0));
}

function splitHost(host) {
  return StringPrototypeSplit(
    RegExpPrototypeSymbolReplace(/[A-Z]/g, unfqdn(host), toLowerCase),
    '.'
  );
}

function check(hostParts, pattern, wildcards) {
  // Empty strings, null, undefined, etc. never match.
  if (!pattern)
    return false;

  const patternParts = splitHost(pattern);

  if (hostParts.length !== patternParts.length)
    return false;

  // Pattern has empty components, e.g. "bad..example.com".
  if (ArrayPrototypeIncludes(patternParts, ''))
    return false;

  // RFC 6125 allows IDNA U-labels (Unicode) in names but we have no
  // good way to detect their encoding or normalize them so we simply
  // reject them.  Control characters and blanks are rejected as well
  // because nothing good can come from accepting them.
  const isBad = (s) => RegExpPrototypeExec(/[^\u0021-\u007F]/u, s) !== null;
  if (ArrayPrototypeSome(patternParts, isBad))
    return false;

  // Check host parts from right to left first.
  for (let i = hostParts.length - 1; i > 0; i -= 1) {
    if (hostParts[i] !== patternParts[i])
      return false;
  }

  const hostSubdomain = hostParts[0];
  const patternSubdomain = patternParts[0];
  const patternSubdomainParts = StringPrototypeSplit(patternSubdomain, '*');

  // Short-circuit when the subdomain does not contain a wildcard.
  // RFC 6125 does not allow wildcard substitution for components
  // containing IDNA A-labels (Punycode) so match those verbatim.
  if (patternSubdomainParts.length === 1 ||
      StringPrototypeIncludes(patternSubdomain, 'xn--'))
    return hostSubdomain === patternSubdomain;

  if (!wildcards)
    return false;

  // More than one wildcard is always wrong.
  if (patternSubdomainParts.length > 2)
    return false;

  // *.tld wildcards are not allowed.
  if (patternParts.length <= 2)
    return false;

  const { 0: prefix, 1: suffix } = patternSubdomainParts;

  if (prefix.length + suffix.length > hostSubdomain.length)
    return false;

  if (!StringPrototypeStartsWith(hostSubdomain, prefix))
    return false;

  if (!StringPrototypeEndsWith(hostSubdomain, suffix))
    return false;

  return true;
}

// This pattern is used to determine the length of escaped sequences within
// the subject alt names string. It allows any valid JSON string literal.
// This MUST match the JSON specification (ECMA-404 / RFC8259) exactly.
const jsonStringPattern =
  // eslint-disable-next-line no-control-regex
  /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/;

function splitEscapedAltNames(altNames) {
  const result = [];
  let currentToken = '';
  let offset = 0;
  while (offset !== altNames.length) {
    const nextSep = StringPrototypeIndexOf(altNames, ', ', offset);
    const nextQuote = StringPrototypeIndexOf(altNames, '"', offset);
    if (nextQuote !== -1 && (nextSep === -1 || nextQuote < nextSep)) {
      // There is a quote character and there is no separator before the quote.
      currentToken += StringPrototypeSubstring(altNames, offset, nextQuote);
      const match = RegExpPrototypeExec(
        jsonStringPattern, StringPrototypeSubstring(altNames, nextQuote));
      if (!match) {
        throw new ERR_TLS_CERT_ALTNAME_FORMAT();
      }
      currentToken += JSONParse(match[0]);
      offset = nextQuote + match[0].length;
    } else if (nextSep !== -1) {
      // There is a separator and no quote before it.
      currentToken += StringPrototypeSubstring(altNames, offset, nextSep);
      ArrayPrototypePush(result, currentToken);
      currentToken = '';
      offset = nextSep + 2;
    } else {
      currentToken += StringPrototypeSubstring(altNames, offset);
      offset = altNames.length;
    }
  }
  ArrayPrototypePush(result, currentToken);
  return result;
}

exports.checkServerIdentity = function checkServerIdentity(hostname, cert) {
  const subject = cert.subject;
  const altNames = cert.subjectaltname;
  const dnsNames = [];
  const uriNames = [];
  const ips = [];

  hostname = '' + hostname;

  if (altNames) {
    const splitAltNames = StringPrototypeIncludes(altNames, '"') ?
      splitEscapedAltNames(altNames) :
      StringPrototypeSplit(altNames, ', ');
    ArrayPrototypeForEach(splitAltNames, (name) => {
      if (StringPrototypeStartsWith(name, 'DNS:')) {
        ArrayPrototypePush(dnsNames, StringPrototypeSlice(name, 4));
      } else if (process.REVERT_CVE_2021_44531 &&
                 StringPrototypeStartsWith(name, 'URI:')) {
        const uri = new URL(StringPrototypeSlice(name, 4));

        // TODO(bnoordhuis) Also use scheme.
        ArrayPrototypePush(uriNames, uri.hostname);
      } else if (StringPrototypeStartsWith(name, 'IP Address:')) {
        ArrayPrototypePush(ips, canonicalizeIP(StringPrototypeSlice(name, 11)));
      }
    });
  }

  let valid = false;
  let reason = 'Unknown reason';

  const hasAltNames =
    dnsNames.length > 0 || ips.length > 0 || uriNames.length > 0;

  hostname = unfqdn(hostname);  // Remove trailing dot for error messages.

  if (net.isIP(hostname)) {
    valid = ArrayPrototypeIncludes(ips, canonicalizeIP(hostname));
    if (!valid)
      reason = `IP: ${hostname} is not in the cert's list: ` +
               ArrayPrototypeJoin(ips, ', ');
    // TODO(bnoordhuis) Also check URI SANs that are IP addresses.
  } else if ((process.REVERT_CVE_2021_44531 && (hasAltNames || subject)) ||
             (dnsNames.length > 0 || subject?.CN)) {
    const hostParts = splitHost(hostname);
    const wildcard = (pattern) => check(hostParts, pattern, true);

    if ((process.REVERT_CVE_2021_44531 && hasAltNames) ||
        (dnsNames.length > 0)) {
      const noWildcard = (pattern) => check(hostParts, pattern, false);
      valid = ArrayPrototypeSome(dnsNames, wildcard) ||
              ArrayPrototypeSome(uriNames, noWildcard);
      if (!valid)
        reason =
          `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
    } else {
      // Match against Common Name only if no supported identifiers exist.
      const cn = subject.CN;

      if (ArrayIsArray(cn))
        valid = ArrayPrototypeSome(cn, wildcard);
      else if (cn)
        valid = wildcard(cn);

      if (!valid)
        reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
    }
  } else {
    reason = 'Cert does not contain a DNS name';
  }

  if (!valid) {
    return new ERR_TLS_CERT_ALTNAME_INVALID(reason, hostname, cert);
  }
};

exports.createSecureContext = _tls_common.createSecureContext;
exports.SecureContext = _tls_common.SecureContext;
exports.TLSSocket = _tls_wrap.TLSSocket;
exports.Server = _tls_wrap.Server;
exports.createServer = _tls_wrap.createServer;
exports.connect = _tls_wrap.connect;

exports.parseCertString = internalUtil.deprecate(
  parseCertString,
  'tls.parseCertString() is deprecated. ' +
  'Please use querystring.parse() instead.',
  'DEP0076');

exports.createSecurePair = internalUtil.deprecate(
  createSecurePair,
  'tls.createSecurePair() is deprecated. Please use ' +
  'tls.TLSSocket instead.', 'DEP0064');
