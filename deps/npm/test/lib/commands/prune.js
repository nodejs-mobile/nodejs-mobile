const t = require('tap')
const { load: loadMockNpm } = require('../../fixtures/mock-npm')

t.test('should prune using Arborist', async (t) => {
  t.plan(4)
  const { npm } = await loadMockNpm(t, {
    load: false,
    mocks: {
      '@npmcli/arborist': function (args) {
        t.ok(args, 'gets options object')
        t.ok(args.path, 'gets path option')
        this.prune = () => {
          t.ok(true, 'prune is called')
        }
      },
      '../../lib/utils/reify-finish.js': (arb) => {
        t.ok(arb, 'gets arborist tree')
      },
    },
  })
  await npm.exec('prune', [])
})
