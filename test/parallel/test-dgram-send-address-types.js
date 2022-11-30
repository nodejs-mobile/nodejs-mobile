'use strict';
const common = require('../common');
const assert = require('assert');
const dgram = require('dgram');

const buf = Buffer.from('test');

const onMessage = common.mustSucceed((bytes) => {
  assert.strictEqual(bytes, buf.length);
}, 6);

const client = dgram.createSocket('udp4').bind(0, () => {
  const port = client.address().port;

  // Check valid addresses
  [false, '', null, 0, undefined].forEach((address) => {
    client.send(buf, port, address, onMessage);
  });

  // Valid address: not provided
  client.send(buf, port, onMessage);

  // Check invalid addresses
  [[], 1, true].forEach((invalidInput) => {
    const expectedError = {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: 'The "address" argument must be of type string or falsy.' +
               `${common.invalidArgTypeHelper(invalidInput)}`
    };
    assert.throws(() => client.send(buf, port, invalidInput), expectedError);
  });
});

client.unref();
