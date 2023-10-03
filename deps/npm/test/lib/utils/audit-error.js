const t = require('tap')
const mockLogs = require('../../fixtures/mock-logs')
const mockNpm = require('../../fixtures/mock-npm')
const tmock = require('../../fixtures/tmock')

const auditError = async (t, { command, error, ...config } = {}) => {
  const { logs, logMocks } = mockLogs()
  const mockAuditError = tmock(t, '{LIB}/utils/audit-error', logMocks)

  const mock = await mockNpm(t, {
    command,
    config,
  })

  const res = {}
  try {
    res.result = mockAuditError(mock.npm, error ? { error } : {})
  } catch (err) {
    res.error = err
  }

  return {
    ...res,
    logs: logs.warn.filter((l) => l[0] === 'audit'),
    output: mock.joinedOutput(),
  }
}

t.test('no error, not audit command', async t => {
  const { result, error, logs, output } = await auditError(t, { command: 'install' })

  t.equal(result, false, 'no error')
  t.notOk(error, 'no error')

  t.strictSame(output, '', 'no output')
  t.strictSame(logs, [], 'no warnings')
})

t.test('error, not audit command', async t => {
  const { result, error, logs, output } = await auditError(t, {
    command: 'install',
    error: {
      message: 'message',
      body: Buffer.from('body'),
      method: 'POST',
      uri: 'https://example.com/not/a/registry',
      headers: {
        head: ['ers'],
      },
      statusCode: '420',
    },
  })

  t.equal(result, true, 'had error')
  t.notOk(error, 'no error')
  t.strictSame(output, '', 'no output')
  t.strictSame(logs, [], 'no warnings')
})

t.test('error, audit command, not json', async t => {
  const { result, error, logs, output } = await auditError(t, {
    command: 'audit',
    error: {
      message: 'message',
      body: Buffer.from('body'),
      method: 'POST',
      uri: 'https://example.com/not/a/registry',
      headers: {
        head: ['ers'],
      },
      statusCode: '420',
    },
  })

  t.equal(result, undefined)

  t.ok(error, 'throws error')
  t.strictSame(output, 'body', 'some output')
  t.strictSame(logs, [['audit', 'message']], 'some warnings')
})

t.test('error, audit command, json', async t => {
  const { result, error, logs, output } = await auditError(t, {
    json: true,
    command: 'audit',
    error: {
      message: 'message',
      body: { response: 'body' },
      method: 'POST',
      uri: 'https://username:password@example.com/not/a/registry',
      headers: {
        head: ['ers'],
      },
      statusCode: '420',
    },
  })

  t.equal(result, undefined)
  t.ok(error, 'throws error')
  t.strictSame(output,
    '{\n' +
      '  "message": "message",\n' +
      '  "method": "POST",\n' +
      '  "uri": "https://username:***@example.com/not/a/registry",\n' +
      '  "headers": {\n' +
      '    "head": [\n' +
      '      "ers"\n' +
      '    ]\n' +
      '  },\n' +
      '  "statusCode": "420",\n' +
      '  "body": {\n' +
      '    "response": "body"\n' +
      '  }\n' +
      '}'
    , 'some output')
  t.strictSame(logs, [['audit', 'message']], 'some warnings')
})
