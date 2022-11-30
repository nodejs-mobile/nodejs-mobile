// TODO(isaacs): This test has a lot of very large objects pasted inline.
// Consider using t.matchSnapshot on these instead, especially since many
// of them contain the tap testdir folders, which are auto-generated and
// may change when node-tap is updated.
const t = require('tap')
const { fake: mockNpm } = require('../../fixtures/mock-npm.js')

const { resolve } = require('path')
const { utimesSync } = require('fs')
const touchHiddenPackageLock = prefix => {
  const later = new Date(Date.now() + 10000)
  utimesSync(`${prefix}/node_modules/.package-lock.json`, later, later)
}

t.cleanSnapshot = str => str.split(/\r\n/).join('\n')

const simpleNmFixture = {
  node_modules: {
    foo: {
      'package.json': JSON.stringify({
        name: 'foo',
        version: '1.0.0',
        dependencies: {
          dog: '^1.0.0',
        },
      }),
    },
    dog: {
      'package.json': JSON.stringify({
        name: 'dog',
        version: '1.0.0',
      }),
    },
    chai: {
      'package.json': JSON.stringify({
        name: 'chai',
        version: '1.0.0',
      }),
    },
  },
}

const diffDepTypesNmFixture = {
  node_modules: {
    'dev-dep': {
      'package.json': JSON.stringify({
        name: 'dev-dep',
        description: 'A DEV dep kind of dep',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
        },
      }),
    },
    'prod-dep': {
      'package.json': JSON.stringify({
        name: 'prod-dep',
        description: 'A PROD dep kind of dep',
        version: '1.0.0',
        dependencies: {
          dog: '^2.0.0',
        },
      }),
      node_modules: {
        dog: {
          'package.json': JSON.stringify({
            name: 'dog',
            description: 'A dep that bars',
            version: '2.0.0',
          }),
        },
      },
    },
    'optional-dep': {
      'package.json': JSON.stringify({
        name: 'optional-dep',
        description: 'Maybe a dep?',
        version: '1.0.0',
      }),
    },
    'peer-dep': {
      'package.json': JSON.stringify({
        name: 'peer-dep',
        description: 'Peer-dep description here',
        version: '1.0.0',
      }),
    },
    ...simpleNmFixture.node_modules,
  },
}

let result = ''
const LS = t.mock('../../../lib/commands/ls.js', {
  path: {
    ...require('path'),
    sep: '/',
  },
})
const config = {
  all: true,
  color: false,
  depth: Infinity,
  global: false,
  json: false,
  link: false,
  omit: [],
  parseable: false,
  'package-lock-only': false,
}
const flatOptions = {
  workspacesEnabled: true,
}
const npm = mockNpm({
  config,
  flatOptions,
  output: msg => {
    result = msg
  },
})
const ls = new LS(npm)

const redactCwd = res =>
  res &&
  res.replace(/\\+/g, '/').replace(new RegExp(__dirname.replace(/\\+/g, '/'), 'gi'), '{CWD}')

const redactCwdObj = obj => {
  if (Array.isArray(obj)) {
    return obj.map(o => redactCwdObj(o))
  } else if (typeof obj === 'string') {
    return redactCwd(obj)
  } else if (!obj) {
    return obj
  } else if (typeof obj === 'object') {
    return Object.keys(obj).reduce((o, k) => {
      o[k] = redactCwdObj(obj[k])
      return o
    }, {})
  } else {
    return obj
  }
}

const jsonParse = res => redactCwdObj(JSON.parse(res))

const cleanUpResult = () => (result = '')

