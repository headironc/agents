import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const script = path.join(root, 'skills/wechatide/skills/installer/scripts/check-install.mjs')
const recordedMinimum = '2.02.2607152'

function fixture(t) {
  // Canonical from the start: macOS resolves /var to /private/var, and the script reports real paths.
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agents wechatide install ')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const bin = path.join(directory, 'bin')
  mkdirSync(bin)

  const write = (file, body, mode) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, body, mode ? { mode } : undefined)
  }

  /** Build a DevTools-shaped bundle; options choose which part is broken. */
  const bundle = (name, options = {}) => {
    const installRoot = path.join(directory, `${name}.app`)
    const resources = path.join(installRoot, 'Contents/Resources')
    if (options.runtime === 'nw') {
      write(path.join(resources, 'package.nw/package.json'), '{"version":"1.06.2}')
    } else if (options.runtime !== 'none') {
      write(path.join(resources, 'app.asar.unpacked/package.json'),
        options.packageJson ?? `{"version":"${options.version ?? '2.02.2609182'}"}`)
    }
    if (options.threshold) {
      write(path.join(resources, 'app.asar.unpacked/wechatide-skill/skills/installer/scripts/install-root.mjs'),
        `export const MIN_COMPATIBLE_VERSION = '${options.threshold}'\n`)
    }
    if (options.cli !== 'missing') {
      write(path.join(installRoot, 'Contents/MacOS/wechatide'),
        `#!/bin/bash\n${options.cli === 'broken' ? 'printf "boom\\n" >&2; exit 3' : 'exit 0'}\n`, 0o755)
    }
    return installRoot
  }

  /** Put a wechatide on the fake PATH: a link into a bundle, or a loose executable. */
  const onPath = target => {
    const link = path.join(bin, 'wechatide')
    if (typeof target === 'string') {
      symlinkSync(target, link)
    } else {
      writeFileSync(link, '#!/bin/bash\nexit 0\n', { mode: 0o755 })
      chmodSync(link, 0o755)
    }
    return link
  }

  // The script reads process.platform, which no fake PATH can stub, so every case that builds an
  // installation pins darwin explicitly; a case testing another platform passes its own --platform.
  const run = (args = [], options = {}) => {
    const pinned = args.includes('--platform') ? args : ['--platform', 'darwin', ...args]
    const result = spawnSync(process.execPath, [script, ...pinned], {
      env: { PATH: options.path ?? `${bin}:/usr/bin:/bin`, HOME: directory },
      encoding: 'utf8',
      timeout: 20_000
    })
    assert.ifError(result.error)
    return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null }
  }

  return { directory, bundle, onPath, run }
}

test('reports a compatible installation whose PATH command is bound to the bundle', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools', { threshold: '2.02.2607152' })
  f.onPath(path.join(installRoot, 'Contents/MacOS/wechatide'))
  const { status, json } = f.run(['--install-root', installRoot])
  assert.equal(status, 0)
  assert.equal(json.compatible, true)
  assert.equal(json.version, '2.02.2609182')
  assert.equal(json.command, path.join(installRoot, 'Contents/MacOS/wechatide'))
  assert.equal(json.reason, undefined)
  assert.equal(json.remedy, undefined)
})

test('prefers the threshold carried by the installation over the recorded one', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools', { version: '2.02.2608010', threshold: '2.02.2609999' })
  f.onPath(path.join(installRoot, 'Contents/MacOS/wechatide'))
  const { json } = f.run(['--install-root', installRoot])
  assert.equal(json.minimumVersionSource, 'installed')
  assert.equal(json.minimumVersion, '2.02.2609999')
  assert.equal(json.reason, 'version_too_old')
  assert.match(json.remedy, /does not download or install/)
  // PATH is linked into this same installation, so the executor would not refuse and there is no
  // other root to check; the remedy stands on its own.
  assert.equal(json.executorCode, undefined)
  assert.equal(json.pathInstallRoot, undefined)
  assert.doesNotMatch(json.remedy, /may succeed despite/)
})

test('falls back to the recorded threshold and says so when the installation carries none', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools')
  f.onPath(path.join(installRoot, 'Contents/MacOS/wechatide'))
  const { json } = f.run(['--install-root', installRoot])
  assert.equal(json.minimumVersionSource, 'recorded')
  assert.equal(json.minimumVersion, recordedMinimum)
  assert.equal(json.compatible, true)
})

test('names the loose PATH command the executor refuses as cli-unbound', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools')
  const loose = f.onPath(false)
  const { json } = f.run(['--install-root', installRoot])
  assert.equal(json.compatible, false)
  assert.equal(json.reason, 'cli_unbound')
  assert.equal(json.executorCode, 'cli-unbound')
  assert.equal(json.pathCommand, loose)
  assert.match(json.remedy, /before anything replaces it/)
})

test('refuses to call a compatible installation usable when PATH runs a different bundle', t => {
  const f = fixture(t)
  const inspected = f.bundle('Current DevTools')
  const other = f.bundle('Stale DevTools', { version: '2.02.2607999' })
  f.onPath(path.join(other, 'Contents/MacOS/wechatide'))
  const { json } = f.run(['--install-root', inspected])
  assert.equal(json.compatible, false)
  assert.equal(json.reason, 'cli_other_install')
  assert.equal(json.installRoot, inspected)
  assert.equal(json.pathInstallRoot, other)
  assert.equal(json.executorCode, undefined, 'the executor would not refuse; it would run the other one')
  assert.match(json.remedy, /says nothing about/)
})

