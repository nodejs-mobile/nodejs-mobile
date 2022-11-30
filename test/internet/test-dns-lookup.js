'use strict';

require('../common');
const common = require('../common');
const dns = require('dns');
const dnsPromises = dns.promises;
const { addresses } = require('../common/internet');
const assert = require('assert');

assert.rejects(
  dnsPromises.lookup(addresses.NOT_FOUND, {
    hints: 0,
    family: 0,
    all: false
  }),
  {
    code: 'ENOTFOUND',
    message: `getaddrinfo ENOTFOUND ${addresses.NOT_FOUND}`
  }
);

assert.rejects(
  dnsPromises.lookup(addresses.NOT_FOUND, {
    hints: 0,
    family: 0,
    all: true
  }),
  {
    code: 'ENOTFOUND',
    message: `getaddrinfo ENOTFOUND ${addresses.NOT_FOUND}`
  }
);

dns.lookup(addresses.NOT_FOUND, {
  hints: 0,
  family: 0,
  all: true
}, common.mustCall((error) => {
  assert.strictEqual(error.code, 'ENOTFOUND');
  assert.strictEqual(
    error.message,
    `getaddrinfo ENOTFOUND ${addresses.NOT_FOUND}`
  );
  assert.strictEqual(error.syscall, 'getaddrinfo');
  assert.strictEqual(error.hostname, addresses.NOT_FOUND);
}));
