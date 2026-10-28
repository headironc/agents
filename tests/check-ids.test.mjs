import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts/check-ids.mjs')

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agents ids '))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const put = (relative, rows) => {
    const file = path.join(directory, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${['| ID | 说明 |', '| --- | --- |', ...rows].join('\n')}\n`)
    return relative
  }
  const raw = (relative, body) => {
    writeFileSync(path.join(directory, relative), body.endsWith('\n') ? body : `${body}\n`)
    return relative
  }
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8', timeout: 20_000 })
    assert.ifError(result.error)
    return { ...result, json: () => JSON.parse(result.stdout) }
  }
  return { directory, put, raw, run }
}

test('accepts ascending numbers and the gaps between them', t => {
  const f = fixture(t)
  // A retired row leaves a hole. The order is the property, not the absence of holes.
  f.put('ok.md', ['| A-01 | 一 |', '| A-03 | 三 |', '| B-01 | 乙一 |', '| A-04 | 四 |', '| B-02 | 乙二 |'])
  const result = f.run('ok.md')
  assert.equal(result.status, 0, result.stdout)
  assert.match(result.stdout, /1 files, 0 errors/)
})

test('refuses a number that moves backwards and names the row it passed', t => {
  const f = fixture(t)
  f.put('back.md', ['| A-05 | 五 |', '| A-02 | 二 |'])
  const result = f.run('back.md')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /back\.md:4: error: identifier-order: A-02 follows A-05 at line 3/)
})

test('reports a repeated identifier once, not twice', t => {
  const f = fixture(t)
  // Equal numbers are the same identifier, so the ordering rule stays quiet and leaves one finding.
  f.put('twice.md', ['| B-01 | 一 |', '| B-02 | 二 |', '| B-02 | 又一个二 |'])
  const result = f.run('twice.md')
  assert.equal(result.status, 1)
  const lines = result.stdout.trim().split('\n')
  assert.equal(lines.length, 2, 'one finding and the summary')
  assert.match(lines[0], /duplicate-identifier: B-02 is already used at line 4/)
})

test('counts only a real table row', t => {
  const f = fixture(t)
  // A fenced block holds code, and a pipe outside a table is ordinary text. Either would report if
  // the rows were read line by line, because both move the numbering backwards.
  f.raw('quiet.md', [
    '| ID | 说明 |', '| --- | --- |', '| A-05 | 五 |', '',
    '```', '| A-01 | 代码块里 |', '```', '',
    '正文里的 | A-02 | 不是一行表格'
  ].join('\n'))
  assert.equal(f.run('quiet.md').status, 0, 'neither line is a table row')
})

test('reads the first cell through the markup a reader does not see', t => {
  const f = fixture(t)
  f.put('markup.md', ['| `C-05` | 代码跨度 |', '| **C-02** | 加粗 |'])
  const result = f.run('markup.md')
  assert.equal(result.status, 1, 'the identifier is the same either way')
  assert.match(result.stdout, /C-02 follows C-05/)
})

test('takes another identifier shape from the pattern', t => {
  const f = fixture(t)
  f.put('custom.md', ['| REQ 5 | 五 |', '| REQ 2 | 二 |'])
  assert.equal(f.run('custom.md').status, 0, 'the default shape does not match these')
  const result = f.run('custom.md', '--pattern', '^([A-Z]+) (\\d+)$')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /REQ 2 follows REQ 5/)
})

test('refuses a pattern whose number group captures nothing', t => {
  const f = fixture(t)
  // A non-capturing group leaves every number NaN and every comparison false, so the checker would
  // pass any input. A gate must fail loudly there rather than fall silent.
  f.put('nc.md', ['| REQ-05 | 五 |', '| REQ-02 | 二 |'])
  const result = f.run('--pattern', '^(?:REQ)-(\\d+)$', 'nc.md')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /did not capture a number/)
})

test('reports a repeat once even when it also sits below the running maximum', t => {
  const f = fixture(t)
  // The repeat is the fault. Adding an ordering finding to it would suggest two problems.
  f.put('below.md', ['| A-05 | 五 |', '| A-02 | 二 |', '| A-02 | 又一个二 |'])
  const result = f.run('below.md')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /1 files, 2 errors/, 'the repeat adds one finding, not two')
  const lines = result.stdout.trim().split('\n')
  assert.deepEqual(lines.slice(0, 2).map(line => line.split(': ')[2]),
    ['identifier-order', 'duplicate-identifier'])
})

test('walks a directory and honours an excluded prefix', t => {
  const f = fixture(t)
  // The two files carry the same identifiers on purpose. Both invariants are decided per document,
  // so the second file repeats the order violation and contributes no duplicate; a scope spanning
  // the walk would make its two rows duplicates as well and the count four.
  f.put('docs/current.md', ['| A-05 | 五 |', '| A-02 | 二 |'])
  f.put('docs/drafts/retained.md', ['| A-05 | 五 |', '| A-02 | 二 |'])
  assert.match(f.run('docs').stdout, /2 files, 2 errors/)
  const kept = f.run('docs', '--exclude', 'docs/drafts')
  assert.match(kept.stdout, /1 files, 1 errors/)
  assert.doesNotMatch(kept.stdout, /retained/)
})

test('reports findings as JSON without changing the verdict', t => {
  const f = fixture(t)
  f.put('mixed.md', ['| A-05 | 五 |', '| A-02 | 二 |', '| A-02 | 又一个二 |'])
  const result = f.run('mixed.md', '--format', 'json')
  assert.equal(result.status, 1)
  const report = result.json()
  assert.equal(report.files, 1)
  assert.equal(report.errors, report.findings.length)
  assert.deepEqual([...new Set(report.findings.map(finding => finding.rule))].sort(),
    ['duplicate-identifier', 'identifier-order'])
})

test('refuses a changed-line scope it cannot honour', t => {
  const f = fixture(t)
  // Both files exist and parse, so nothing earlier can absorb the run. A case that left them out
  // would pass on "cannot read changed.txt" the day someone implements the option, which is how the
  // prose checker's first version of this same guard came to be untested.
  // `put` here takes rows and supplies the header, and `raw` writes a body verbatim. Passing a
  // string to `put` spreads it one character per line, which leaves no table row and no parseable
  // range file — the vacuous fixture this case exists to avoid.
  f.put('a.md', ['| X-01 | 一 |'])
  f.raw('changed.txt', 'a.md:3')
  const result = f.run('--changed', 'changed.txt', 'a.md')
  assert.equal(result.status, 2)
  // An order finding is reported at the row that descends, not at the one it descends from, so
  // scoping to changed lines would hide the defect an insertion causes.
  assert.match(result.stderr, /unknown option: --changed/)
})

test('prints one bare version token', t => {
  const result = fixture(t).run('--version')
  assert.equal(result.status, 0)
  // A consumer's checker matches this against a manifest entry after splitting on whitespace, so a
  // banner or a name beside the number would leave nothing for it to match.
  assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/)
})

for (const [name, args] of [
  ['an unknown option', ['--verbose', 'a.md']],
  ['a value-less option', ['--exclude']],
  ['an unknown format', ['--format', 'yaml', 'a.md']],
  ['a pattern without both groups', ['--pattern', '^[A-Z]+$', 'a.md']],
  ['an unusable pattern', ['--pattern', '(', 'a.md']],
  ['no path at all', []],
  ['an unreadable path', ['absent.md']]
]) test(`refuses ${name} with the usage status`, t => {
  const result = fixture(t).run(...args)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^id-check: /)
})