t.test('ls', t => {
  t.beforeEach(cleanUpResult)
  config.json = false
  config.unicode = false
  t.test('no args', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree representation of dependencies structure'
    )
  })

  t.test('missing package.json', async t => {
    npm.prefix = t.testdir({
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree missing name/version of top-level package'
    )
  })

  t.test('extraneous deps', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output containing problems info')
  })

  t.test('with filter arg', async t => {
    npm.color = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['chai'])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree contaning only occurrences of filtered by package and colored output'
    )
    npm.color = false
  })

  t.test('with dot filter arg', async t => {
    config.all = false
    config.depth = 0
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          ipsum: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['.'])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree contaning only occurrences of filtered by package and colored output'
    )
    config.all = true
    config.depth = Infinity
    process.exitCode = 0
  })

  t.test('with filter arg nested dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['dog'])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree contaning only occurrences of filtered package and its ancestors'
    )
  })

  t.test('with multiple filter args', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
          ipsum: '^1.0.0',
        },
      }),
      node_modules: {
        ...simpleNmFixture.node_modules,
        ipsum: {
          'package.json': JSON.stringify({
            name: 'ipsum',
            version: '1.0.0',
          }),
        },
      },
    })
    await ls.exec(['dog@*', 'chai@1.0.0'])
    t.matchSnapshot(
      redactCwd(result),
      /* eslint-disable-next-line max-len */
      'should output tree contaning only occurrences of multiple filtered packages and their ancestors'
    )
  })

  t.test('with missing filter arg', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['notadep'])
    t.matchSnapshot(redactCwd(result), 'should output tree containing no dependencies info')
    t.equal(process.exitCode, 1, 'should exit with error code 1')
    process.exitCode = 0
  })

  t.test('default --depth value should be 0', async t => {
    config.all = false
    config.depth = undefined
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing only top-level dependencies')
    config.all = true
    config.depth = Infinity
  })

  t.test('--depth=0', async t => {
    config.all = false
    config.depth = 0
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing only top-level dependencies')
    config.all = true
    config.depth = Infinity
  })

  t.test('--depth=1', async t => {
    config.all = false
    config.depth = 1
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
          e: '^1.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^1.0.0',
            },
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: {
              c: '^1.0.0',
              d: '*',
            },
          }),
        },
        c: {
          'package.json': JSON.stringify({
            name: 'c',
            version: '1.0.0',
          }),
        },
        d: {
          'package.json': JSON.stringify({
            name: 'd',
            version: '1.0.0',
          }),
        },
        e: {
          'package.json': JSON.stringify({
            name: 'e',
            version: '1.0.0',
          }),
        },
      },
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree containing top-level deps and their deps only'
    )
    config.all = true
    config.depth = Infinity
  })

  t.test('missing/invalid/extraneous', async t => {
    t.plan(3)
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^2.0.0',
          ipsum: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([]).catch(err => {
      t.equal(err.code, 'ELSPROBLEMS', 'should have error code')
      t.equal(
        redactCwd(err.message).replace(/\r\n/g, '\n'),
        /* eslint-disable-next-line max-len */
        'extraneous: chai@1.0.0 {CWD}/tap-testdir-ls-ls-missing-invalid-extraneous/node_modules/chai\n' +
        'invalid: foo@1.0.0 {CWD}/tap-testdir-ls-ls-missing-invalid-extraneous/node_modules/foo\n' +
        'missing: ipsum@^1.0.0, required by test-npm-ls@1.0.0',
        'should log missing/invalid/extraneous errors'
      )
    })
    t.matchSnapshot(
      redactCwd(result),
      'should output tree containing missing, invalid, extraneous labels'
    )
  })

  t.test('colored output', async t => {
    npm.color = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^2.0.0',
          ipsum: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' }, 'should have error code')
    t.matchSnapshot(redactCwd(result), 'should output tree containing color info')
    npm.color = false
  })

  t.test('--dev', async t => {
    flatOptions.omit = ['peer', 'prod', 'optional']
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing dev deps')
    flatOptions.omit = []
  })

  t.test('--link', async t => {
    config.link = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
          'linked-dep': '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      'linked-dep': {
        'package.json': JSON.stringify({
          name: 'linked-dep',
          version: '1.0.0',
        }),
      },
      node_modules: {
        'linked-dep': t.fixture('symlink', '../linked-dep'),
        ...diffDepTypesNmFixture.node_modules,
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing linked deps')
    config.link = false
  })

  t.test('print deduped symlinks', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'print-deduped-symlinks',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
          b: '^1.0.0',
        },
      }),
      b: {
        'package.json': JSON.stringify({
          name: 'b',
          version: '1.0.0',
        }),
      },
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^1.0.0',
            },
          }),
        },
        b: t.fixture('symlink', '../b'),
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing linked deps')
    config.link = false
  })

  t.test('--production', async t => {
    flatOptions.omit = ['dev', 'peer']
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing production deps')
    flatOptions.omit = []
  })

  t.test('--long', async t => {
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree info with descriptions')
    config.long = true
  })

  t.test('--long --depth=0', async t => {
    config.all = false
    config.depth = 0
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree containing top-level deps with descriptions'
    )
    config.all = true
    config.depth = Infinity
    config.long = false
  })

  t.test('json read problems', async t => {
    npm.prefix = t.testdir({
      'package.json': '{broken json',
    })
    await t.rejects(ls.exec([]), { code: 'EJSONPARSE' }, 'should throw EJSONPARSE error')
    t.matchSnapshot(redactCwd(result), 'should print empty result')
  })

  t.test('empty location', async t => {
    npm.prefix = t.testdir({})
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print empty result')
  })

  t.test('invalid peer dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^2.0.0', // mismatching version #
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await t.rejects(ls.exec([]))
    t.matchSnapshot(
      redactCwd(result),
      'should output tree signaling mismatching peer dep in problems'
    )
  })

  t.test('invalid deduped dep', async t => {
    npm.color = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'invalid-deduped-dep',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
          b: '^2.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^2.0.0',
            },
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
          }),
        },
      },
    })
    await t.rejects(ls.exec([]))
    t.matchSnapshot(
      redactCwd(result),
      'should output tree signaling mismatching peer dep in problems'
    )
    npm.color = false
  })

  t.test('deduped missing dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
          b: '^1.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^1.0.0',
            },
          }),
        },
      },
    })
    await t.rejects(
      ls.exec([]),
      { code: 'ELSPROBLEMS', message: /missing: b@\^1.0.0/ },
      'should list missing dep problem'
    )
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable signaling missing peer dep in problems'
    )
  })

  t.test('unmet peer dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        peerDependencies: {
          'peer-dep': '*',
        },
      }),
    })
    await t.rejects(
      ls.exec([]),
      { code: 'ELSPROBLEMS', message: 'missing: peer-dep@*, required by test-npm-ls@1.0.0' },
      'should have missing peer-dep error msg'
    )
    t.matchSnapshot(redactCwd(result), 'should output tree signaling missing peer dep in problems')
  })

  t.test('unmet optional dep', async t => {
    npm.color = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'missing-optional-dep': '^1.0.0',
          'optional-dep': '^2.0.0', // mismatching version #
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await t.rejects(
      ls.exec([]),
      { code: 'ELSPROBLEMS', message: /invalid: optional-dep@1.0.0/ },
      'should have invalid dep error msg'
    )
    t.matchSnapshot(
      redactCwd(result),
      'should output tree with empty entry for missing optional deps'
    )
    npm.color = false
  })

  t.test('cycle deps', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^1.0.0',
            },
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: {
              a: '^1.0.0',
            },
          }),
        },
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print tree output containing deduped ref')
  })

  t.test('cycle deps with filter args', async t => {
    npm.color = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^1.0.0',
            },
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: {
              a: '^1.0.0',
            },
          }),
        },
      },
    })
    await ls.exec(['a'])
    t.matchSnapshot(redactCwd(result), 'should print tree output containing deduped ref')
    npm.color = false
  })

  t.test('with no args dedupe entries', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'dedupe-entries',
        version: '1.0.0',
        dependencies: {
          '@npmcli/a': '^1.0.0',
          '@npmcli/b': '^1.0.0',
          '@npmcli/c': '^1.0.0',
        },
      }),
      node_modules: {
        '@npmcli': {
          a: {
            'package.json': JSON.stringify({
              name: '@npmcli/a',
              version: '1.0.0',
              dependencies: {
                '@npmcli/b': '^1.0.0',
              },
            }),
          },
          b: {
            'package.json': JSON.stringify({
              name: '@npmcli/b',
              version: '1.1.2',
            }),
          },
          c: {
            'package.json': JSON.stringify({
              name: '@npmcli/c',
              version: '1.0.0',
              dependencies: {
                '@npmcli/b': '^1.0.0',
              },
            }),
          },
        },
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print tree output containing deduped ref')
  })

  t.test('with no args dedupe entries and not displaying all', async t => {
    config.all = false
    config.depth = 0
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'dedupe-entries',
        version: '1.0.0',
        dependencies: {
          '@npmcli/a': '^1.0.0',
          '@npmcli/b': '^1.0.0',
          '@npmcli/c': '^1.0.0',
        },
      }),
      node_modules: {
        '@npmcli': {
          a: {
            'package.json': JSON.stringify({
              name: '@npmcli/a',
              version: '1.0.0',
              dependencies: {
                '@npmcli/b': '^1.0.0',
              },
            }),
          },
          b: {
            'package.json': JSON.stringify({
              name: '@npmcli/b',
              version: '1.1.2',
            }),
          },
          c: {
            'package.json': JSON.stringify({
              name: '@npmcli/c',
              version: '1.0.0',
              dependencies: {
                '@npmcli/b': '^1.0.0',
              },
            }),
          },
        },
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print tree output containing deduped ref')
    config.all = true
    config.depth = Infinity
  })

  t.test('with args and dedupe entries', async t => {
    npm.color = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'dedupe-entries',
        version: '1.0.0',
        dependencies: {
          '@npmcli/a': '^1.0.0',
          '@npmcli/b': '^1.0.0',
          '@npmcli/c': '^1.0.0',
        },
      }),
      node_modules: {
        '@npmcli': {
          a: {
            'package.json': JSON.stringify({
              name: '@npmcli/a',
              version: '1.0.0',
              dependencies: {
                '@npmcli/b': '^1.0.0',
              },
            }),
          },
          b: {
            'package.json': JSON.stringify({
              name: '@npmcli/b',
              version: '1.1.2',
            }),
          },
          c: {
            'package.json': JSON.stringify({
              name: '@npmcli/c',
              version: '1.0.0',
              dependencies: {
                '@npmcli/b': '^1.0.0',
              },
            }),
          },
        },
      },
    })
    await ls.exec(['@npmcli/b'])
    t.matchSnapshot(redactCwd(result), 'should print tree output containing deduped ref')
    npm.color = false
  })

  t.test('with args and different order of items', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'dedupe-entries',
        version: '1.0.0',
        dependencies: {
          '@npmcli/a': '^1.0.0',
          '@npmcli/b': '^1.0.0',
          '@npmcli/c': '^1.0.0',
        },
      }),
      node_modules: {
        '@npmcli': {
          a: {
            'package.json': JSON.stringify({
              name: '@npmcli/a',
              version: '1.0.0',
              dependencies: {
                '@npmcli/c': '^1.0.0',
              },
            }),
          },
          b: {
            'package.json': JSON.stringify({
              name: '@npmcli/b',
              version: '1.1.2',
              dependencies: {
                '@npmcli/c': '^1.0.0',
              },
            }),
          },
          c: {
            'package.json': JSON.stringify({
              name: '@npmcli/c',
              version: '1.0.0',
            }),
          },
        },
      },
    })
    await ls.exec(['@npmcli/c'])
    t.matchSnapshot(redactCwd(result), 'should print tree output containing deduped ref')
  })

  t.test('using aliases', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: 'npm:b@1.0.0',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/a': {
              name: 'b',
              version: '1.0.0',
              from: 'a@npm:b',
              resolved: 'https://localhost:8080/abbrev/-/abbrev-1.1.1.tgz',
              requested: {
                type: 'alias',
              },
            },
          },
        }),
        a: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            _from: 'a@npm:b',
            _resolved: 'https://localhost:8080/abbrev/-/abbrev-1.1.1.tgz',
            _requested: {
              type: 'alias',
            },
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing aliases')
  })

  t.test('resolved points to git ref', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          abbrev: 'git+https://github.com/isaacs/abbrev-js.git',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/abbrev': {
              name: 'abbrev',
              version: '1.1.1',
              from: 'git+https://github.com/isaacs/abbrev-js.git',
              /* eslint-disable-next-line max-len */
              resolved: 'git+https://github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            },
          },
        }),
        abbrev: {
          'package.json': JSON.stringify({
            name: 'abbrev',
            version: '1.1.1',
            _id: 'abbrev@1.1.1',
            _from: 'git+https://github.com/isaacs/abbrev-js.git',
            /* eslint-disable-next-line max-len */
            _resolved: 'git+https://github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            _requested: {
              type: 'git',
              raw: 'git+https:github.com/isaacs/abbrev-js.git',
              rawSpec: 'git+https:github.com/isaacs/abbrev-js.git',
              saveSpec: 'git+https://github.com/isaacs/abbrev-js.git',
              fetchSpec: 'https://github.com/isaacs/abbrev-js.git',
              gitCommittish: null,
            },
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing git refs')
  })

  t.test('broken resolved field', async t => {
    npm.prefix = t.testdir({
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.1',
          }),
        },
      },
      'package-lock.json': JSON.stringify({
        name: 'npm-broken-resolved-field-test',
        version: '1.0.0',
        lockfileVersion: 2,
        requires: true,
        packages: {
          '': {
            name: 'a',
            version: '1.0.1',
          },
        },
        dependencies: {
          a: {
            version: '1.0.1',
            resolved: 'foo@dog://b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            /* eslint-disable-next-line max-len */
            integrity: 'sha512-8AN9lNCcBt5Xeje7fMEEpp5K3rgcAzIpTtAjYb/YMUYu8SbIVF6wz0WqACDVKvpQOUcSfNHZQNLNmue0QSwXOQ==',
          },
        },
      }),
      'package.json': JSON.stringify({
        name: 'npm-broken-resolved-field-test',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.1',
        },
      }),
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should NOT print git refs in output tree')
  })

  t.test('from and resolved properties', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'simple-output': '^2.0.0',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/simple-output': {
              name: 'simple-output',
              version: '2.1.1',
              resolved: 'https://registry.npmjs.org/simple-output/-/simple-output-2.1.1.tgz',
              shasum: '3c07708ec9ef3e3c985cf0ddd67df09ab8ec2abc',
            },
          },
        }),
        'simple-output': {
          'package.json': JSON.stringify({
            name: 'simple-output',
            version: '2.1.1',
            _from: 'simple-output',
            _id: 'simple-output@2.1.1',
            _resolved: 'https://registry.npmjs.org/simple-output/-/simple-output-2.1.1.tgz',
            _requested: {
              type: 'tag',
              registry: true,
              raw: 'simple-output',
              name: 'simple-output',
              escapedName: 'simple-output',
              rawSpec: '',
              saveSpec: null,
              fetchSpec: 'latest',
            },
            _requiredBy: ['#USER', '/'],
            _shasum: '3c07708ec9ef3e3c985cf0ddd67df09ab8ec2abc',
            _spec: 'simple-output',
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should not be printed in tree output')
  })

  t.test('global', async t => {
    config.global = true
    const fixtures = t.testdir({
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
          }),
          node_modules: {
            c: {
              'package.json': JSON.stringify({
                name: 'c',
                version: '1.0.0',
              }),
            },
          },
        },
      },
    })

    // mimics lib/npm.js globalDir getter but pointing to fixtures
    npm.globalDir = resolve(fixtures, 'node_modules')

    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print tree and not mark top-level items extraneous')
    npm.globalDir = 'MISSING_GLOBAL_DIR'
    config.global = false
  })

  t.test('filtering by child of missing dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'filter-by-child-of-missing-dep',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
        },
      }),
      node_modules: {
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: {
              c: '^1.0.0',
            },
          }),
        },
        c: {
          'package.json': JSON.stringify({
            name: 'c',
            version: '1.0.0',
          }),
        },
        d: {
          'package.json': JSON.stringify({
            name: 'd',
            version: '1.0.0',
            dependencies: {
              c: '^2.0.0',
            },
          }),
          node_modules: {
            c: {
              'package.json': JSON.stringify({
                name: 'c',
                version: '2.0.0',
              }),
            },
          },
        },
      },
    })

    await ls.exec(['c'])
    t.matchSnapshot(
      redactCwd(result),
      'should print tree and not duplicate child of missing items'
    )
  })

  t.test('loading a tree containing workspaces', async t => {
    npm.localPrefix = npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'workspaces-tree',
        version: '1.0.0',
        workspaces: ['./a', './b', './d', './group/*'],
        dependencies: { pacote: '1.0.0' },
      }),
      node_modules: {
        a: t.fixture('symlink', '../a'),
        b: t.fixture('symlink', '../b'),
        c: {
          'package.json': JSON.stringify({
            name: 'c',
            version: '1.0.0',
          }),
        },
        d: t.fixture('symlink', '../d'),
        e: t.fixture('symlink', '../group/e'),
        f: t.fixture('symlink', '../group/f'),
        foo: {
          'package.json': JSON.stringify({
            name: 'foo',
            version: '1.1.1',
            dependencies: {
              bar: '^1.0.0',
            },
          }),
        },
        bar: {
          'package.json': JSON.stringify({ name: 'bar', version: '1.0.0' }),
        },
        baz: {
          'package.json': JSON.stringify({ name: 'baz', version: '1.0.0' }),
        },
        pacote: {
          'package.json': JSON.stringify({ name: 'pacote', version: '1.0.0' }),
        },
      },
      a: {
        'package.json': JSON.stringify({
          name: 'a',
          version: '1.0.0',
          dependencies: {
            c: '^1.0.0',
            d: '^1.0.0',
          },
          devDependencies: {
            baz: '^1.0.0',
          },
        }),
      },
      b: {
        'package.json': JSON.stringify({
          name: 'b',
          version: '1.0.0',
        }),
      },
      d: {
        'package.json': JSON.stringify({
          name: 'd',
          version: '1.0.0',
          dependencies: {
            foo: '^1.1.1',
          },
        }),
      },
      group: {
        e: {
          'package.json': JSON.stringify({
            name: 'e',
            version: '1.0.0',
          }),
        },
        f: {
          'package.json': JSON.stringify({
            name: 'f',
            version: '1.0.0',
          }),
        },
      },
    })

    config.all = false
    config.depth = 0
    npm.color = true
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should list workspaces properly with default configs')

    config.all = false
    config.depth = 0
    npm.color = true
    npm.flatOptions.workspacesEnabled = false
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should not list workspaces with --no-workspaces')

    config.all = true
    config.depth = Infinity
    npm.color = false
    npm.flatOptions.workspacesEnabled = true

    // --all
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should list --all workspaces properly')

    // --production
    flatOptions.omit = ['dev', 'peer', 'optional']
    await ls.exec([])

    t.matchSnapshot(redactCwd(result), 'should list only prod deps of workspaces')

    flatOptions.omit = []

    // filter out a single workspace using args
    await ls.exec(['d'])
    t.matchSnapshot(redactCwd(result), 'should filter single workspace')

    // filter out a single workspace and its deps using workspaces filters
    await ls.execWorkspaces([], ['a'])

    t.matchSnapshot(redactCwd(result), 'should filter using workspace config')

    // filter out a single workspace and include root
    npm.flatOptions.includeWorkspaceRoot = true
    await ls.execWorkspaces([], ['d'])
    t.matchSnapshot(redactCwd(result), 'should inlude root and specified workspace')
    npm.flatOptions.includeWorkspaceRoot = false

    // filter out a workspace by parent path
    await ls.execWorkspaces([], ['./group'])

    t.matchSnapshot(redactCwd(result), 'should filter by parent folder workspace config')

    // filter by a dep within a workspaces sub tree
    await ls.execWorkspaces(['bar'], ['d'])

    t.matchSnapshot(
      redactCwd(result),
      'should print all tree and filter by dep within only the ws subtree'
    )
  })

  t.test('filter pkg arg using depth option', async t => {
    config.depth = 0
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-pkg-arg-filter-with-depth-opt',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
          b: '^1.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: {
              c: '^1.0.0',
            },
          }),
        },
        c: {
          'package.json': JSON.stringify({
            name: 'c',
            version: '1.0.0',
            dependencies: {
              d: '^1.0.0',
            },
          }),
        },
        d: {
          'package.json': JSON.stringify({
            name: 'd',
            version: '1.0.0',
            dependencies: {
              a: '^1.0.0',
            },
          }),
        },
      },
    })

    t.plan(3)
    await ls.exec(['a'])
    t.matchSnapshot(redactCwd(result), 'should list a in top-level only')

    await ls.exec(['d'])
    t.matchSnapshot(redactCwd(result), 'should print empty results msg')

    // if no --depth config is defined, should print path to dep
    config.depth = null // default config value
    await ls.exec(['d'])
    t.matchSnapshot(redactCwd(result), 'should print expected result')
    process.exitCode = 0
  })

  t.teardown(() => {
    config.depth = Infinity
  })

  t.end()
})

