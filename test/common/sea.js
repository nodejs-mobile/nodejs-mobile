'use strict';

const common = require('../common');
const fixtures = require('../common/fixtures');

const { readFileSync } = require('fs');
const { execFileSync } = require('child_process');

function skipIfSingleExecutableIsNotSupported() {
  if (!process.config.variables.single_executable_application)
    common.skip('Single Executable Application support has been disabled.');

  if (!['darwin', 'win32', 'linux'].includes(process.platform))
    common.skip(`Unsupported platform ${process.platform}.`);

  if (process.platform === 'linux' && process.config.variables.is_debug === 1)
    common.skip('Running the resultant binary fails with `Couldn\'t read target executable"`.');

  if (process.config.variables.node_shared)
    common.skip('Running the resultant binary fails with ' +
      '`/home/iojs/node-tmp/.tmp.2366/sea: error while loading shared libraries: ' +
      'libnode.so.112: cannot open shared object file: No such file or directory`.');

  if (process.config.variables.icu_gyp_path === 'tools/icu/icu-system.gyp')
    common.skip('Running the resultant binary fails with ' +
      '`/home/iojs/node-tmp/.tmp.2379/sea: error while loading shared libraries: ' +
      'libicui18n.so.71: cannot open shared object file: No such file or directory`.');

  if (!process.config.variables.node_use_openssl || process.config.variables.node_shared_openssl)
    common.skip('Running the resultant binary fails with `Node.js is not compiled with OpenSSL crypto support`.');

  if (process.config.variables.want_separate_host_toolset !== 0)
    common.skip('Running the resultant binary fails with `Segmentation fault (core dumped)`.');

  if (process.platform === 'linux') {
    const osReleaseText = readFileSync('/etc/os-release', { encoding: 'utf-8' });
    const isAlpine = /^NAME="Alpine Linux"/m.test(osReleaseText);
    if (isAlpine) common.skip('Alpine Linux is not supported.');

    if (process.arch === 's390x') {
      common.skip('On s390x, postject fails with `memory access out of bounds`.');
    }
  }
}

function injectAndCodeSign(targetExecutable, resource) {
  const postjectFile = fixtures.path('postject-copy', 'node_modules', 'postject', 'dist', 'cli.js');
  execFileSync(process.execPath, [
    postjectFile,
    targetExecutable,
    'NODE_SEA_BLOB',
    resource,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...process.platform === 'darwin' ? [ '--macho-segment-name', 'NODE_SEA' ] : [],
  ]);

  if (process.platform === 'darwin') {
    execFileSync('codesign', [ '--sign', '-', targetExecutable ]);
    execFileSync('codesign', [ '--verify', targetExecutable ]);
  } else if (process.platform === 'win32') {
    let signtoolFound = false;
    try {
      execFileSync('where', [ 'signtool' ]);
      signtoolFound = true;
    } catch (err) {
      console.log(err.message);
    }
    if (signtoolFound) {
      let certificatesFound = false;
      try {
        execFileSync('signtool', [ 'sign', '/fd', 'SHA256', targetExecutable ]);
        certificatesFound = true;
      } catch (err) {
        if (!/SignTool Error: No certificates were found that met all the given criteria/.test(err)) {
          throw err;
        }
      }
      if (certificatesFound) {
        execFileSync('signtool', 'verify', '/pa', 'SHA256', targetExecutable);
      }
    }
  }
}

module.exports = {
  skipIfSingleExecutableIsNotSupported,
  injectAndCodeSign,
};
