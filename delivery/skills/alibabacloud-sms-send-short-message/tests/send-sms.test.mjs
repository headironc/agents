import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const script = path.join(root, 'skills/alibabacloud-sms-send-short-message/scripts/send_sms.sh')
const send = ['send', '-p', '13800138000', '-s', 'Fixture', '-t', 'SMS_123456']

function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agents sms test '))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const bin = path.join(directory, 'bin')
  mkdirSync(bin)
  symlinkSync('/bin/cat', path.join(bin, 'cat'))
  if (!options.missingJq) symlinkSync(execFileSync('which', ['jq'], { encoding: 'utf8' }).trim(), path.join(bin, 'jq'))
  const calls = path.join(directory, 'calls')
  if (!options.missingCli) writeFileSync(path.join(bin, 'aliyun'), `#!/bin/bash
printf '%s\\n' "$*" >> "$SMS_TEST_CALLS"
if [ "$1" = dysmsapi ] && [ "$SMS_TEST_NOISE" = yes ]; then printf 'fixture-secret warning\\n' >&2; fi
if [ "$2" = "$SMS_TEST_QUERY_FAILURE" ]; then printf 'fixture-secret read failure' >&2; exit 24; fi
if [ "$2" = "$SMS_TEST_ERROR_OPERATION" ]; then
  printf '%s' "$SMS_TEST_ERROR_STDOUT"
  printf '%s' "$SMS_TEST_ERROR_STDERR" >&2
  exit 23
fi
if [ "$1" = dysmsapi ] && [ -n "$SMS_TEST_RESPONSE" ]; then printf '%s' "$SMS_TEST_RESPONSE"; exit 0; fi
case "$1 $2" in
  'plugin list')
    if [ "$SMS_TEST_PLUGIN" = present ]; then printf '%s\\n' "$SMS_TEST_PLUGIN_LINE"; fi ;;
  'configure get')
    if [ "$SMS_TEST_CREDENTIALS" = present ]; then printf 'access_key_id = fixture\\n'; fi ;;
  'dysmsapi get-sms-sign'|'dysmsapi get-sms-template')
    if [ "$SMS_TEST_VERIFICATION" = business ]; then printf '{"Code":"Denied","SignStatus":1,"TemplateStatus":1}'; exit 0; fi
    if [ "$2" = "$SMS_TEST_FAILURE" ]; then
      printf '%s\\n' '{"Code":"Forbidden.RAM","RequestId":"12345678-abcd-1234-abcd-123456789abc","Message":"private fixture diagnostic","AccessKeySecret":"fixture-secret"}' >&2
      exit 23
    fi
    if [ "$2" = get-sms-sign ]; then printf '{"Code":"OK","SignStatus": %s}\\n' "$SMS_TEST_APPROVED";
    else printf '{"Code":"OK","TemplateStatus": %s}\\n' "$SMS_TEST_TEMPLATE_APPROVED"; fi ;;
  'dysmsapi send-sms')
    if [ "$SMS_TEST_SEND_MODE" = timeout ]; then printf 'fixture-secret timeout' >&2; exit 28; fi
    if [ "$SMS_TEST_SEND_MODE" = business ]; then printf '{"Code":"isv.BUSINESS_LIMIT_CONTROL"}\\n'; exit 0; fi
    if [ "$SMS_TEST_SEND_MODE" = malformed ]; then printf 'not-json'; exit 0; fi
    if [ "$SMS_TEST_SEND_MODE" = multiple ]; then printf '{"Code":"Denied"} {"Code":"OK","BizId":"fixture"}'; exit 0; fi
    if [ "$SMS_TEST_SEND_MODE" = missing-biz ]; then printf '{"Code":"OK"}'; exit 0; fi
    printf '{"Code":"OK","BizId":"fixture"}\\n' ;;
  'dysmsapi query-sms-sign-list'|'dysmsapi query-sms-template-list'|'dysmsapi query-send-details'|'dysmsapi query-send-statistics') printf '{"Code":"OK"}\\n' ;;
  *) printf 'Unexpected mock CLI call\\n' >&2; exit 91 ;;
esac
`, { mode: 0o755 })
  const env = {}
  Object.assign(env, {
    PATH: options.missingCli || options.missingJq ? bin : `${bin}:/usr/bin:/bin`,
    HOME: directory,
    SMS_TEST_CALLS: calls,
    SMS_TEST_PLUGIN: options.missingPlugin ? 'absent' : 'present',
    SMS_TEST_PLUGIN_LINE: options.pluginLine ?? 'aliyun-cli-dysmsapi 0.0.2 SMS plugin',
    SMS_TEST_CREDENTIALS: options.missingCredentials ? 'absent' : 'present',
    SMS_TEST_NOISE: options.noise ? 'yes' : '',
    SMS_TEST_QUERY_FAILURE: options.queryFailure ?? '',
    SMS_TEST_ERROR_OPERATION: options.errorOperation ?? '',
    SMS_TEST_ERROR_STDOUT: options.errorStdout ?? '',
    SMS_TEST_ERROR_STDERR: options.errorStderr ?? '',
    SMS_TEST_FAILURE: options.failure ?? '',
    SMS_TEST_VERIFICATION: options.verification ?? '',
    SMS_TEST_SEND_MODE: options.sendMode ?? '',
    SMS_TEST_RESPONSE: options.response ?? '',
    SMS_TEST_APPROVED: options.approvalStatus ?? (options.unapproved ? '0' : '1'),
    SMS_TEST_TEMPLATE_APPROVED: options.templateApprovalStatus ?? options.approvalStatus ?? (options.unapproved ? '0' : '1'),
  })
  return args => {
    const result = spawnSync('/bin/bash', [script, ...args], { env, encoding: 'utf8', timeout: 10_000 })
    assert.ifError(result.error)
    return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] }
  }
}

