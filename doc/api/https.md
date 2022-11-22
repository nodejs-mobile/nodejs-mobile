# HTTPS

<!--introduced_in=v0.10.0-->

> Stability: 2 - Stable

<!-- source_link=lib/https.js -->

HTTPS is the HTTP protocol over TLS/SSL. In Node.js this is implemented as a
separate module.

## Class: `https.Agent`
<!-- YAML
added: v0.4.5
changes:
  - version: v2.5.0
    pr-url: https://github.com/nodejs/node/pull/2228
    description: parameter `maxCachedSessions` added to `options` for TLS
                 sessions reuse.
  - version: v5.3.0
    pr-url: https://github.com/nodejs/node/pull/4252
    description: support `0` `maxCachedSessions` to disable TLS session caching.
-->

An [`Agent`][] object for HTTPS similar to [`http.Agent`][]. See
[`https.request()`][] for more information.

### `new Agent([options])`
<!-- YAML
changes:
  - version: v12.5.0
    pr-url: https://github.com/nodejs/node/pull/28209
    description: do not automatically set servername if the target host was
                 specified using an IP address.
-->

* `options` {Object} Set of configurable options to set on the agent.
  Can have the same fields as for [`http.Agent(options)`][], and
  * `maxCachedSessions` {number} maximum number of TLS cached sessions.
    Use `0` to disable TLS session caching. **Default:** `100`.
  * `servername` {string} the value of
    [Server Name Indication extension][sni wiki] to be sent to the server. Use
    empty string `''` to disable sending the extension.
    **Default:** host name of the target server, unless the target server
    is specified using an IP address, in which case the default is `''` (no
    extension).

    See [`Session Resumption`][] for information about TLS session reuse.

#### Event: `'keylog'`
<!-- YAML
added: v12.16.0
-->

* `line` {Buffer} Line of ASCII text, in NSS `SSLKEYLOGFILE` format.
* `tlsSocket` {tls.TLSSocket} The `tls.TLSSocket` instance on which it was
  generated.

The `keylog` event is emitted when key material is generated or received by a
connection managed by this agent (typically before handshake has completed, but
not necessarily). This keying material can be stored for debugging, as it
allows captured TLS traffic to be decrypted. It may be emitted multiple times
for each socket.

A typical use case is to append received lines to a common text file, which is
later used by software (such as Wireshark) to decrypt the traffic:

```js
// ...
https.globalAgent.on('keylog', (line, tlsSocket) => {
  fs.appendFileSync('/tmp/ssl-keys.log', line, { mode: 0o600 });
});
```

## Class: `https.Server`
<!-- YAML
added: v0.3.4
-->

* Extends: {tls.Server}

See [`http.Server`][] for more information.

### `server.close([callback])`
<!-- YAML
added: v0.1.90
-->

* `callback` {Function}
* Returns: {https.Server}

See [`server.close()`][`http.close()`] from the HTTP module for details.

### `server.headersTimeout`
<!-- YAML
added: v11.3.0
-->

* {number} **Default:** `60000`

See [`http.Server#headersTimeout`][].

### `server.listen()`

Starts the HTTPS server listening for encrypted connections.
This method is identical to [`server.listen()`][] from [`net.Server`][].

### `server.maxHeadersCount`

* {number} **Default:** `2000`

See [`http.Server#maxHeadersCount`][].

### `server.setTimeout([msecs][, callback])`
<!-- YAML
added: v0.11.2
-->

* `msecs` {number} **Default:** `120000` (2 minutes)
* `callback` {Function}
* Returns: {https.Server}

See [`http.Server#setTimeout()`][].

### `server.timeout`
<!-- YAML
added: v0.11.2
-->

* {number} **Default:** `120000` (2 minutes)

See [`http.Server#timeout`][].

### `server.keepAliveTimeout`
<!-- YAML
added: v8.0.0
-->

