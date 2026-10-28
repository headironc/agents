#!/usr/bin/env node
// Contract subject: `wechatide-install-check`.
//
// Read [installer entry](../SKILL.md) and the [CLI contract](../../../references/cli.md).
//
// Usage: node check-install.mjs [--install-root PATH] [--platform NAME]
// Reports why the call executor cannot reach the DevTools CLI. Reads the filesystem and runs the
// resolved CLI's local help; it installs nothing, downloads nothing and changes no PATH or link.
// Every field is a fact about this machine, and `remedy` names work for the Human, not a step this
// script takes.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Upstream owns this threshold in its own installer module and raises it over time. It is read from
// the installed copy when one is present, so a stale repository value cannot silently apply.
const RECORDED_MINIMUM_VERSION = '2.02.2607152'
const DEFAULT_INSTALL_ROOT = '/Applications/wechatwebdevtools.app'
const UPSTREAM_THRESHOLD_MODULE = 'Contents/Resources/app.asar.unpacked/wechatide-skill/skills/installer/scripts/install-root.mjs'

/** DevTools version strings are dotted digit groups; compare them as one integer. */
function versionToNumber(version) {
  const digits = String(version).replace(/\./g, '')
  return /^\d+$/.test(digits) ? BigInt(digits) : null
}

function parseArguments(argv) {
  const options = { platform: process.platform, installRoot: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag !== '--install-root' && flag !== '--platform') {
      throw new Error(`unknown option: ${flag}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`option ${flag} needs a value`)
    }
    if (flag === '--platform') {
      options.platform = value
    } else {
      options.installRoot = path.resolve(value)
    }
    index += 1
  }
  return options
}

/** Prefer the threshold the installed DevTools carries; fall back to the recorded one and say so. */
function resolveMinimumVersion(installRoot) {
  if (installRoot) {
    const modulePath = path.join(installRoot, UPSTREAM_THRESHOLD_MODULE)
    try {
      const source = fs.readFileSync(modulePath, 'utf8')
      const match = source.match(/MIN_COMPATIBLE_VERSION\s*=\s*['"]([\d.]+)['"]/)
      if (match && versionToNumber(match[1]) !== null) {
        return { minimumVersion: match[1], minimumVersionSource: 'installed' }
      }
    } catch {
      // An unreadable or absent module leaves the recorded value, reported as such below.
    }
  }
  return { minimumVersion: RECORDED_MINIMUM_VERSION, minimumVersionSource: 'recorded' }
}

function readElectronVersion(installRoot) {
  const packagePath = path.join(installRoot, 'Contents/Resources/app.asar.unpacked/package.json')
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    throw new Error(`package.json carries no version: ${packagePath}`)
  }
  return parsed.version.trim()
}

/**
 * First executable named wechatide on PATH, resolved through links; null when there is none.
 * Scanned here rather than through `which`, so the result does not depend on an external command
 * and matches what the executor's own `type -P` finds.
 */
function resolvePathCommand() {
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    if (!entry) {
      continue
    }
    const candidate = path.join(entry, 'wechatide')
    try {
      if (!fs.statSync(candidate).isFile()) {
        continue
      }
      fs.accessSync(candidate, fs.constants.X_OK)
    } catch {
      continue
    }
    try {
      return fs.realpathSync(candidate)
    } catch {
      return candidate
    }
  }
  return null
}

/**
 * Whether two paths name the same directory, by device and inode rather than by spelling.
 * When either side cannot be stat'd, fall back to comparing resolved paths, which answers only the
 * spellings it can see; identity is the primary test precisely because that answer is weaker.
 */
function isSameDirectory(left, right) {
  try {
    const a = fs.statSync(left)
    const b = fs.statSync(right)
    return a.dev === b.dev && a.ino === b.ino
  } catch {
    return path.resolve(left) === path.resolve(right)
  }
}

/** The executor accepts only a CLI inside an application bundle; mirror that test exactly. */
function isBundleBound(command) {
  return /\/[^/]+\.app\/Contents\/MacOS\/wechatide$/.test(command)
}

function answersHelp(command) {
  const run = spawnSync(command, ['-h'], { encoding: 'utf8', timeout: 10_000 })
  if (!run.error && run.status === 0) {
    return { ok: true }
  }
  const detail = run.error?.message || (run.stderr || run.stdout || `exit ${run.status}`).trim()
  return { ok: false, error: detail }
}

function diagnose(options) {
  if (options.platform !== 'darwin') {
    return {
      compatible: false,
      reason: 'unsupported_platform',
      platform: options.platform,
      executorCode: 'unsupported-platform',
      remedy: 'This delivery supports macOS only. Run DevTools work on a macOS host.'
    }
  }

  const installRoot = options.installRoot || DEFAULT_INSTALL_ROOT
  const threshold = resolveMinimumVersion(fs.existsSync(installRoot) ? installRoot : '')

  // The executor resolves its CLI from PATH alone and never reads installRoot, so what it would do
  // is decided here, before any branch, rather than assumed by each one. Resolving it late made
  // every earlier branch claim cli-unavailable even when a working bundle sat on PATH.
  const pathCommand = resolvePathCommand()
  const pathBundleBound = Boolean(pathCommand) && isBundleBound(pathCommand)
  const pathInstallRoot = pathBundleBound
    ? pathCommand.slice(0, -'/Contents/MacOS/wechatide'.length)
    : undefined
  const executorCode = pathCommand ? (pathBundleBound ? undefined : 'cli-unbound') : 'cli-unavailable'
  const divergent = Boolean(pathInstallRoot) && !isSameDirectory(installRoot, pathInstallRoot)

  const base = {
    platform: 'darwin',
    installRoot,
    ...threshold,
    ...(pathCommand ? { pathCommand } : {}),
    ...(divergent ? { pathInstallRoot } : {}),
    ...(executorCode ? { executorCode } : {})
  }

  if (!fs.existsSync(installRoot)) {
    return {
      compatible: false,
      reason: 'not_installed',
      ...base,
      remedy: options.installRoot
        ? 'Nothing is installed at the given --install-root. Confirm the path.'
        : 'No DevTools at the default path. Confirm whether it is installed elsewhere and re-run with --install-root before concluding it is missing.'
    }
  }

  const resources = path.join(installRoot, 'Contents/Resources')
  if (fs.existsSync(path.join(resources, 'package.nw/package.json'))) {
    return {
      compatible: false,
      reason: 'nw_runtime_incompatible',
      ...base,
      remedy: 'This is the NW.js build, which carries no skill CLI. The Human installs a current Electron build; this delivery does not download or install it.'
    }
  }
  if (!fs.existsSync(path.join(resources, 'app.asar.unpacked/package.json'))) {
    return {
      compatible: false,
      reason: 'unknown_runtime_incompatible',
      ...base,
      remedy: 'Neither runtime marker is present, so this directory is not a DevTools installation this delivery recognises.'
    }
  }

  let version
  try {
    version = readElectronVersion(installRoot)
  } catch (error) {
    return {
      compatible: false,
      reason: 'version_unreadable',
      ...base,
      error: error.message,
      remedy: 'The installed package version cannot be read, so compatibility is unknown. Report it rather than assuming either answer.'
    }
  }

  const installed = versionToNumber(version)
  const minimum = versionToNumber(threshold.minimumVersion)
  if (installed === null || minimum === null) {
    return {
      compatible: false,
      reason: 'version_uncomparable',
      ...base,
      version,
      remedy: `Version ${version} cannot be compared with ${threshold.minimumVersion}. Report it instead of guessing.`
    }
  }
  if (installed < minimum) {
    return {
      compatible: false,
      reason: 'version_too_old',
      ...base,
      version,
      remedy: `Installed ${version} is below ${threshold.minimumVersion}. The Human updates DevTools; this delivery does not download or install it.`
    }
  }

  const bundleCommand = path.join(installRoot, 'Contents/MacOS/wechatide')
  const bundleExists = fs.existsSync(bundleCommand)

  if (!bundleExists) {
    return {
      compatible: false,
      reason: 'cli_missing',
      ...base,
      version,
      remedy: 'The installation carries no skill CLI at Contents/MacOS/wechatide. Do not substitute cli, cli.bat or wechatidecli; the Human updates DevTools.'
    }
  }

  const bundleHelp = answersHelp(bundleCommand)
  if (!bundleHelp.ok) {
    return {
      compatible: false,
      reason: 'cli_unavailable',
      ...base,
      version,
      command: bundleCommand,
      error: bundleHelp.error,
      remedy: 'The CLI is present but does not answer its own help, so the executor cannot use it either. Report the error; the Human updates or reinstalls DevTools.'
    }
  }

  if (!pathCommand) {
    return {
      compatible: false,
      reason: 'cli_not_on_path',
      ...base,
      version,
      command: bundleCommand,
      remedy: `DevTools is compatible and its CLI works, but no wechatide is on PATH, which a drag-installed DMG typically causes. Linking ${bundleCommand} onto PATH is installation work outside this delivery; the Human does it.`
    }
  }

  if (!isBundleBound(pathCommand)) {
    return {
      compatible: false,
      reason: 'cli_unbound',
      ...base,
      version,
      command: bundleCommand,
      remedy: `The wechatide on PATH resolves to ${pathCommand}, outside an application bundle, so the executor refuses it. Report which file that is before anything replaces it; the Human decides what PATH should point at.`
    }
  }

  // Runtime and version were read from installRoot, but the executor runs whatever PATH resolves to.
  // When those are different bundles, this inspection says nothing about the CLI that would run.
  if (divergent) {
    return {
      compatible: false,
      reason: 'cli_other_install',
      ...base,
      version,
      command: bundleCommand,
      remedy: `The inspected installation at ${installRoot} is compatible, but the executor would run the CLI of ${pathInstallRoot}, which this result says nothing about. The call can still succeed against that other installation. Re-run with --install-root ${pathInstallRoot} to judge the one that would actually be used.`
    }
  }

  return { compatible: true, ...base, version, command: pathCommand }
}

/**
 * A failure of the inspected installation says nothing about a working CLI that PATH points at
 * somewhere else, so name that divergence instead of leaving a remedy the executor contradicts.
 */
function noteDivergence(result) {
  if (result.compatible || !result.pathInstallRoot || result.reason === 'cli_other_install') {
    return result
  }
  return {
    ...result,
    remedy: `${result.remedy} The executor would run the CLI of ${result.pathInstallRoot} instead, which this result does not describe, so the call may succeed despite this verdict.`
  }
}

try {
  console.log(JSON.stringify(noteDivergence(diagnose(parseArguments(process.argv.slice(2)))), null, 2))
} catch (error) {
  console.error(`wechatide-install-check: ${error.message}`)
  process.exitCode = 1
}