for (const args of [[], ['-h'], ['--help'], ['help'], ['send', '--help'], ['query-sign', '--help']]) {
  test(`help ${JSON.stringify(args)} works without CLI or credentials`, t => {
    const result = fixture(t, { missingCli: true })(args)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage:/)
    assert.deepEqual(result.calls, [])
  })
}

test('query help lists its supported short options and single-recipient requirement', t => {
  const result = fixture(t, { missingCli: true })(['--help'])
  assert.equal(result.status, 0, result.stderr)
  const queryHelp = result.stdout.split('Query options:')[1]?.split('Statistics options')[0]
  assert.equal(typeof queryHelp, 'string')
  assert.match(queryHelp, /-s, --sign-name\s+Signature name \(required for query-sign\)/)
  assert.match(queryHelp, /-t, --template-code\s+Template code \(required for query-template\)/)
  assert.match(queryHelp, /-p, --phone-numbers\s+One phone number \(required for query-status\)/)
  assert.deepEqual(result.calls, [])
})

for (const command of ['send', 'list-signs', 'list-templates', 'query-sign', 'query-template', 'query-status', 'query-statistics']) {
  test(`${command} identifies a trailing unknown option before any CLI call`, t => {
    const result = fixture(t)([command, '--unknown'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /unknown option or unexpected argument/)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.calls, [])
  })
  test(`${command} rejects unknown arguments before any CLI call`, t => {
    const result = fixture(t)([command, '--unknown', 'value'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /unknown option or unexpected argument/)
    assert.deepEqual(result.calls, [])
  })
  test(`${command} rejects an option without a value before any CLI call`, t => {
    const result = fixture(t)([command, '--profile'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /missing value for --profile/)
    assert.deepEqual(result.calls, [])
  })
}

test('a misspelled verification flag cannot reach the sending API', t => {
  const result = fixture(t)([...send, '--verfiy'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown option or unexpected argument/)
  assert.equal(result.stdout, '')
  assert.deepEqual(result.calls, [])
})

test('another option cannot be consumed as a missing option value', t => {
  const result = fixture(t)([...send, '--template-param', '--verify'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /missing value for --template-param/)
  assert.deepEqual(result.calls, [])
})

test('redirected validation diagnostics are plain text and preserve rejection', t => {
  const result = fixture(t)(['send', '-p', 'invalid', '-s', 'Fixture', '-t', 'SMS_123456'])
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /invalid phone number format/)
  assert.doesNotMatch(result.stderr, /\u001b/)
  assert.deepEqual(result.calls, [])
})

test('redirected send progress is plain text and preserves the JSON response', t => {
  const result = fixture(t)(send)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).BizId, 'fixture')
  assert.ok(result.stderr.length > 0)
  assert.doesNotMatch(result.stderr, /\u001b/)
  assert.equal(result.calls.filter(call => call.startsWith('dysmsapi send-sms ')).length, 1)
})

test('a missing plugin is reported without installing or invoking that plugin', t => {
  const result = fixture(t, { missingPlugin: true })(send)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /After installation approval/)
  assert.equal(result.calls.length, 1)
  assert.match(result.calls[0], /^plugin list$/)
})