t.test('ls --parseable', t => {
  t.beforeEach(cleanUpResult)
  config.json = false
  config.unicode = false
  config.parseable = true
  t.test('no args', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable representation of dependencies structure'
    )
  })

  t.test('missing package.json', async t => {
    npm.prefix = t.testdir({
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable missing name/version of top-level package'
    )
  })

  t.test('extraneous deps', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output containing problems info')
  })

  t.test('with filter arg', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['chai'])
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable contaning only occurrences of filtered by package'
    )
  })

  t.test('with filter arg nested dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['dog'])
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable contaning only occurrences of filtered package'
    )
  })

  t.test('with multiple filter args', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
          ipsum: '^1.0.0',
        },
      }),
      node_modules: {
        ...simpleNmFixture.node_modules,
        ipsum: {
          'package.json': JSON.stringify({
            name: 'ipsum',
            version: '1.0.0',
          }),
        },
      },
    })
    await ls.exec(['dog@*', 'chai@1.0.0'])
    t.matchSnapshot(
      redactCwd(result),
      /* eslint-disable-next-line max-len */
      'should output parseable contaning only occurrences of multiple filtered packages and their ancestors'
    )
  })

  t.test('with missing filter arg', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['notadep'])
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable output containing no dependencies info'
    )
  })

  t.test('default --depth value should be 0', async t => {
    config.all = false
    config.depth = undefined
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable output containing only top-level dependencies'
    )
    config.all = true
    config.depth = Infinity
  })

  t.test('--depth=0', async t => {
    config.all = false
    config.depth = 0
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing only top-level dependencies')
    config.all = true
    config.depth = Infinity
  })

  t.test('--depth=1', async t => {
    config.all = false
    config.depth = 1
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable containing top-level deps and their deps only'
    )
    config.all = true
    config.depth = Infinity
  })

  t.test('missing/invalid/extraneous', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^2.0.0',
          ipsum: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' }, 'should list dep problems')
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable containing top-level deps and their deps only'
    )
  })

  t.test('--dev', async t => {
    flatOptions.omit = ['peer', 'prod', 'optional']
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing dev deps')
    flatOptions.omit = []
  })

  t.test('--link', async t => {
    config.link = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
          'linked-dep': '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      'linked-dep': {
        'package.json': JSON.stringify({
          name: 'linked-dep',
          version: '1.0.0',
        }),
      },
      node_modules: {
        'linked-dep': t.fixture('symlink', '../linked-dep'),
        ...diffDepTypesNmFixture.node_modules,
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing linked deps')
    config.link = false
  })

  t.test('--production', async t => {
    flatOptions.omit = ['dev', 'peer']
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing production deps')
    flatOptions.omit = []
  })

  t.test('--long', async t => {
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree info with descriptions')
    config.long = true
  })

  t.test('--long with extraneous deps', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output long parseable output with extraneous info')
  })

  t.test('--long missing/invalid/extraneous', async t => {
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^2.0.0',
          ipsum: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' }, 'should list dep problems')
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable result containing EXTRANEOUS/INVALID labels'
    )
    config.long = false
  })

  t.test('--long print symlink target location', async t => {
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
          'linked-dep': '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      'linked-dep': {
        'package.json': JSON.stringify({
          name: 'linked-dep',
          version: '1.0.0',
        }),
      },
      node_modules: {
        'linked-dep': t.fixture('symlink', '../linked-dep'),
        ...diffDepTypesNmFixture.node_modules,
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output parseable results with symlink targets')
    config.long = false
  })

  t.test('--long --depth=0', async t => {
    config.all = false
    config.depth = 0
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.matchSnapshot(
      redactCwd(result),
      'should output tree containing top-level deps with descriptions'
    )
    config.all = true
    config.depth = Infinity
    config.long = false
  })

  t.test('json read problems', async t => {
    npm.prefix = t.testdir({
      'package.json': '{broken json',
    })
    await t.rejects(ls.exec([]), { code: 'EJSONPARSE' }, 'should throw EJSONPARSE error')
    t.matchSnapshot(redactCwd(result), 'should print empty result')
  })

  t.test('empty location', async t => {
    npm.prefix = t.testdir({})
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print empty result')
  })

  t.test('unmet peer dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^2.0.0', // mismatching version #
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await t.rejects(ls.exec([]))
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable signaling missing peer dep in problems'
    )
  })

  t.test('unmet optional dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'missing-optional-dep': '^1.0.0',
          'optional-dep': '^2.0.0', // mismatching version #
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await t.rejects(
      ls.exec([]),
      { code: 'ELSPROBLEMS', message: /invalid: optional-dep@1.0.0/ },
      'should have invalid dep error msg'
    )
    t.matchSnapshot(
      redactCwd(result),
      'should output parseable with empty entry for missing optional deps'
    )
  })

  t.test('cycle deps', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^1.0.0',
            },
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: {
              a: '^1.0.0',
            },
          }),
        },
      },
    })
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print tree output omitting deduped ref')
  })

  t.test('using aliases', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: 'npm:b@1.0.0',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/a': {
              name: 'b',
              version: '1.0.0',
              resolved: 'https://localhost:8080/abbrev/-/abbrev-1.1.1.tgz',
            },
          },
        }),
        a: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            _from: 'a@npm:b',
            _resolved: 'https://localhost:8080/abbrev/-/abbrev-1.1.1.tgz',
            _requested: {
              type: 'alias',
            },
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing aliases')
  })

  t.test('resolved points to git ref', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          abbrev: 'git+https://github.com/isaacs/abbrev-js.git',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/abbrev': {
              name: 'abbrev',
              version: '1.1.1',
              /* eslint-disable-next-line max-len */
              resolved: 'git+https://github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            },
          },
        }),
        abbrev: {
          'package.json': JSON.stringify({
            name: 'abbrev',
            version: '1.1.1',
            _id: 'abbrev@1.1.1',
            _from: 'git+https://github.com/isaacs/abbrev-js.git',
            /* eslint-disable-next-line max-len */
            _resolved: 'git+https://github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            _requested: {
              type: 'git',
              raw: 'git+https:github.com/isaacs/abbrev-js.git',
              rawSpec: 'git+https:github.com/isaacs/abbrev-js.git',
              saveSpec: 'git+https://github.com/isaacs/abbrev-js.git',
              fetchSpec: 'https://github.com/isaacs/abbrev-js.git',
              gitCommittish: null,
            },
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should output tree containing git refs')
  })

  t.test('from and resolved properties', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'simple-output': '^2.0.0',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/simple-output': {
              name: 'simple-output',
              version: '2.1.1',
              resolved: 'https://registry.npmjs.org/simple-output/-/simple-output-2.1.1.tgz',
              shasum: '3c07708ec9ef3e3c985cf0ddd67df09ab8ec2abc',
            },
          },
        }),
        'simple-output': {
          'package.json': JSON.stringify({
            name: 'simple-output',
            version: '2.1.1',
            _from: 'simple-output',
            _id: 'simple-output@2.1.1',
            _resolved: 'https://registry.npmjs.org/simple-output/-/simple-output-2.1.1.tgz',
            _requested: {
              type: 'tag',
              registry: true,
              raw: 'simple-output',
              name: 'simple-output',
              escapedName: 'simple-output',
              rawSpec: '',
              saveSpec: null,
              fetchSpec: 'latest',
            },
            _requiredBy: ['#USER', '/'],
            _shasum: '3c07708ec9ef3e3c985cf0ddd67df09ab8ec2abc',
            _spec: 'simple-output',
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should not be printed in tree output')
  })

  t.test('global', async t => {
    config.global = true
    const fixtures = t.testdir({
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
          }),
          node_modules: {
            c: {
              'package.json': JSON.stringify({
                name: 'c',
                version: '1.0.0',
              }),
            },
          },
        },
      },
    })

    // mimics lib/npm.js globalDir getter but pointing to fixtures
    npm.globalDir = resolve(fixtures, 'node_modules')

    await ls.exec([])
    t.matchSnapshot(redactCwd(result), 'should print parseable output for global deps')
    npm.globalDir = 'MISSING_GLOBAL_DIR'
    config.global = false
  })

  t.end()
})

