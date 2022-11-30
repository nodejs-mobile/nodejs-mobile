// Flags: --pending-deprecation

import '../common/index.mjs';
import assert from 'assert';
import fixtures from '../common/fixtures.js';
import { pathToFileURL } from 'url';

const selfDeprecatedFolders =
    fixtures.path('/es-modules/self-deprecated-folders/main.js');

const deprecatedFoldersIgnore =
    fixtures.path('/es-modules/deprecated-folders-ignore/main.js');

const deprecatedTrailingSlashPattern =
    fixtures.path('/es-modules/pattern-trailing-slash.mjs');

const expectedWarnings = [
  '"./" in the "exports" field',
  '"#self/" in the "imports" field',
  '"./folder/" in the "exports" field',
  '"./trailing-pattern-slash/" in the "exports" field',
];

process.addListener('warning', (warning) => {
  if (warning.stack.includes(expectedWarnings[0])) {
    expectedWarnings.shift();
  }
});

process.on('exit', () => {
  assert.deepStrictEqual(expectedWarnings, []);
});

(async () => {
  await import(pathToFileURL(selfDeprecatedFolders));
  await import(pathToFileURL(deprecatedFoldersIgnore));
  await import(pathToFileURL(deprecatedTrailingSlashPattern));
})()
.catch((err) => console.error(err));
