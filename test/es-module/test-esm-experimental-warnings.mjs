import { spawnPromisified } from '../common/index.mjs';
import { fileURL } from '../common/fixtures.mjs';
import { doesNotMatch, match, strictEqual } from 'node:assert';
import { execPath } from 'node:process';
import { describe, it } from 'node:test';


describe('ESM: warn for obsolete hooks provided', { concurrency: true }, () => {
  it('should not print warnings when no experimental features are enabled or used', async () => {
    const { code, signal, stderr } = await spawnPromisified(execPath, [
      '--input-type=module',
      '--eval',
      `import ${JSON.stringify(fileURL('es-module-loaders', 'module-named-exports.mjs'))}`,
    ]);

    doesNotMatch(
      stderr,
      /ExperimentalWarning/,
      new Error('No experimental warning(s) should be emitted when no experimental feature is enabled')
    );
    strictEqual(code, 0);
    strictEqual(signal, null);
  });

  describe('experimental warnings for enabled experimental feature', () => {
    for (
      const [experiment, arg] of [
        [/Custom ESM Loaders/, `--experimental-loader=${fileURL('es-module-loaders', 'hooks-custom.mjs')}`],
        [/Network Imports/, '--experimental-network-imports'],
        [/specifier resolution/, '--experimental-specifier-resolution=node'],
      ]
    ) {
      it(`should print for ${experiment.toString().replaceAll('/', '')}`, async () => {
        const { code, signal, stderr } = await spawnPromisified(execPath, [
          arg,
          '--input-type=module',
          '--eval',
          `import ${JSON.stringify(fileURL('es-module-loaders', 'module-named-exports.mjs'))}`,
        ]);

        match(stderr, /ExperimentalWarning/);
        match(stderr, experiment);
        strictEqual(code, 0);
        strictEqual(signal, null);
      });
    }
  });
});
