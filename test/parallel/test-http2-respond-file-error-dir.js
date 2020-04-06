'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const http2 = require('http2');
const assert = require('assert');
const path = require('path');

if(common.isIOS || common.isAndroid) {
  // Change the working dir for what would be expected of the test framework
  //running in a Desktop environment.
  process.chdir(path.join(__dirname,'..','..'));
}

const server = http2.createServer();
server.on('stream', (stream) => {
  stream.respondWithFile(process.cwd(), {
    'content-type': 'text/plain'
  }, {
    onError(err) {
      common.expectsError({
        code: 'ERR_HTTP2_SEND_FILE',
        type: Error,
        message: 'Directories cannot be sent'
      })(err);

      stream.respond({ ':status': 404 });
      stream.end();
    },
    statCheck: common.mustNotCall()
  });
});
server.listen(0, () => {

  const client = http2.connect(`http://localhost:${server.address().port}`);
  const req = client.request();

  req.on('response', common.mustCall((headers) => {
    assert.strictEqual(headers[':status'], 404);
  }));
  req.on('data', common.mustNotCall());
  req.on('end', common.mustCall(() => {
    client.close();
    server.close();
  }));
  req.end();
});