t.test('ignore missing optional deps', async t => {
  t.beforeEach(cleanUpResult)
  npm.prefix = t.testdir({
    'package.json': JSON.stringify({
      name: 'test-npm-ls-ignore-missing-optional',
      version: '1.2.3',
      peerDependencies: {
        'peer-ok': '1',
        'peer-missing': '1',
        'peer-wrong': '1',
        'peer-optional-ok': '1',
        'peer-optional-missing': '1',
        'peer-optional-wrong': '1',
      },
      peerDependenciesMeta: {
        'peer-optional-ok': {
          optional: true,
        },
        'peer-optional-missing': {
          optional: true,
        },
        'peer-optional-wrong': {
          optional: true,
        },
      },
      optionalDependencies: {
        'optional-ok': '1',
        'optional-missing': '1',
        'optional-wrong': '1',
      },
      dependencies: {
        'prod-ok': '1',
        'prod-missing': '1',
        'prod-wrong': '1',
      },
    }),
    node_modules: {
      'prod-ok': {
        'package.json': JSON.stringify({ name: 'prod-ok', version: '1.2.3' }),
      },
      'prod-wrong': {
        'package.json': JSON.stringify({ name: 'prod-wrong', version: '3.2.1' }),
      },
      'optional-ok': {
        'package.json': JSON.stringify({ name: 'optional-ok', version: '1.2.3' }),
      },
      'optional-wrong': {
        'package.json': JSON.stringify({ name: 'optional-wrong', version: '3.2.1' }),
      },
      'peer-optional-ok': {
        'package.json': JSON.stringify({ name: 'peer-optional-ok', version: '1.2.3' }),
      },
      'peer-optional-wrong': {
        'package.json': JSON.stringify({ name: 'peer-optional-wrong', version: '3.2.1' }),
      },
      'peer-ok': {
        'package.json': JSON.stringify({ name: 'peer-ok', version: '1.2.3' }),
      },
      'peer-wrong': {
        'package.json': JSON.stringify({ name: 'peer-wrong', version: '3.2.1' }),
      },
    },
  })

  config.all = true
  const prefix = npm.prefix.toLowerCase().replace(/\\/g, '/')
  const cleanupPaths = str => str.toLowerCase().replace(/\\/g, '/').split(prefix).join('{project}')

  t.test('--json', async t => {
    config.json = true
    config.parseable = false
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' })
    result = JSON.parse(result)
    const problems = result.problems.map(cleanupPaths)
    t.matchSnapshot(problems, 'ls --json problems')
  })

  t.test('--parseable', async t => {
    config.json = false
    config.parseable = true
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' })
    t.matchSnapshot(cleanupPaths(result), 'ls --parseable result')
  })

  t.test('human output', async t => {
    config.json = false
    config.parseable = false
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' })
    t.matchSnapshot(cleanupPaths(result), 'ls result')
  })
})