for (const pluginLine of ['dysmsapi', 'aliyun-cli-dysmsapi', '  dysmsapi', 'dysmsapi 0.0.2', 'aliyun-cli-dysmsapi\t0.0.2']) {
  test(`plugin listing ${JSON.stringify(pluginLine)} permits a query`, t => {
    const result = fixture(t, { pluginLine })(['list-signs'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.calls.at(-1), /^dysmsapi query-sms-sign-list /)
  })
}

for (const pluginLine of ['dysmsapi-other', 'aliyun-cli-dysmsapi-other 0.0.2', 'other-dysmsapi', 'description dysmsapi']) {
  test(`plugin listing ${JSON.stringify(pluginLine)} cannot substitute for the required plugin`, t => {
    const result = fixture(t, { pluginLine })(['list-signs'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /plugin is not installed/)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.calls, ['plugin list'])
  })
}

test('an existing selected role profile is forwarded without dumping configuration', t => {
  const result = fixture(t, { missingCredentials: true })([...send, '--profile', 'selected-role']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.every(call => !call.startsWith('configure ')));
  assert.match(result.calls.at(-1), /--profile selected-role/);
});

for (const operation of ['get-sms-sign', 'get-sms-template']) {
  test(`${operation} failure preserves its status and bounded diagnostics without sending`, t => {
    const result = fixture(t, { failure: operation })([...send, '--verify'])
    assert.equal(result.status, 23)
    assert.match(result.stderr, /CLI exit 23/)
    assert.match(result.stderr, /no send was attempted/)
    assert.doesNotMatch(result.stderr, /reconcile|Do not resend/)
    assert.match(result.stderr, /Code: Forbidden\.RAM/)
    assert.match(result.stderr, /RequestId: 12345678-abcd-1234-abcd-123456789abc/)
    assert.doesNotMatch(result.stdout + result.stderr, /private fixture diagnostic|fixture-secret/)
    assert.ok(result.calls.every(call => !call.startsWith('dysmsapi send-sms ')))
  })
}

const firstError = '{"Code":"Denied","RequestId":"12345678-abcd-1234-abcd-123456789abc"}'
const laterError = '{"Code":"LaterDenied","RequestId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}'
for (const [name, errorStdout, errorStderr, hasFields] of [
  ['multiple lines', '', `fixture-secret\n${firstError}\n${laterError}`, true],
  ['same-line matches', '', `${firstError} ${laterError} fixture-secret`, true],
  ['both output streams', firstError, `${laterError}\nfixture-secret`, true],
  ['unbounded fields', '', JSON.stringify({ Code: 'A'.repeat(81), RequestId: 'a'.repeat(65), Message: 'fixture-secret' }), false],
]) {
  for (const [operation, args] of [
    ['send-sms', send],
    ['query-sms-sign-list', ['list-signs']],
    ['get-sms-sign', [...send, '--verify']],
  ]) {
    test(`${operation} failure with ${name} reports at most one labeled value per field`, t => {
      const result = fixture(t, { errorOperation: operation, errorStdout, errorStderr })(args)
      assert.equal(result.status, 23)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /CLI exit 23/)
      assert.doesNotMatch(result.stderr, /service rejected/)
      assert.deepEqual(result.stderr.match(/^Code: .*$/gm) ?? [], hasFields ? ['Code: Denied'] : [])
      assert.deepEqual(result.stderr.match(/^RequestId: .*$/gm) ?? [], hasFields ? ['RequestId: 12345678-abcd-1234-abcd-123456789abc'] : [])
      assert.doesNotMatch(result.stderr, /LaterDenied|aaaaaaaa|fixture-secret|A{81}/)
      assert.equal(result.calls.filter(call => call.startsWith(`dysmsapi ${operation} `)).length, 1)
      if (operation === 'send-sms') assert.match(result.stderr, /Do not resend/)
      else {
        assert.ok(result.calls.every(call => !call.startsWith('dysmsapi send-sms ')))
        assert.doesNotMatch(result.stderr, /Do not resend|reconcile/)
        assert.match(result.stderr, operation === 'get-sms-sign' ? /no send was attempted/ : /Read-only query failed/)
      }
    })
  }
}