* {number} **Default:** `5000` (5 seconds)

See [`http.Server#keepAliveTimeout`][].

## `https.createServer([options][, requestListener])`
<!-- YAML
added: v0.3.4
-->

* `options` {Object} Accepts `options` from [`tls.createServer()`][],
 [`tls.createSecureContext()`][] and [`http.createServer()`][].
* `requestListener` {Function} A listener to be added to the `'request'` event.
* Returns: {https.Server}

```js
// curl -k https://localhost:8000/
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('test/fixtures/keys/agent2-key.pem'),
  cert: fs.readFileSync('test/fixtures/keys/agent2-cert.pem')
};

https.createServer(options, (req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
}).listen(8000);
```

Or

```js
const https = require('https');
const fs = require('fs');

const options = {
  pfx: fs.readFileSync('test/fixtures/test_cert.pfx'),
  passphrase: 'sample'
};

https.createServer(options, (req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
}).listen(8000);
```

## `https.get(options[, callback])`
## `https.get(url[, options][, callback])`
<!-- YAML
added: v0.3.6
changes:
  - version: v10.9.0
    pr-url: https://github.com/nodejs/node/pull/21616
    description: The `url` parameter can now be passed along with a separate
                 `options` object.
  - version: v7.5.0
    pr-url: https://github.com/nodejs/node/pull/10638
    description: The `options` parameter can be a WHATWG `URL` object.
-->

* `url` {string | URL}
* `options` {Object | string | URL} Accepts the same `options` as
  [`https.request()`][], with the `method` always set to `GET`.
* `callback` {Function}

Like [`http.get()`][] but for HTTPS.

`options` can be an object, a string, or a [`URL`][] object. If `options` is a
string, it is automatically parsed with [`new URL()`][]. If it is a [`URL`][]
object, it will be automatically converted to an ordinary `options` object.

```js
const https = require('https');

https.get('https://encrypted.google.com/', (res) => {
  console.log('statusCode:', res.statusCode);
  console.log('headers:', res.headers);

  res.on('data', (d) => {
    process.stdout.write(d);
  });

}).on('error', (e) => {
  console.error(e);
});
```

## `https.globalAgent`
<!-- YAML
added: v0.5.9
-->

Global instance of [`https.Agent`][] for all HTTPS client requests.

## `https.request(options[, callback])`
## `https.request(url[, options][, callback])`
<!-- YAML
added: v0.3.6
changes:
  - version: v10.9.0
    pr-url: https://github.com/nodejs/node/pull/21616
    description: The `url` parameter can now be passed along with a separate
                 `options` object.
  - version: v9.3.0
    pr-url: https://github.com/nodejs/node/pull/14903
    description: The `options` parameter can now include `clientCertEngine`.
  - version: v7.5.0
    pr-url: https://github.com/nodejs/node/pull/10638
    description: The `options` parameter can be a WHATWG `URL` object.
-->

* `url` {string | URL}
* `options` {Object | string | URL} Accepts all `options` from
  [`http.request()`][], with some differences in default values:
  * `protocol` **Default:** `'https:'`
  * `port` **Default:** `443`
  * `agent` **Default:** `https.globalAgent`
* `callback` {Function}

Makes a request to a secure web server.

The following additional `options` from [`tls.connect()`][] are also accepted:
`ca`, `cert`, `ciphers`, `clientCertEngine`, `crl`, `dhparam`, `ecdhCurve`,
`honorCipherOrder`, `key`, `passphrase`, `pfx`, `rejectUnauthorized`,
`secureOptions`, `secureProtocol`, `servername`, `sessionIdContext`.

`options` can be an object, a string, or a [`URL`][] object. If `options` is a
string, it is automatically parsed with [`new URL()`][]. If it is a [`URL`][]
object, it will be automatically converted to an ordinary `options` object.