t.test('ls --json', t => {
  t.beforeEach(cleanUpResult)
  config.json = true
  config.parseable = false
  t.test('no args', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: {
            version: '1.0.0',
            dependencies: {
              dog: {
                version: '1.0.0',
              },
            },
          },
          chai: {
            version: '1.0.0',
          },
        },
      },
      'should output json representation of dependencies structure'
    )
  })

  t.test('missing package.json', async t => {
    npm.prefix = t.testdir({
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        problems: [
          /* eslint-disable-next-line max-len */
          'extraneous: chai@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-package.json/node_modules/chai',
          /* eslint-disable-next-line max-len */
          'extraneous: dog@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-package.json/node_modules/dog',
          /* eslint-disable-next-line max-len */
          'extraneous: foo@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-package.json/node_modules/foo',
        ],
        dependencies: {
          dog: {
            version: '1.0.0',
            extraneous: true,
            problems: [
              /* eslint-disable-next-line max-len */
              'extraneous: dog@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-package.json/node_modules/dog',
            ],
          },
          foo: {
            version: '1.0.0',
            extraneous: true,
            problems: [
              /* eslint-disable-next-line max-len */
              'extraneous: foo@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-package.json/node_modules/foo',
            ],
            dependencies: {
              dog: {
                version: '1.0.0',
              },
            },
          },
          chai: {
            version: '1.0.0',
            extraneous: true,
            problems: [
              /* eslint-disable-next-line max-len */
              'extraneous: chai@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-package.json/node_modules/chai',
            ],
          },
        },
      },
      'should output json missing name/version of top-level package'
    )
  })

  t.test('extraneous deps', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        problems: [
          'extraneous: chai@1.0.0 {CWD}/tap-testdir-ls-ls---json-extraneous-deps/node_modules/chai',
        ],
        dependencies: {
          foo: {
            version: '1.0.0',
            dependencies: {
              dog: {
                version: '1.0.0',
              },
            },
          },
          chai: {
            version: '1.0.0',
            extraneous: true,
            problems: [
              /* eslint-disable-next-line max-len */
              'extraneous: chai@1.0.0 {CWD}/tap-testdir-ls-ls---json-extraneous-deps/node_modules/chai',
            ],
          },
        },
      },
      'should output json containing problems info'
    )
  })

  t.test('missing deps --long', async t => {
    t.plan(3)
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          dog: '^1.0.0',
          chai: '^1.0.0',
          ipsum: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })

    await ls.exec([]).catch(err => {
      t.equal(
        redactCwd(err.message),
        'missing: ipsum@^1.0.0, required by test-npm-ls@1.0.0',
        'should log missing dep as error'
      )
      t.equal(err.code, 'ELSPROBLEMS', 'should have ELSPROBLEMS error code')
    })
    t.match(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        problems: ['missing: ipsum@^1.0.0, required by test-npm-ls@1.0.0'],
      },
      'should output json containing problems info'
    )
    config.long = false
  })

  t.test('with filter arg', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['chai'])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          chai: {
            version: '1.0.0',
          },
        },
      },
      'should output json contaning only occurrences of filtered by package'
    )
    t.not(process.exitCode, 1, 'should not exit with error code 1')
  })

  t.test('with filter arg nested dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['dog'])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: {
            version: '1.0.0',
            dependencies: {
              dog: {
                version: '1.0.0',
              },
            },
          },
        },
      },
      'should output json contaning only occurrences of filtered by package'
    )
    t.notOk(jsonParse(result).dependencies.chai)
  })

  t.test('with multiple filter args', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
          ipsum: '^1.0.0',
        },
      }),
      node_modules: {
        ...simpleNmFixture.node_modules,
        ipsum: {
          'package.json': JSON.stringify({
            name: 'ipsum',
            version: '1.0.0',
          }),
        },
      },
    })
    await ls.exec(['dog@*', 'chai@1.0.0'])
    t.same(
      jsonParse(result),
      {
        version: '1.0.0',
        name: 'test-npm-ls',
        dependencies: {
          foo: {
            version: '1.0.0',
            dependencies: {
              dog: {
                version: '1.0.0',
              },
            },
          },
          chai: {
            version: '1.0.0',
          },
        },
      },
      /* eslint-disable-next-line max-len */
      'should output json contaning only occurrences of multiple filtered packages and their ancestors'
    )
  })

  t.test('with missing filter arg', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec(['notadep'])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
      },
      'should output json containing no dependencies info'
    )
    t.equal(process.exitCode, 1, 'should exit with error code 1')
    process.exitCode = 0
  })

  t.test('default --depth value should now be 0', async t => {
    config.all = false
    config.depth = undefined
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: {
            version: '1.0.0',
          },
          chai: {
            version: '1.0.0',
          },
        },
      },
      'should output json containing only top-level dependencies'
    )
    config.all = true
    config.depth = Infinity
  })

  t.test('--depth=0', async t => {
    config.all = false
    config.depth = 0
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: {
            version: '1.0.0',
          },
          chai: {
            version: '1.0.0',
          },
        },
      },
      'should output json containing only top-level dependencies'
    )
    config.all = true
    config.depth = Infinity
  })

  t.test('--depth=1', async t => {
    config.all = false
    config.depth = 1
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^1.0.0',
          chai: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: {
            version: '1.0.0',
            dependencies: {
              dog: {
                version: '1.0.0',
              },
            },
          },
          chai: {
            version: '1.0.0',
          },
        },
      },
      'should output json containing top-level deps and their deps only'
    )
    config.all = true
    config.depth = Infinity
  })

  t.test('missing/invalid/extraneous', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          foo: '^2.0.0',
          ipsum: '^1.0.0',
        },
      }),
      ...simpleNmFixture,
    })
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' }, 'should list dep problems')
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        problems: [
          /* eslint-disable-next-line max-len */
          'extraneous: chai@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-invalid-extraneous/node_modules/chai',
          /* eslint-disable-next-line max-len */
          'invalid: foo@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-invalid-extraneous/node_modules/foo',
          'missing: ipsum@^1.0.0, required by test-npm-ls@1.0.0',
        ],
        dependencies: {
          foo: {
            version: '1.0.0',
            invalid: '"^2.0.0" from the root project',
            problems: [
              /* eslint-disable-next-line max-len */
              'invalid: foo@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-invalid-extraneous/node_modules/foo',
            ],
            dependencies: {
              dog: {
                version: '1.0.0',
              },
            },
          },
          chai: {
            version: '1.0.0',
            extraneous: true,
            problems: [
              /* eslint-disable-next-line max-len */
              'extraneous: chai@1.0.0 {CWD}/tap-testdir-ls-ls---json-missing-invalid-extraneous/node_modules/chai',
            ],
          },
          ipsum: {
            required: '^1.0.0',
            missing: true,
            problems: ['missing: ipsum@^1.0.0, required by test-npm-ls@1.0.0'],
          },
        },
      },
      'should output json containing top-level deps and their deps only'
    )
  })

  t.test('--dev', async t => {
    flatOptions.omit = ['prod', 'optional', 'peer']
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'dev-dep': {
            version: '1.0.0',
            dependencies: {
              foo: {
                version: '1.0.0',
                dependencies: { dog: { version: '1.0.0' } },
              },
            },
          },
        },
      },
      'should output json containing dev deps'
    )
    flatOptions.omit = []
  })

  t.test('--link', async t => {
    config.link = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
          'linked-dep': '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      'linked-dep': {
        'package.json': JSON.stringify({
          name: 'linked-dep',
          version: '1.0.0',
        }),
      },
      node_modules: {
        'linked-dep': t.fixture('symlink', '../linked-dep'),
        ...diffDepTypesNmFixture.node_modules,
      },
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'linked-dep': {
            version: '1.0.0',
            resolved: 'file:../linked-dep',
          },
        },
      },
      'should output json containing linked deps'
    )
    config.link = false
  })

  t.test('--production', async t => {
    flatOptions.omit = ['dev', 'peer']
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          chai: { version: '1.0.0' },
          'optional-dep': { version: '1.0.0' },
          'prod-dep': { version: '1.0.0', dependencies: { dog: { version: '2.0.0' } } },
        },
      },
      'should output json containing production deps'
    )
    flatOptions.omit = []
  })

  t.test('from lockfile', async t => {
    npm.prefix = t.testdir({
      node_modules: {
        '@isaacs': {
          'dedupe-tests-a': {
            'package.json': JSON.stringify({
              name: '@isaacs/dedupe-tests-a',
              version: '1.0.1',
            }),
            node_modules: {
              '@isaacs': {
                'dedupe-tests-b': {
                  name: '@isaacs/dedupe-tests-b',
                  version: '1.0.0',
                },
              },
            },
          },
          'dedupe-tests-b': {
            'package.json': JSON.stringify({
              name: '@isaacs/dedupe-tests-b',
              version: '2.0.0',
            }),
          },
        },
      },
      'package-lock.json': JSON.stringify({
        name: 'dedupe-lockfile',
        version: '1.0.0',
        lockfileVersion: 2,
        requires: true,
        packages: {
          '': {
            name: 'dedupe-lockfile',
            version: '1.0.0',
            dependencies: {
              '@isaacs/dedupe-tests-a': '1.0.1',
              '@isaacs/dedupe-tests-b': '1||2',
            },
          },
          'node_modules/@isaacs/dedupe-tests-a': {
            name: '@isaacs/dedupe-tests-a',
            version: '1.0.1',
            /* eslint-disable-next-line max-len */
            resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-a/-/dedupe-tests-a-1.0.1.tgz',
            /* eslint-disable-next-line max-len */
            integrity: 'sha512-8AN9lNCcBt5Xeje7fMEEpp5K3rgcAzIpTtAjYb/YMUYu8SbIVF6wz0WqACDVKvpQOUcSfNHZQNLNmue0QSwXOQ==',
            dependencies: {
              '@isaacs/dedupe-tests-b': '1',
            },
          },
          'node_modules/@isaacs/dedupe-tests-a/node_modules/@isaacs/dedupe-tests-b': {
            name: '@isaacs/dedupe-tests-b',
            version: '1.0.0',
            /* eslint-disable-next-line max-len */
            resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-1.0.0.tgz',
            /* eslint-disable-next-line max-len */
            integrity: 'sha512-3nmvzIb8QL8OXODzipwoV3U8h9OQD9g9RwOPuSBQqjqSg9JZR1CCFOWNsDUtOfmwY8HFUJV9EAZ124uhqVxq+w==',
          },
          'node_modules/@isaacs/dedupe-tests-b': {
            name: '@isaacs/dedupe-tests-b',
            version: '2.0.0',
            /* eslint-disable-next-line max-len */
            resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-2.0.0.tgz',
            /* eslint-disable-next-line max-len */
            integrity: 'sha512-KTYkpRv9EzlmCg4Gsm/jpclWmRYFCXow8GZKJXjK08sIZBlElTZEa5Bw/UQxIvEfcKmWXczSqItD49Kr8Ax4UA==',
          },
        },
        dependencies: {
          '@isaacs/dedupe-tests-a': {
            version: '1.0.1',
            /* eslint-disable-next-line max-len */
            resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-a/-/dedupe-tests-a-1.0.1.tgz',
            /* eslint-disable-next-line max-len */
            integrity: 'sha512-8AN9lNCcBt5Xeje7fMEEpp5K3rgcAzIpTtAjYb/YMUYu8SbIVF6wz0WqACDVKvpQOUcSfNHZQNLNmue0QSwXOQ==',
            requires: {
              '@isaacs/dedupe-tests-b': '1',
            },
            dependencies: {
              '@isaacs/dedupe-tests-b': {
                version: '1.0.0',
                /* eslint-disable-next-line max-len */
                resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-1.0.0.tgz',
                /* eslint-disable-next-line max-len */
                integrity: 'sha512-3nmvzIb8QL8OXODzipwoV3U8h9OQD9g9RwOPuSBQqjqSg9JZR1CCFOWNsDUtOfmwY8HFUJV9EAZ124uhqVxq+w==',
              },
            },
          },
          '@isaacs/dedupe-tests-b': {
            version: '2.0.0',
            /* eslint-disable-next-line max-len */
            resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-2.0.0.tgz',
            /* eslint-disable-next-line max-len */
            integrity: 'sha512-KTYkpRv9EzlmCg4Gsm/jpclWmRYFCXow8GZKJXjK08sIZBlElTZEa5Bw/UQxIvEfcKmWXczSqItD49Kr8Ax4UA==',
          },
        },
      }),
      'package.json': JSON.stringify({
        name: 'dedupe-lockfile',
        version: '1.0.0',
        dependencies: {
          '@isaacs/dedupe-tests-a': '1.0.1',
          '@isaacs/dedupe-tests-b': '1||2',
        },
      }),
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        version: '1.0.0',
        name: 'dedupe-lockfile',
        dependencies: {
          '@isaacs/dedupe-tests-a': {
            version: '1.0.1',
            resolved:
              'https://registry.npmjs.org/@isaacs/dedupe-tests-a/-/dedupe-tests-a-1.0.1.tgz',
            dependencies: {
              '@isaacs/dedupe-tests-b': {
                resolved:
                  'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-1.0.0.tgz',
                extraneous: true,
                problems: [
                  /* eslint-disable-next-line max-len */
                  'extraneous: @isaacs/dedupe-tests-b@ {CWD}/tap-testdir-ls-ls---json-from-lockfile/node_modules/@isaacs/dedupe-tests-a/node_modules/@isaacs/dedupe-tests-b',
                ],
              },
            },
          },
          '@isaacs/dedupe-tests-b': {
            version: '2.0.0',
            resolved:
              'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-2.0.0.tgz',
          },
        },
        problems: [
          /* eslint-disable-next-line max-len */
          'extraneous: @isaacs/dedupe-tests-b@ {CWD}/tap-testdir-ls-ls---json-from-lockfile/node_modules/@isaacs/dedupe-tests-a/node_modules/@isaacs/dedupe-tests-b',
        ],
      },
      'should output json containing only prod deps'
    )
  })

  t.test('--long', async t => {
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'peer-dep': {
            name: 'peer-dep',
            description: 'Peer-dep description here',
            version: '1.0.0',
            _id: 'peer-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: {},
            path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/peer-dep',
            extraneous: false,
          },
          'dev-dep': {
            name: 'dev-dep',
            description: 'A DEV dep kind of dep',
            version: '1.0.0',
            dependencies: {
              foo: {
                name: 'foo',
                version: '1.0.0',
                dependencies: {
                  dog: {
                    name: 'dog',
                    version: '1.0.0',
                    _id: 'dog@1.0.0',
                    devDependencies: {},
                    peerDependencies: {},
                    _dependencies: {},
                    path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/dog',
                    extraneous: false,
                  },
                },
                _id: 'foo@1.0.0',
                devDependencies: {},
                peerDependencies: {},
                _dependencies: { dog: '^1.0.0' },
                path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/foo',
                extraneous: false,
              },
            },
            _id: 'dev-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: { foo: '^1.0.0' },
            path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/dev-dep',
            extraneous: false,
          },
          chai: {
            name: 'chai',
            version: '1.0.0',
            _id: 'chai@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: {},
            path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/chai',
            extraneous: false,
          },
          'optional-dep': {
            name: 'optional-dep',
            description: 'Maybe a dep?',
            version: '1.0.0',
            _id: 'optional-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: {},
            path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/optional-dep',
            extraneous: false,
          },
          'prod-dep': {
            name: 'prod-dep',
            description: 'A PROD dep kind of dep',
            version: '1.0.0',
            dependencies: {
              dog: {
                name: 'dog',
                description: 'A dep that bars',
                version: '2.0.0',
                _id: 'dog@2.0.0',
                devDependencies: {},
                peerDependencies: {},
                _dependencies: {},
                /* eslint-disable-next-line max-len */
                path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/prod-dep/node_modules/dog',
                extraneous: false,
              },
            },
            _id: 'prod-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: { dog: '^2.0.0' },
            path: '{CWD}/tap-testdir-ls-ls---json---long/node_modules/prod-dep',
            extraneous: false,
          },
        },
        devDependencies: { 'dev-dep': '^1.0.0' },
        optionalDependencies: { 'optional-dep': '^1.0.0' },
        peerDependencies: { 'peer-dep': '^1.0.0' },
        _id: 'test-npm-ls@1.0.0',
        _dependencies: { 'prod-dep': '^1.0.0', chai: '^1.0.0', 'optional-dep': '^1.0.0' },
        path: '{CWD}/tap-testdir-ls-ls---json---long',
        extraneous: false,
      },
      'should output long json info'
    )
    config.long = true
  })

  t.test('--long --depth=0', async t => {
    config.all = false
    config.depth = 0
    config.long = true
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'peer-dep': {
            name: 'peer-dep',
            description: 'Peer-dep description here',
            version: '1.0.0',
            _id: 'peer-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: {},
            path: '{CWD}/tap-testdir-ls-ls---json---long---depth-0/node_modules/peer-dep',
            extraneous: false,
          },
          'dev-dep': {
            name: 'dev-dep',
            description: 'A DEV dep kind of dep',
            version: '1.0.0',
            _id: 'dev-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: { foo: '^1.0.0' },
            path: '{CWD}/tap-testdir-ls-ls---json---long---depth-0/node_modules/dev-dep',
            extraneous: false,
          },
          chai: {
            name: 'chai',
            version: '1.0.0',
            _id: 'chai@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: {},
            path: '{CWD}/tap-testdir-ls-ls---json---long---depth-0/node_modules/chai',
            extraneous: false,
          },
          'optional-dep': {
            name: 'optional-dep',
            description: 'Maybe a dep?',
            version: '1.0.0',
            _id: 'optional-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: {},
            path: '{CWD}/tap-testdir-ls-ls---json---long---depth-0/node_modules/optional-dep',
            extraneous: false,
          },
          'prod-dep': {
            name: 'prod-dep',
            description: 'A PROD dep kind of dep',
            version: '1.0.0',
            _id: 'prod-dep@1.0.0',
            devDependencies: {},
            peerDependencies: {},
            _dependencies: { dog: '^2.0.0' },
            path: '{CWD}/tap-testdir-ls-ls---json---long---depth-0/node_modules/prod-dep',
            extraneous: false,
          },
        },
        devDependencies: { 'dev-dep': '^1.0.0' },
        optionalDependencies: { 'optional-dep': '^1.0.0' },
        peerDependencies: { 'peer-dep': '^1.0.0' },
        _id: 'test-npm-ls@1.0.0',
        _dependencies: { 'prod-dep': '^1.0.0', chai: '^1.0.0', 'optional-dep': '^1.0.0' },
        path: '{CWD}/tap-testdir-ls-ls---json---long---depth-0',
        extraneous: false,
      },
      'should output json containing top-level deps in long format'
    )
    config.all = true
    config.depth = Infinity
    config.long = false
  })

  t.test('json read problems', async t => {
    npm.prefix = t.testdir({
      'package.json': '{broken json',
    })
    await t.rejects(
      ls.exec([]),
      { code: 'EJSONPARSE', message: 'Failed to parse root package.json' },
      'should have missin root package.json msg'
    )
    t.same(
      jsonParse(result),
      {
        invalid: true,
        problems: [
          /* eslint-disable-next-line max-len */
          'error in {CWD}/tap-testdir-ls-ls---json-json-read-problems: Failed to parse root package.json',
        ],
      },
      'should print empty json result'
    )
  })

  t.test('empty location', async t => {
    npm.prefix = t.testdir({})
    await ls.exec([])
    t.same(jsonParse(result), {}, 'should print empty json result')
  })

  t.test('unmet peer dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'optional-dep': '^1.0.0',
        },
        peerDependencies: {
          'peer-dep': '^2.0.0', // mismatching version #
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' }, 'Should have ELSPROBLEMS error code')
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        problems: [
          /* eslint-disable-next-line max-len */
          'invalid: peer-dep@1.0.0 {CWD}/tap-testdir-ls-ls---json-unmet-peer-dep/node_modules/peer-dep',
        ],
        dependencies: {
          'peer-dep': {
            version: '1.0.0',
            invalid: '"^2.0.0" from the root project',
            problems: [
              /* eslint-disable-next-line max-len */
              'invalid: peer-dep@1.0.0 {CWD}/tap-testdir-ls-ls---json-unmet-peer-dep/node_modules/peer-dep',
            ],
          },
          'dev-dep': {
            version: '1.0.0',
            dependencies: {
              foo: {
                version: '1.0.0',
                dependencies: { dog: { version: '1.0.0' } },
              },
            },
          },
          chai: { version: '1.0.0' },
          'optional-dep': { version: '1.0.0' },
          'prod-dep': { version: '1.0.0', dependencies: { dog: { version: '2.0.0' } } },
        },
      },
      'should output json signaling missing peer dep in problems'
    )
  })

  t.test('unmet optional dep', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'prod-dep': '^1.0.0',
          chai: '^1.0.0',
        },
        devDependencies: {
          'dev-dep': '^1.0.0',
        },
        optionalDependencies: {
          'missing-optional-dep': '^1.0.0',
          'optional-dep': '^2.0.0', // mismatching version #
        },
        peerDependencies: {
          'peer-dep': '^1.0.0',
        },
      }),
      ...diffDepTypesNmFixture,
    })
    await t.rejects(
      ls.exec([]),
      { code: 'ELSPROBLEMS', message: /invalid: optional-dep@1.0.0/ },
      'should have invalid dep error msg'
    )
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        problems: [
          /* eslint-disable-next-line max-len */
          'invalid: optional-dep@1.0.0 {CWD}/tap-testdir-ls-ls---json-unmet-optional-dep/node_modules/optional-dep', // mismatching optional deps get flagged in problems
        ],
        dependencies: {
          'optional-dep': {
            version: '1.0.0',
            invalid: '"^2.0.0" from the root project',
            problems: [
              /* eslint-disable-next-line max-len */
              'invalid: optional-dep@1.0.0 {CWD}/tap-testdir-ls-ls---json-unmet-optional-dep/node_modules/optional-dep',
            ],
          },
          'peer-dep': {
            version: '1.0.0',
          },
          'dev-dep': {
            version: '1.0.0',
            dependencies: {
              foo: {
                version: '1.0.0',
                dependencies: { dog: { version: '1.0.0' } },
              },
            },
          },
          chai: { version: '1.0.0' },
          'prod-dep': { version: '1.0.0', dependencies: { dog: { version: '2.0.0' } } },
          'missing-optional-dep': {}, // missing optional dep has an empty entry in json output
        },
      },
      'should output json with empty entry for missing optional deps'
    )
  })

  t.test('cycle deps', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: '^1.0.0',
        },
      }),
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            dependencies: {
              b: '^1.0.0',
            },
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: {
              a: '^1.0.0',
            },
          }),
        },
      },
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: {
            version: '1.0.0',
            dependencies: {
              b: {
                version: '1.0.0',
                dependencies: {
                  a: { version: '1.0.0' },
                },
              },
            },
          },
        },
      },
      'should print json output containing deduped ref'
    )
  })

  t.test('using aliases', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: 'npm:b@1.0.0',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/a': {
              name: 'b',
              version: '1.0.0',
              from: 'a@npm:b',
              resolved: 'https://localhost:8080/abbrev/-/abbrev-1.1.1.tgz',
              requested: {
                type: 'alias',
              },
            },
          },
        }),
        a: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          a: {
            version: '1.0.0',
            resolved: 'https://localhost:8080/abbrev/-/abbrev-1.1.1.tgz',
          },
        },
      },
      'should output json containing aliases'
    )
  })

  t.test('resolved points to git ref', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          abbrev: 'git+https://github.com/isaacs/abbrev-js.git',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/abbrev': {
              name: 'abbrev',
              version: '1.1.1',
              id: 'abbrev@1.1.1',
              from: 'git+https://github.com/isaacs/abbrev-js.git',
              /* eslint-disable-next-line max-len */
              resolved: 'git+https://github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            },
          },
        }),
        abbrev: {
          'package.json': JSON.stringify({
            name: 'abbrev',
            version: '1.1.1',
            _id: 'abbrev@1.1.1',
            _from: 'git+https://github.com/isaacs/abbrev-js.git',
            /* eslint-disable-next-line max-len */
            _resolved: 'git+https://github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            _requested: {
              type: 'git',
              raw: 'git+https:github.com/isaacs/abbrev-js.git',
              rawSpec: 'git+https:github.com/isaacs/abbrev-js.git',
              saveSpec: 'git+https://github.com/isaacs/abbrev-js.git',
              fetchSpec: 'https://github.com/isaacs/abbrev-js.git',
              gitCommittish: null,
            },
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          abbrev: {
            version: '1.1.1',
            /* eslint-disable-next-line max-len */
            resolved: 'git+ssh://git@github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
          },
        },
      },
      'should output json containing git refs'
    )
  })

  t.test('from and resolved properties', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'simple-output': '^2.0.0',
        },
      }),
      node_modules: {
        '.package-lock.json': JSON.stringify({
          packages: {
            'node_modules/simple-output': {
              name: 'simple-output',
              version: '2.1.1',
              _from: 'simple-output',
              _id: 'simple-output@2.1.1',
              _resolved: 'https://registry.npmjs.org/simple-output/-/simple-output-2.1.1.tgz',
              _requested: {
                type: 'tag',
                registry: true,
                raw: 'simple-output',
                name: 'simple-output',
                escapedName: 'simple-output',
                rawSpec: '',
                saveSpec: null,
                fetchSpec: 'latest',
              },
              _requiredBy: ['#USER', '/'],
              _shasum: '3c07708ec9ef3e3c985cf0ddd67df09ab8ec2abc',
              _spec: 'simple-output',
            },
          },
        }),
        'simple-output': {
          'package.json': JSON.stringify({
            name: 'simple-output',
            version: '2.1.1',
            _from: 'simple-output',
            _id: 'simple-output@2.1.1',
            _resolved: 'https://registry.npmjs.org/simple-output/-/simple-output-2.1.1.tgz',
            _requested: {
              type: 'tag',
              registry: true,
              raw: 'simple-output',
              name: 'simple-output',
              escapedName: 'simple-output',
              rawSpec: '',
              saveSpec: null,
              fetchSpec: 'latest',
            },
            _requiredBy: ['#USER', '/'],
            _shasum: '3c07708ec9ef3e3c985cf0ddd67df09ab8ec2abc',
            _spec: 'simple-output',
          }),
        },
      },
    })
    touchHiddenPackageLock(npm.prefix)
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'test-npm-ls',
        version: '1.0.0',
        dependencies: {
          'simple-output': {
            version: '2.1.1',
            resolved: 'https://registry.npmjs.org/simple-output/-/simple-output-2.1.1.tgz',
          },
        },
      },
      'should be printed in json output'
    )
  })

  t.test('node.name fallback if missing root package name', async t => {
    npm.prefix = t.testdir({
      'package.json': JSON.stringify({
        version: '1.0.0',
      }),
    })
    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        version: '1.0.0',
        name: 'tap-testdir-ls-ls---json-node.name-fallback-if-missing-root-package-name',
      },
      'should use node.name as key in json result obj'
    )
  })

  t.test('global', async t => {
    config.global = true
    const fixtures = t.testdir({
      node_modules: {
        a: {
          'package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
          }),
        },
        b: {
          'package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
          }),
          node_modules: {
            c: {
              'package.json': JSON.stringify({
                name: 'c',
                version: '1.0.0',
              }),
            },
          },
        },
      },
    })

    // mimics lib/npm.js globalDir getter but pointing to fixtures
    npm.globalDir = resolve(fixtures, 'node_modules')

    await ls.exec([])
    t.same(
      jsonParse(result),
      {
        name: 'tap-testdir-ls-ls---json-global',
        dependencies: {
          a: {
            version: '1.0.0',
          },
          b: {
            version: '1.0.0',
            dependencies: {
              c: {
                version: '1.0.0',
              },
            },
          },
        },
      },
      'should print json output for global deps'
    )
    npm.globalDir = 'MISSING_GLOBAL_DIR'
    config.global = false
  })

  t.end()
})