for (const [subject, options, expectedQueries] of [
  ['Signature', { approvalStatus: '0' }, ['get-sms-sign']],
  ['Template', { templateApprovalStatus: '0' }, ['get-sms-sign', 'get-sms-template']],
]) {
  test(`an unapproved ${subject.toLowerCase()} reports its approval state without claiming a CLI failure`, t => {
    const result = fixture(t, options)([...send, '--verify'])
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes(`${subject} verification failed: not approved (status: 0).`))
    assert.match(result.stderr, /no send was attempted/)
    assert.doesNotMatch(result.stderr, /CLI exit|Code: OK|Do not resend|reconcile/)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.calls.filter(call => call.startsWith('dysmsapi ')).map(call => call.split(' ')[1]), expectedQueries)
  })
}

for (const options of [{ verification: 'business' }, { approvalStatus: '10' }]) {
  test(`unsuccessful verification ${JSON.stringify(options)} never sends`, t => {
    const result = fixture(t, options)([...send, '--verify']);
    assert.notEqual(result.status, 0);
    assert.ok(result.calls.every(call => !call.startsWith('dysmsapi send-sms ')));
  });
}

test('approved signature and template lead to exactly one send with literal parameters', t => {
  const result = fixture(t)([...send, '--template-param', '{"code":"123456"}', '--verify'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.calls.map(call => call.split(' ').slice(0, 2).join(' ')), [
    'plugin list', 'dysmsapi get-sms-sign', 'dysmsapi get-sms-template', 'dysmsapi send-sms',
  ])
  assert.match(result.calls.at(-1), /--template-param \{"code":"123456"\}/)
  assert.match(result.stdout, /"BizId":"fixture"/)
})

test('a query performs read-only prerequisites and exactly one query', t => {
  const result = fixture(t)(['list-signs'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.calls.map(call => call.split(' ').slice(0, 2).join(' ')), [
    'plugin list', 'dysmsapi query-sms-sign-list',
  ])
})

for (const mode of ['timeout', 'business', 'malformed', 'multiple', 'missing-biz']) {
  test(`a ${mode} send result fails without a second send or secret output`, t => {
    const result = fixture(t, { sendMode: mode })(send);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.filter(call => call.startsWith('dysmsapi send-sms ')).length, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
    assert.match(result.stderr, /Do not resend/);
  });
}

for (const [name, response] of [
  ['malformed JSON', 'fixture-secret {"Code":"OK"'],
  ['multiple objects', '{"Code":"Denied"} {"Code":"OK","BizId":"fixture"}'],
  ['array', '[{"Code":"OK"}]'],
  ['scalar', 'null'],
  ['missing code', '{"Message":"fixture-secret"}'],
  ['non-string code', '{"Code":{"Code":"OK"}}'],
]) {
  for (const [command, args] of [['send', send], ['list-signs', ['list-signs']]]) {
    test(`${command} rejects ${name} without reporting untrusted diagnostic fields`, t => {
      const result = fixture(t, { response, noise: true })(args)
      assert.equal(result.status, 1)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /invalid response; expected one JSON object with a string Code/)
      assert.doesNotMatch(result.stderr, /CLI exit|Code:|RequestId:|fixture-secret/)
      assert.equal(result.calls.filter(call => call.startsWith('dysmsapi ')).length, 1)
      if (command === 'send') assert.match(result.stderr, /Do not resend/)
      else {
        assert.match(result.stderr, /Read-only query failed/)
        assert.doesNotMatch(result.stderr, /Do not resend|reconcile/)
        assert.ok(result.calls.every(call => !call.startsWith('dysmsapi send-sms ')))
      }
    })
  }
}

for (const [operation, args] of [
  ['send-sms', send],
  ['query-sms-sign-list', ['list-signs']],
  ['get-sms-sign', [...send, '--verify']],
]) {
  test(`${operation} business rejection distinguishes service failure and keeps bounded fields`, t => {
    const response = JSON.stringify({
      Code: 'isv.BUSINESS_LIMIT_CONTROL',
      RequestId: '12345678-abcd-1234-abcd-123456789abc',
      Message: 'fixture-secret',
      Details: { Code: 'OK', RequestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    })
    const result = fixture(t, { response, noise: true })(args)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.stderr.match(/^Error: service rejected .*$/gm), [`Error: service rejected the ${operation} request.`])
    assert.match(result.stderr, /Code: isv\.BUSINESS_LIMIT_CONTROL/)
    assert.match(result.stderr, /RequestId: 12345678-abcd-1234-abcd-123456789abc/)
    assert.doesNotMatch(result.stderr, /CLI exit|invalid response|Code: OK|aaaaaaaa|fixture-secret/)
    assert.equal(result.calls.filter(call => call.startsWith('dysmsapi ')).length, 1)
    assert.ok(result.calls.some(call => call.startsWith(`dysmsapi ${operation} `)))
    if (operation === 'send-sms') assert.match(result.stderr, /Do not resend/)
    else {
      assert.ok(result.calls.every(call => !call.startsWith('dysmsapi send-sms ')))
      assert.doesNotMatch(result.stderr, /Do not resend|reconcile/)
      assert.match(result.stderr, operation === 'get-sms-sign' ? /no send was attempted/ : /Read-only query failed/)
    }
  })
}

test('a non-string request ID cannot override a business rejection diagnostic', t => {
  const response = JSON.stringify({ Code: 'Denied', RequestId: { Code: 'OK' } })
  const result = fixture(t, { response })(send)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Code: Denied/)
  assert.doesNotMatch(result.stderr, /Code: OK|RequestId:/)
  assert.match(result.stderr, /Do not resend/)
  assert.equal(result.calls.filter(call => call.startsWith('dysmsapi send-sms ')).length, 1)
})

