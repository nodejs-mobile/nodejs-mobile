'use strict';

const common = require('../common');
const assert = require('assert');
const { createServer } = require('http');
const { connect } = require('net');

// This test validates that the server returns 408
// after server.requestTimeout if the client
// pauses sending in the middle of the body.
let sendDelayedRequestBody;
const server = createServer(common.mustCall((req, res) => {
  let body = '';
  req.setEncoding('utf-8');

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write(body);
    res.end();
  });

  assert.strictEqual(typeof sendDelayedRequestBody, 'function');
  sendDelayedRequestBody();
}));

// 0 seconds is the default
assert.strictEqual(server.requestTimeout, 0);
const requestTimeout = common.platformTimeout(1000);
server.requestTimeout = requestTimeout;
assert.strictEqual(server.requestTimeout, requestTimeout);

server.listen(0, common.mustCall(() => {
  const client = connect(server.address().port);
  let response = '';

  client.on('data', common.mustCall((chunk) => {
    response += chunk.toString('utf-8');
  }));

  const errOrEnd = common.mustCall(function(err) {
    console.log(err);
    assert.strictEqual(
      response,
      'HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n'
    );
    server.close();
  });

  client.on('error', errOrEnd);
  client.on('end', errOrEnd);

  client.resume();
  client.write('POST / HTTP/1.1\r\n');
  client.write('Content-Length: 20\r\n');
  client.write('Connection: close\r\n');
  client.write('\r\n');
  client.write('1234567890');

  sendDelayedRequestBody = common.mustCall(() => {
    setTimeout(() => {
      client.write('1234567890\r\n\r\n');
    }, common.platformTimeout(2000)).unref();
  });
}));