t.test('show multiple invalid reasons', async t => {
  config.json = false
  config.all = true
  config.depth = Infinity
  npm.prefix = t.testdir({
    'package.json': JSON.stringify({
      name: 'test-npm-ls',
      version: '1.0.0',
      dependencies: {
        cat: '^2.0.0',
        dog: '^1.2.3',
      },
    }),
    node_modules: {
      cat: {
        'package.json': JSON.stringify({
          name: 'cat',
          version: '1.0.0',
          dependencies: {
            dog: '^2.0.0',
          },
        }),
      },
      dog: {
        'package.json': JSON.stringify({
          name: 'dog',
          version: '1.0.0',
          dependencies: {
            cat: '',
          },
        }),
      },
      chai: {
        'package.json': JSON.stringify({
          name: 'chai',
          version: '1.0.0',
          dependencies: {
            dog: '2.x',
          },
        }),
      },
    },
  })

  const cleanupPaths = str => redactCwd(str).toLowerCase().replace(/\\/g, '/')
  await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' }, 'should list dep problems')
  t.matchSnapshot(cleanupPaths(result), 'ls result')
})

t.test('ls --package-lock-only', t => {
  config['package-lock-only'] = true
  t.test('ls --package-lock-only --json', t => {
    t.beforeEach(cleanUpResult)
    config.json = true
    config.parseable = false
    t.test('no args', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: {
              version: '1.0.0',
              dependencies: {
                dog: {
                  version: '1.0.0',
                },
              },
            },
            chai: {
              version: '1.0.0',
            },
          },
        },
        'should output json representation of dependencies structure'
      )
    })

    t.test('extraneous deps', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: {
              version: '1.0.0',
              dependencies: {
                dog: {
                  version: '1.0.0',
                },
              },
            },
          },
        },
        'should output json containing no problem info'
      )
    })

    t.test('missing deps --long', async t => {
      config.long = true
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            dog: '^1.0.0',
            chai: '^1.0.0',
            ipsum: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
            ipsum: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec([])
      t.match(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
        },
        'should output json containing no problems info'
      )
      config.long = false
    })

    t.test('with filter arg', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
            ipsum: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec(['chai'])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            chai: {
              version: '1.0.0',
            },
          },
        },
        'should output json contaning only occurrences of filtered by package'
      )
      t.equal(process.exitCode, 0, 'should exit with error code 0')
    })

    t.test('with filter arg nested dep', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
            ipsum: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec(['dog'])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: {
              version: '1.0.0',
              dependencies: {
                dog: {
                  version: '1.0.0',
                },
              },
            },
          },
        },
        'should output json contaning only occurrences of filtered by package'
      )
    })

    t.test('with multiple filter args', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
            ipsum: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
            ipsum: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec(['dog@*', 'chai@1.0.0'])
      t.same(
        jsonParse(result),
        {
          version: '1.0.0',
          name: 'test-npm-ls',
          dependencies: {
            foo: {
              version: '1.0.0',
              dependencies: {
                dog: {
                  version: '1.0.0',
                },
              },
            },
            chai: {
              version: '1.0.0',
            },
          },
        },
        /* eslint-disable-next-line max-len */
        'should output json contaning only occurrences of multiple filtered packages and their ancestors'
      )
    })

    t.test('with missing filter arg', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec(['notadep'])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
        },
        'should output json containing no dependencies info'
      )
      t.equal(process.exitCode, 1, 'should exit with error code 1')
      process.exitCode = 0
    })

    t.test('default --depth value should now be 0', async t => {
      config.all = false
      config.depth = undefined
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        },
        'should output json containing only top-level dependencies'
      )
      config.all = true
      config.depth = Infinity
    })

    t.test('--depth=0', async t => {
      config.all = false
      config.depth = 0
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        },
        'should output json containing only top-level dependencies'
      )
      config.all = true
      config.depth = Infinity
    })

    t.test('--depth=1', async t => {
      config.all = false
      config.depth = 1
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^1.0.0',
            chai: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: {
              version: '1.0.0',
              dependencies: {
                dog: {
                  version: '1.0.0',
                },
              },
            },
            chai: {
              version: '1.0.0',
            },
          },
        },
        'should output json containing top-level deps and their deps only'
      )
      config.all = true
      config.depth = Infinity
    })

    t.test('missing/invalid/extraneous', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            foo: '^2.0.0',
            ipsum: '^1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            foo: {
              version: '1.0.0',
              requires: {
                dog: '^1.0.0',
              },
            },
            dog: {
              version: '1.0.0',
            },
            chai: {
              version: '1.0.0',
            },
          },
        }),
      })
      await t.rejects(ls.exec([]), { code: 'ELSPROBLEMS' }, 'should list dep problems')
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          problems: [
            /* eslint-disable-next-line max-len */
            'invalid: foo@1.0.0 {CWD}/tap-testdir-ls-ls---package-lock-only-ls---package-lock-only---json-missing-invalid-extraneous/node_modules/foo',
            'missing: ipsum@^1.0.0, required by test-npm-ls@1.0.0',
          ],
          dependencies: {
            foo: {
              version: '1.0.0',
              invalid: '"^2.0.0" from the root project',
              problems: [
                /* eslint-disable-next-line max-len */
                'invalid: foo@1.0.0 {CWD}/tap-testdir-ls-ls---package-lock-only-ls---package-lock-only---json-missing-invalid-extraneous/node_modules/foo',
              ],
              dependencies: {
                dog: {
                  version: '1.0.0',
                },
              },
            },
            ipsum: {
              required: '^1.0.0',
              missing: true,
              problems: ['missing: ipsum@^1.0.0, required by test-npm-ls@1.0.0'],
            },
          },
        },
        'should output json containing top-level deps and their deps only'
      )
    })

    t.test('from lockfile', async t => {
      npm.prefix = t.testdir({
        'package-lock.json': JSON.stringify({
          name: 'dedupe-lockfile',
          version: '1.0.0',
          lockfileVersion: 2,
          requires: true,
          packages: {
            '': {
              name: 'dedupe-lockfile',
              version: '1.0.0',
              dependencies: {
                '@isaacs/dedupe-tests-a': '1.0.1',
                '@isaacs/dedupe-tests-b': '1||2',
              },
            },
            'node_modules/@isaacs/dedupe-tests-a': {
              name: '@isaacs/dedupe-tests-a',
              version: '1.0.1',
              /* eslint-disable-next-line max-len */
              resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-a/-/dedupe-tests-a-1.0.1.tgz',
              /* eslint-disable-next-line max-len */
              integrity: 'sha512-8AN9lNCcBt5Xeje7fMEEpp5K3rgcAzIpTtAjYb/YMUYu8SbIVF6wz0WqACDVKvpQOUcSfNHZQNLNmue0QSwXOQ==',
              dependencies: {
                '@isaacs/dedupe-tests-b': '1',
              },
            },
            'node_modules/@isaacs/dedupe-tests-a/node_modules/@isaacs/dedupe-tests-b': {
              name: '@isaacs/dedupe-tests-b',
              version: '1.0.0',
              /* eslint-disable-next-line max-len */
              resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-1.0.0.tgz',
              /* eslint-disable-next-line max-len */
              integrity: 'sha512-3nmvzIb8QL8OXODzipwoV3U8h9OQD9g9RwOPuSBQqjqSg9JZR1CCFOWNsDUtOfmwY8HFUJV9EAZ124uhqVxq+w==',
            },
            'node_modules/@isaacs/dedupe-tests-b': {
              name: '@isaacs/dedupe-tests-b',
              version: '2.0.0',
              /* eslint-disable-next-line max-len */
              resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-2.0.0.tgz',
              /* eslint-disable-next-line max-len */
              integrity: 'sha512-KTYkpRv9EzlmCg4Gsm/jpclWmRYFCXow8GZKJXjK08sIZBlElTZEa5Bw/UQxIvEfcKmWXczSqItD49Kr8Ax4UA==',
            },
          },
          dependencies: {
            '@isaacs/dedupe-tests-a': {
              version: '1.0.1',
              /* eslint-disable-next-line max-len */
              resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-a/-/dedupe-tests-a-1.0.1.tgz',
              /* eslint-disable-next-line max-len */
              integrity: 'sha512-8AN9lNCcBt5Xeje7fMEEpp5K3rgcAzIpTtAjYb/YMUYu8SbIVF6wz0WqACDVKvpQOUcSfNHZQNLNmue0QSwXOQ==',
              requires: {
                '@isaacs/dedupe-tests-b': '1',
              },
              dependencies: {
                '@isaacs/dedupe-tests-b': {
                  version: '1.0.0',
                  /* eslint-disable-next-line max-len */
                  resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-1.0.0.tgz',
                  /* eslint-disable-next-line max-len */
                  integrity: 'sha512-3nmvzIb8QL8OXODzipwoV3U8h9OQD9g9RwOPuSBQqjqSg9JZR1CCFOWNsDUtOfmwY8HFUJV9EAZ124uhqVxq+w==',
                },
              },
            },
            '@isaacs/dedupe-tests-b': {
              version: '2.0.0',
              /* eslint-disable-next-line max-len */
              resolved: 'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-2.0.0.tgz',
              /* eslint-disable-next-line max-len */
              integrity: 'sha512-KTYkpRv9EzlmCg4Gsm/jpclWmRYFCXow8GZKJXjK08sIZBlElTZEa5Bw/UQxIvEfcKmWXczSqItD49Kr8Ax4UA==',
            },
          },
        }),
        'package.json': JSON.stringify({
          name: 'dedupe-lockfile',
          version: '1.0.0',
          dependencies: {
            '@isaacs/dedupe-tests-a': '1.0.1',
            '@isaacs/dedupe-tests-b': '1||2',
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          version: '1.0.0',
          name: 'dedupe-lockfile',
          dependencies: {
            '@isaacs/dedupe-tests-a': {
              version: '1.0.1',
              resolved:
                'https://registry.npmjs.org/@isaacs/dedupe-tests-a/-/dedupe-tests-a-1.0.1.tgz',
              dependencies: {
                '@isaacs/dedupe-tests-b': {
                  version: '1.0.0',
                  resolved:
                    'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-1.0.0.tgz',
                },
              },
            },
            '@isaacs/dedupe-tests-b': {
              version: '2.0.0',
              resolved:
                'https://registry.npmjs.org/@isaacs/dedupe-tests-b/-/dedupe-tests-b-2.0.0.tgz',
            },
          },
        },
        'should output json containing only prod deps'
      )
    })

    t.test('using aliases', async t => {
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            a: 'npm:b@1.0.0',
          },
        }),
        'package-lock.json': JSON.stringify({
          dependencies: {
            a: {
              version: 'npm:b@1.0.0',
              resolved: 'https://localhost:8080/abbrev/-/abbrev-1.0.0.tgz',
            },
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            a: {
              version: '1.0.0',
              resolved: 'https://localhost:8080/abbrev/-/abbrev-1.0.0.tgz',
            },
          },
        },
        'should output json containing aliases'
      )
    })

    t.test('resolved points to git ref', async t => {
      config.long = false
      npm.prefix = t.testdir({
        'package.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            abbrev: 'git+https://github.com/isaacs/abbrev-js.git',
          },
        }),
        'package-lock.json': JSON.stringify({
          name: 'test-npm-ls',
          version: '1.0.0',
          lockfileVersion: 2,
          requires: true,
          dependencies: {
            abbrev: {
              /* eslint-disable-next-line max-len */
              version: 'git+ssh://git@github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
              from: 'abbrev@git+https://github.com/isaacs/abbrev-js.git',
            },
          },
        }),
      })
      await ls.exec([])
      t.same(
        jsonParse(result),
        {
          name: 'test-npm-ls',
          version: '1.0.0',
          dependencies: {
            abbrev: {
              /* eslint-disable-next-line max-len */
              resolved: 'git+ssh://git@github.com/isaacs/abbrev-js.git#b8f3a2fc0c3bb8ffd8b0d0072cc6b5a3667e963c',
            },
          },
        },
        'should output json containing git refs'
      )
    })

    t.end()
  })

  t.end()
})
