'use strict';

const {
  ObjectSetPrototypeOf,
  ReflectApply,
  Symbol,
} = primordials;

const {
  Hash: _Hash,
  HashJob,
  Hmac: _Hmac,
  kCryptoJobAsync,
} = internalBinding('crypto');

const {
  getDefaultEncoding,
  getStringOption,
  jobPromise,
  normalizeHashName,
  validateMaxBufferLength,
  kHandle,
} = require('internal/crypto/util');

const {
  prepareSecretKey,
} = require('internal/crypto/keys');

const {
  lazyDOMException,
} = require('internal/util');

const {
  Buffer,
} = require('buffer');

const {
  codes: {
    ERR_CRYPTO_HASH_FINALIZED,
    ERR_CRYPTO_HASH_UPDATE_FAILED,
    ERR_INVALID_ARG_TYPE,
  },
} = require('internal/errors');

const {
  validateEncoding,
  validateString,
  validateUint32,
} = require('internal/validators');

const {
  isArrayBufferView,
} = require('internal/util/types');

const LazyTransform = require('internal/streams/lazy_transform');

const kState = Symbol('kState');
const kFinalized = Symbol('kFinalized');

function Hash(algorithm, options) {
  if (!(this instanceof Hash))
    return new Hash(algorithm, options);
  if (!(algorithm instanceof _Hash))
    validateString(algorithm, 'algorithm');
  const xofLen = typeof options === 'object' && options !== null ?
    options.outputLength : undefined;
  if (xofLen !== undefined)
    validateUint32(xofLen, 'options.outputLength');
  this[kHandle] = new _Hash(algorithm, xofLen);
  this[kState] = {
    [kFinalized]: false,
  };
  ReflectApply(LazyTransform, this, [options]);
}

ObjectSetPrototypeOf(Hash.prototype, LazyTransform.prototype);
ObjectSetPrototypeOf(Hash, LazyTransform);

Hash.prototype.copy = function copy(options) {
  const state = this[kState];
  if (state[kFinalized])
    throw new ERR_CRYPTO_HASH_FINALIZED();

  return new Hash(this[kHandle], options);
};

Hash.prototype._transform = function _transform(chunk, encoding, callback) {
  this[kHandle].update(chunk, encoding);
  callback();
};

Hash.prototype._flush = function _flush(callback) {
  this.push(this[kHandle].digest());
  callback();
};

Hash.prototype.update = function update(data, encoding) {
  encoding = encoding || getDefaultEncoding();

  const state = this[kState];
  if (state[kFinalized])
    throw new ERR_CRYPTO_HASH_FINALIZED();

  if (typeof data === 'string') {
    validateEncoding(data, encoding);
  } else if (!isArrayBufferView(data)) {
    throw new ERR_INVALID_ARG_TYPE(
      'data', ['string', 'Buffer', 'TypedArray', 'DataView'], data);
  }

  if (!this[kHandle].update(data, encoding))
    throw new ERR_CRYPTO_HASH_UPDATE_FAILED();
  return this;
};


Hash.prototype.digest = function digest(outputEncoding) {
  const state = this[kState];
  if (state[kFinalized])
    throw new ERR_CRYPTO_HASH_FINALIZED();
  outputEncoding = outputEncoding || getDefaultEncoding();

  // Explicit conversion for backward compatibility.
  const ret = this[kHandle].digest(`${outputEncoding}`);
  state[kFinalized] = true;
  return ret;
};

function Hmac(hmac, key, options) {
  if (!(this instanceof Hmac))
    return new Hmac(hmac, key, options);
  validateString(hmac, 'hmac');
  const encoding = getStringOption(options, 'encoding');
  key = prepareSecretKey(key, encoding);
  this[kHandle] = new _Hmac();
  this[kHandle].init(hmac, key);
  this[kState] = {
    [kFinalized]: false,
  };
  ReflectApply(LazyTransform, this, [options]);
}

ObjectSetPrototypeOf(Hmac.prototype, LazyTransform.prototype);
ObjectSetPrototypeOf(Hmac, LazyTransform);

Hmac.prototype.update = Hash.prototype.update;

Hmac.prototype.digest = function digest(outputEncoding) {
  const state = this[kState];
  outputEncoding = outputEncoding || getDefaultEncoding();

  if (state[kFinalized]) {
    const buf = Buffer.from('');
    return outputEncoding === 'buffer' ? buf : buf.toString(outputEncoding);
  }

  // Explicit conversion for backward compatibility.
  const ret = this[kHandle].digest(`${outputEncoding}`);
  state[kFinalized] = true;
  return ret;
};

Hmac.prototype._flush = Hash.prototype._flush;
Hmac.prototype._transform = Hash.prototype._transform;

// Implementation for WebCrypto subtle.digest()

async function asyncDigest(algorithm, data) {
  validateMaxBufferLength(data, 'data');

  switch (algorithm.name) {
    case 'SHA-1':
      // Fall through
    case 'SHA-256':
      // Fall through
    case 'SHA-384':
      // Fall through
    case 'SHA-512':
      return jobPromise(() => new HashJob(
        kCryptoJobAsync,
        normalizeHashName(algorithm.name),
        data));
  }

  throw lazyDOMException('Unrecognized algorithm name', 'NotSupportedError');
}

module.exports = {
  Hash,
  Hmac,
  asyncDigest,
};