```js
const https = require('https');

const options = {
  hostname: 'encrypted.google.com',
  port: 443,
  path: '/',
  method: 'GET'
};

const req = https.request(options, (res) => {
  console.log('statusCode:', res.statusCode);
  console.log('headers:', res.headers);

  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (e) => {
  console.error(e);
});
req.end();
```

Example using options from [`tls.connect()`][]:

```js
const options = {
  hostname: 'encrypted.google.com',
  port: 443,
  path: '/',
  method: 'GET',
  key: fs.readFileSync('test/fixtures/keys/agent2-key.pem'),
  cert: fs.readFileSync('test/fixtures/keys/agent2-cert.pem')
};
options.agent = new https.Agent(options);

const req = https.request(options, (res) => {
  // ...
});
```

Alternatively, opt out of connection pooling by not using an [`Agent`][].

```js
const options = {
  hostname: 'encrypted.google.com',
  port: 443,
  path: '/',
  method: 'GET',
  key: fs.readFileSync('test/fixtures/keys/agent2-key.pem'),
  cert: fs.readFileSync('test/fixtures/keys/agent2-cert.pem'),
  agent: false
};

const req = https.request(options, (res) => {
  // ...
});
```

Example using a [`URL`][] as `options`:

```js
const options = new URL('https://abc:xyz@example.com');

const req = https.request(options, (res) => {
  // ...
});
```

Example pinning on certificate fingerprint, or the public key (similar to
`pin-sha256`):

```js
const tls = require('tls');
const https = require('https');
const crypto = require('crypto');

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('base64');
}
const options = {
  hostname: 'github.com',
  port: 443,
  path: '/',
  method: 'GET',
  checkServerIdentity: function(host, cert) {
    // Make sure the certificate is issued to the host we are connected to
    const err = tls.checkServerIdentity(host, cert);
    if (err) {
      return err;
    }

    // Pin the public key, similar to HPKP pin-sha25 pinning
    const pubkey256 = 'pL1+qb9HTMRZJmuC/bB/ZI9d302BYrrqiVuRyW+DGrU=';
    if (sha256(cert.pubkey) !== pubkey256) {
      const msg = 'Certificate verification error: ' +
        `The public key of '${cert.subject.CN}' ` +
        'does not match our pinned fingerprint';
      return new Error(msg);
    }

    // Pin the exact certificate, rather than the pub key
    const cert256 = '25:FE:39:32:D9:63:8C:8A:FC:A1:9A:29:87:' +
      'D8:3E:4C:1D:98:DB:71:E4:1A:48:03:98:EA:22:6A:BD:8B:93:16';
    if (cert.fingerprint256 !== cert256) {
      const msg = 'Certificate verification error: ' +
        `The certificate of '${cert.subject.CN}' ` +
        'does not match our pinned fingerprint';
      return new Error(msg);
    }

    // This loop is informational only.
    // Print the certificate and public key fingerprints of all certs in the
    // chain. Its common to pin the public key of the issuer on the public
    // internet, while pinning the public key of the service in sensitive
    // environments.
    do {
      console.log('Subject Common Name:', cert.subject.CN);
      console.log('  Certificate SHA256 fingerprint:', cert.fingerprint256);

      hash = crypto.createHash('sha256');
      console.log('  Public key ping-sha256:', sha256(cert.pubkey));

      lastprint256 = cert.fingerprint256;
      cert = cert.issuerCertificate;
    } while (cert.fingerprint256 !== lastprint256);

  },
};

options.agent = new https.Agent(options);
const req = https.request(options, (res) => {
  console.log('All OK. Server matched our pinned cert or public key');
  console.log('statusCode:', res.statusCode);
  // Print the HPKP values
  console.log('headers:', res.headers['public-key-pins']);

  res.on('data', (d) => {});
});

req.on('error', (e) => {
  console.error(e.message);
});
req.end();
```

Outputs for example:

```text
Subject Common Name: github.com
  Certificate SHA256 fingerprint: 25:FE:39:32:D9:63:8C:8A:FC:A1:9A:29:87:D8:3E:4C:1D:98:DB:71:E4:1A:48:03:98:EA:22:6A:BD:8B:93:16
  Public key ping-sha256: pL1+qb9HTMRZJmuC/bB/ZI9d302BYrrqiVuRyW+DGrU=
Subject Common Name: DigiCert SHA2 Extended Validation Server CA
  Certificate SHA256 fingerprint: 40:3E:06:2A:26:53:05:91:13:28:5B:AF:80:A0:D4:AE:42:2C:84:8C:9F:78:FA:D0:1F:C9:4B:C5:B8:7F:EF:1A
  Public key ping-sha256: RRM1dGqnDFsCJXBTHky16vi1obOlCgFFn/yOhI/y+ho=
Subject Common Name: DigiCert High Assurance EV Root CA
  Certificate SHA256 fingerprint: 74:31:E5:F4:C3:C1:CE:46:90:77:4F:0B:61:E0:54:40:88:3B:A9:A0:1E:D0:0B:A6:AB:D7:80:6E:D3:B1:18:CF
  Public key ping-sha256: WoiWRyIOVNa9ihaBciRSC7XHjliYS9VwUGOIud4PB18=
All OK. Server matched our pinned cert or public key
statusCode: 200
headers: max-age=0; pin-sha256="WoiWRyIOVNa9ihaBciRSC7XHjliYS9VwUGOIud4PB18="; pin-sha256="RRM1dGqnDFsCJXBTHky16vi1obOlCgFFn/yOhI/y+ho="; pin-sha256="k2v657xBsOVe1PQRwOsHsw3bsGT2VzIqz5K+59sNQws="; pin-sha256="K87oWBWM9UZfyddvDfoxL+8lpNyoUB2ptGtn0fv6G2Q="; pin-sha256="IQBnNBEiFuhj+8x6X8XLgh01V9Ic5/V3IRQLNFFc7v4="; pin-sha256="iie1VXtL7HzAMF+/PVPR9xzT80kQxdZeJ+zduCB3uj0="; pin-sha256="LvRiGEjRqfzurezaWuj8Wie2gyHMrW5Q06LspMnox7A="; includeSubDomains
```

[`Agent`]: #https_class_https_agent
[`URL`]: url.html#url_the_whatwg_url_api
[`http.Agent`]: http.html#http_class_http_agent
[`http.Agent(options)`]: http.html#http_new_agent_options
[`http.Server#headersTimeout`]: http.html#http_server_headerstimeout
[`http.Server#keepAliveTimeout`]: http.html#http_server_keepalivetimeout
[`http.Server#maxHeadersCount`]: http.html#http_server_maxheaderscount
[`http.Server#setTimeout()`]: http.html#http_server_settimeout_msecs_callback
[`http.Server#timeout`]: http.html#http_server_timeout
[`http.Server`]: http.html#http_class_http_server
[`http.close()`]: http.html#http_server_close_callback
[`http.createServer()`]: http.html#http_http_createserver_options_requestlistener
[`http.get()`]: http.html#http_http_get_options_callback
[`http.request()`]: http.html#http_http_request_options_callback
[`https.Agent`]: #https_class_https_agent
[`https.request()`]: #https_https_request_options_callback
[`net.Server`]: net.html#net_class_net_server
[`new URL()`]: url.html#url_new_url_input_base
[`server.listen()`]: net.html#net_server_listen
[`tls.connect()`]: tls.html#tls_tls_connect_options_callback
[`tls.createSecureContext()`]: tls.html#tls_tls_createsecurecontext_options
[`tls.createServer()`]: tls.html#tls_tls_createserver_options_secureconnectionlistener
[`Session Resumption`]: tls.html#tls_session_resumption
[sni wiki]: https://en.wikipedia.org/wiki/Server_Name_Indication
