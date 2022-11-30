const t = require('tap')
const { load: loadMockNpm } = require('../../fixtures/mock-npm.js')

const dym = require('../../../lib/utils/did-you-mean.js')
t.test('did-you-mean', async t => {
  const { npm } = await loadMockNpm(t)
  t.test('with package.json', async t => {
    const testdir = t.testdir({
      'package.json': JSON.stringify({
        bin: {
          npx: 'exists',
        },
        scripts: {
          install: 'exists',
          posttest: 'exists',
        },
      }),
    })
    t.test('nistall', async t => {
      const result = await dym(npm, testdir, 'nistall')
      t.match(result, 'npm install')
    })
    t.test('sttest', async t => {
      const result = await dym(npm, testdir, 'sttest')
      t.match(result, 'npm test')
      t.match(result, 'npm run posttest')
    })
    t.test('npz', async t => {
      const result = await dym(npm, testdir, 'npxx')
      t.match(result, 'npm exec npx')
    })
    t.test('qwuijbo', async t => {
      const result = await dym(npm, testdir, 'qwuijbo')
      t.match(result, '')
    })
  })
  t.test('with no package.json', t => {
    const testdir = t.testdir({})
    t.test('nistall', async t => {
      const result = await dym(npm, testdir, 'nistall')
      t.match(result, 'npm install')
    })
    t.end()
  })
  t.test('missing bin and script properties', async t => {
    const testdir = t.testdir({
      'package.json': JSON.stringify({
        name: 'missing-bin',
      }),
    })

    const result = await dym(npm, testdir, 'nistall')
    t.match(result, 'npm install')
  })
})