for (const value of ['not-json', '[]', '{"code":123}', '{} {}']) {
  test(`invalid template JSON ${value} never reaches CLI`, t => {
    const result = fixture(t)([...send, '--template-param', value]);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });
}

for (const args of [
  ['query-status', '-p', '13800138000'],
  ['query-status', '-p', '13800138000,13900139000', '--send-date', '20260915'],
  ['query-statistics', '--start-date', '20260901', '--end-date', '20260915', '--page-index', '0'],
  ['query-statistics', '--start-date', '20260901', '--end-date', '20260915', '--page-size', '51'],
]) {
  test(`query identity or pagination error ${args.join(' ')} performs no CLI call`, t => {
    const result = fixture(t)(args);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });
}

for (const [args, operation] of [
  [['list-templates'], 'query-sms-template-list'],
  [['query-sign', '-s', 'Fixture'], 'get-sms-sign'],
  [['query-template', '-t', 'SMS_123456'], 'get-sms-template'],
  [['query-status', '-p', '13800138000', '--send-date', '20260915', '--biz-id', 'fixture^0'], 'query-send-details'],
  [['query-statistics', '--start-date', '20260901', '--end-date', '20260915', '--page-index', '2', '--page-size', '50'], 'query-send-statistics'],
]) {
  test(`${operation} keeps the selected target and does not send`, t => {
    const result = fixture(t)([...args, '--profile', 'selected', '--region', 'cn-shanghai']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.filter(call => call.startsWith('dysmsapi ')).length, 1);
    assert.match(result.calls.at(-1), new RegExp('^dysmsapi ' + operation + ' '));
    assert.match(result.calls.at(-1), /--profile selected/);
    assert.match(result.calls.at(-1), /--region cn-shanghai/);
    assert.match(result.calls.at(-1), /--api-version 2017-05-25/);
    assert.match(result.calls.at(-1), /--read-timeout 3/);
    assert.match(result.calls.at(-1), /--user-agent AlibabaCloud-Agent-Skills\/alibabacloud-sms-send-short-message/);
  });
}

for (const args of [[...send, '--verify'], ['list-signs']]) {
  test(`stderr warnings preserve valid JSON for ${args[0]}`, t => {
    const result = fixture(t, { noise: true })(args);
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.Code, 'OK');
    if (args[0] === 'send') assert.equal(response.BizId, 'fixture');
    assert.equal(result.calls.filter(call => call.startsWith('dysmsapi send-sms ')).length, args[0] === 'send' ? 1 : 0);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
  });
}

