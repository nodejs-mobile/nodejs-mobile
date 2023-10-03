'use strict';
const common = require('../common.js');
const { Blob } = require('buffer');

const bench = common.createBenchmark(main, {
  bytes: [128, 1024, 1024 ** 2],
  n: [1e6],
  operation: ['text', 'arrayBuffer'],
});

async function run(n, bytes, operation) {
  const buff = Buffer.allocUnsafe(bytes);
  const source = new Blob(buff);
  bench.start();
  for (let i = 0; i < n; i++) {
    switch (operation) {
      case 'text':
        await source.text();
        break;
      case 'arrayBuffer':
        await source.arrayBuffer();
        break;
    }
  }
  bench.end(n);
}

function main(conf) {
  run(conf.n, conf.bytes, conf.operation).catch(console.log);
}