test('reports compatible only when PATH resolves into the inspected bundle', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools')
  f.onPath(path.join(installRoot, 'Contents/MacOS/wechatide'))
  const { json } = f.run(['--install-root', installRoot])
  assert.equal(json.compatible, true)
  assert.equal(json.pathCommand, path.join(installRoot, 'Contents/MacOS/wechatide'))
})

test('treats a symlinked route to the same bundle as one installation, not a split one', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools')
  f.onPath(path.join(installRoot, 'Contents/MacOS/wechatide'))
  // The caller's spelling reaches the same directory through a link; only identity sees that.
  const alias = path.join(f.directory, 'alias.app')
  symlinkSync(installRoot, alias)
  const { json } = f.run(['--install-root', alias])
  assert.equal(json.compatible, true, 'a symlinked root is the same installation')
  assert.equal(json.reason, undefined)
  assert.equal(json.pathInstallRoot, undefined)
})

test('omits the executor code when a failing install sits beside a working CLI on PATH', t => {
  const f = fixture(t)
  const stale = f.bundle('Stale DevTools', { version: '2.02.2600000' })
  const working = f.bundle('Working DevTools')
  f.onPath(path.join(working, 'Contents/MacOS/wechatide'))
  const { json } = f.run(['--install-root', stale])
  assert.equal(json.reason, 'version_too_old')
  assert.equal(json.executorCode, undefined, 'the executor resolves the working bundle from PATH')
  assert.equal(json.pathInstallRoot, working)
  assert.match(json.remedy, /may succeed despite this verdict/)
})

test('keeps cli-unavailable when nothing on PATH can serve the executor either', t => {
  const f = fixture(t)
  const stale = f.bundle('Stale DevTools', { version: '2.02.2600000' })
  const { json } = f.run(['--install-root', stale], { path: '/usr/bin:/bin' })
  assert.equal(json.reason, 'version_too_old')
  assert.equal(json.executorCode, 'cli-unavailable')
  assert.equal(json.pathInstallRoot, undefined)
  assert.doesNotMatch(json.remedy, /may succeed despite/)
})

test('reports cli-unbound on an unrelated failure when PATH holds a loose command', t => {
  const f = fixture(t)
  const stale = f.bundle('Stale DevTools', { version: '2.02.2600000' })
  f.onPath(false)
  const { json } = f.run(['--install-root', stale])
  assert.equal(json.reason, 'version_too_old')
  assert.equal(json.executorCode, 'cli-unbound', 'the executor refuses a command outside a bundle')
})

test('does not promise a working call when PATH runs the same broken CLI', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools', { cli: 'broken' })
  f.onPath(path.join(installRoot, 'Contents/MacOS/wechatide'))
  const { json } = f.run(['--install-root', installRoot])
  assert.equal(json.reason, 'cli_unavailable')
  assert.equal(json.executorCode, undefined, 'the executor would run it rather than refuse')
  assert.equal(json.pathInstallRoot, undefined, 'there is no second installation')
  assert.doesNotMatch(json.remedy, /may succeed despite/)
})

test('separates a missing PATH link from a broken installation', t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools')
  const { json } = f.run(['--install-root', installRoot], { path: '/usr/bin:/bin' })
  assert.equal(json.reason, 'cli_not_on_path')
  assert.equal(json.executorCode, 'cli-unavailable')
  assert.equal(json.version, '2.02.2609182')
  assert.equal(json.command, path.join(installRoot, 'Contents/MacOS/wechatide'))
  assert.match(json.remedy, /outside this delivery/)
})

for (const [name, options, reason] of [
  ['an NW.js build', { runtime: 'nw' }, 'nw_runtime_incompatible'],
  ['neither runtime marker', { runtime: 'none' }, 'unknown_runtime_incompatible'],
  ['an unreadable version', { packageJson: '{ not json' }, 'version_unreadable'],
  ['a non-numeric version', { version: '2.02.beta' }, 'version_uncomparable'],
  ['a missing skill CLI', { cli: 'missing' }, 'cli_missing'],
  ['a CLI that fails its own help', { cli: 'broken' }, 'cli_unavailable']
]) test(`reports ${name} as ${reason} without proposing an install`, t => {
  const f = fixture(t)
  const installRoot = f.bundle('WeChat DevTools', options)
  const { status, json } = f.run(['--install-root', installRoot], { path: '/usr/bin:/bin' })
  assert.equal(status, 0)
  assert.equal(json.compatible, false)
  assert.equal(json.reason, reason)
  assert.equal(json.executorCode, 'cli-unavailable')
  assert.ok(json.remedy, 'every failure names what the Human would do')
})

test('reports an absent installation without claiming the product is missing', t => {
  const f = fixture(t)
  const { json } = f.run(['--install-root', path.join(f.directory, 'absent.app')])
  assert.equal(json.reason, 'not_installed')
  assert.equal(json.executorCode, 'cli-unavailable')
  assert.equal(json.minimumVersionSource, 'recorded')
  assert.match(json.remedy, /Confirm the path/)
})

test('reports a non-macOS host as the executor does and inspects nothing', t => {
  const f = fixture(t)
  const { status, json } = f.run(['--platform', 'linux'])
  assert.equal(status, 0)
  assert.equal(json.reason, 'unsupported_platform')
  assert.equal(json.executorCode, 'unsupported-platform')
  assert.equal(json.installRoot, undefined)
})

for (const [name, args] of [
  ['an unknown option', ['--download']],
  ['a value-less option', ['--install-root']],
  ['an option given another option as its value', ['--install-root', '--platform']]
]) test(`refuses ${name}`, t => {
  const { status, stderr, stdout } = fixture(t).run(args)
  assert.equal(status, 1)
  assert.equal(stdout, '')
  assert.match(stderr, /^wechatide-install-check: /)
})