test('failed read query preserves status without inventing an uncertain send', t => {
  const result = fixture(t, { queryFailure: 'query-sms-sign-list' })(['list-signs']);
  assert.equal(result.status, 24);
  assert.match(result.stderr, /Read-only query failed/);
  assert.doesNotMatch(result.stderr, /reconcile|Do not resend|verification failed/);
  assert.ok(result.calls.every(call => !call.startsWith('dysmsapi send-sms ')));
});

test('missing jq is a dependency error before template validation or CLI calls', t => {
  const result = fixture(t, { missingJq: true })([...send, '--template-param', '{"code":"123"}']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /jq is required/);
  assert.doesNotMatch(result.stderr, /parameters must/);
  assert.deepEqual(result.calls, []);
});

for (const character of ["$", "`", "\\", "\"", "'", ";", "&", "|", ">", "<", "(", ")", "{", "}", "[", "]", "!", "#", "*", "?"]) {
  test(`forbidden character ${JSON.stringify(character)} is rejected before every affected CLI operation`, t => {
    const value = `A${character}B`;
    const run = fixture(t);
    for (const args of [
      ['query-sign', '--sign-name', value],
      ['send', '-p', '13800138000', '-s', value, '-t', 'SMS_123456'],
      [...send, '--out-id', value],
      ['query-status', '-p', '13800138000', '--send-date', '20260915', '--biz-id', value],
    ]) {
      const result = run(args);
      assert.notEqual(result.status, 0, JSON.stringify(args));
      assert.match(result.stderr, /contains illegal characters/);
      assert.equal(result.stdout, '');
      assert.deepEqual(result.calls, []);
    }
  });
}

test('valid signature and tracking ID preserve literal nonforbidden characters', t => {
  const result = fixture(t)(['send', '-p', '13800138000', '-s', '测试签名_2026', '-t', 'SMS_123456', '--out-id', 'fixture^0-1.2']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls.at(-1), /--sign-name 测试签名_2026/);
  assert.match(result.calls.at(-1), /--out-id fixture\^0-1\.2/);
  assert.equal(JSON.parse(result.stdout).Code, 'OK');
});

test('statistics help documents its signature filter and the filter reaches the CLI', t => {
  const help = fixture(t, { missingCli: true })(['query-statistics', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Statistics options \(query-statistics\):[\s\S]*-s, --sign-name[^\n]*signature/);
  assert.deepEqual(help.calls, []);
  const result = fixture(t)(['query-statistics', '--start-date', '20260901', '--end-date', '20260915', '-s', 'Fixture']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls.at(-1), /--sign-name Fixture/);
});

test('pagination rejection reports the actual numeric ranges before any CLI call', t => {
  const run = fixture(t);
  for (const [option, value] of [['--page-index', '0'], ['--page-index', '1000000000'], ['--page-size', '51']]) {
    const result = run(['query-statistics', '--start-date', '20260901', '--end-date', '20260915', option, value]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--page-index must be an integer from 1 to 999999999; --page-size must be an integer from 1 to 50/);
    assert.equal(result.stdout, '');
    assert.deepEqual(result.calls, []);
  }
});

test('an unknown command writes all diagnostics to stderr without a CLI call', t => {
  const result = fixture(t)(['unknown-command']);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unknown command/);
  assert.match(result.stderr, /--help.*usage information/);
  assert.deepEqual(result.calls, []);
});

for (const [scenario, value] of [
  ['extra phone number', '13900139000'],
  ['message content', 'fixture private message'],
  ['equals-form option', '--sign-name=fixture-private'],
  ['control characters', 'fixture\u001b[31m\nprivate'],
  ['long token', 'fixture-private'.repeat(1000)],
]) {
  test(`rejected ${scenario} stays out of argument and command diagnostics`, t => {
    const run = fixture(t)
    for (const [args, status] of [
      [[...send, value], 2],
      [[value], 1],
    ]) {
      const result = run(args)
      assert.equal(result.status, status)
      assert.equal(result.stdout, '')
      assert.doesNotMatch(result.stderr, /13900139000|fixture|private|\u001b/)
      assert.ok(result.stderr.length < 120)
      assert.match(result.stderr, /--help.*usage information/)
      assert.deepEqual(result.calls, [])
    }
  })
}
