#!/bin/sh
# TODO Can this be done inside the .pmdoc?
# TODO Can we extract $PREFIX from the installer?
cd /usr/local/bin || exit

ln -sf ../lib/node_modules/npm/bin/npm-cli.js npm
ln -sf ../lib/node_modules/npm/bin/npx-cli.js npx

ln -sf ../lib/node_modules/corepack/dist/corepack.js corepack
