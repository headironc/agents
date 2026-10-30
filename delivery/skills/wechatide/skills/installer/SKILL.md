---
name: installer
description: >-
  Diagnose why WeChat DevTools cannot be reached on macOS: report whether it is installed, whether its runtime and version are compatible, and whether the wechatide CLI is on PATH and bound to the application bundle, so the Human knows what to fix. Not downloading, installing, updating or repairing PATH, and not a DevTools operation of its own.
---

# Installation diagnosis

Read the [handoff contract](../../references/capabilities.md) and the [CLI contract](../../references/cli.md) before the first check. Use this entry directly or receive it from the router. Read the [installation check](scripts/check-install.mjs). Use tool `wechatide-install-check` for the diagnosis below; it is the only executable this entry runs.

This entry registers no DevTools operation, so it does not use the call executor and needs no client authorization or readiness check. It answers one question: why can the executor not reach the CLI, and what would fix it. It reports; the Human acts.

## When to use it

Enter here when the [call executor](../../scripts/call.sh) refused with `cli-unavailable` or `cli-unbound`, or when the user asks whether DevTools is installed or why `wechatide` cannot be found. Do not run the check as a routine step before ordinary DevTools work: the readiness check in the CLI contract already covers a working installation, and a successful operation proves more than this diagnosis would.

A `versionRelation` of `agent_behind` is not an installation problem. It means the repository skill needs updating and reinstalling, which initializer's readiness handling already reports.

## The check

Run it with Node from the installed skill's physical directory:

```bash
node SKILL_ROOT/skills/installer/scripts/check-install.mjs
node SKILL_ROOT/skills/installer/scripts/check-install.mjs --install-root PATH
```

It prints one JSON object and exits 0, or prints `wechatide-install-check: MESSAGE` on stderr and exits 1 for a bad option. It reads the filesystem and runs the resolved CLI's local help. It installs nothing, downloads nothing, and changes no PATH entry, link or file.

`--install-root` inspects a non-default location. Pass it before concluding anything from `not_installed`, because this delivery only knows the default `/Applications/wechatwebdevtools.app`.

| Field | Meaning |
| --- | --- |
| `compatible` | True only when the runtime, the version and the PATH binding all pass |
| `reason` | Why it failed; absent on success |
| `executorCode` | Which executor refusal this explains: `cli-unavailable`, `cli-unbound` or `unsupported-platform`. It describes PATH alone, because the executor reads nothing else, so it is absent whenever PATH holds a bundle-bound CLI, even on a failing result |
| `installRoot` | The directory inspected |
| `version` | The installed package version, when it could be read |
| `minimumVersion` | The threshold applied |
| `minimumVersionSource` | `installed` when read from the installation, `recorded` when the repository's own value was used |
| `command` | The CLI this delivery would use |
| `pathCommand` | What `wechatide` on PATH resolves to |
| `pathInstallRoot` | The bundle that PATH command belongs to, present on any result where it differs from the inspected one |
| `remedy` | What the Human would do; never a step this entry takes |

`minimumVersionSource: recorded` means the installation carried no threshold to read, so the repository's value applied and may be behind upstream's. Say so when a version verdict rests on it.

## Reasons

| `reason` | What it means |
| --- | --- |
| `unsupported_platform` | Not macOS; this delivery supports macOS only, and nothing was inspected |
| `not_installed` | Nothing at the inspected root; confirm a non-default location with `--install-root` before calling it missing |
| `nw_runtime_incompatible` | The older NW.js build, which carries no skill CLI at all |
| `unknown_runtime_incompatible` | Neither runtime marker; the directory is not an installation this delivery recognises |
| `version_unreadable` | The package version could not be read, so compatibility is unknown rather than bad |
| `version_uncomparable` | The version is not a dotted digit string and cannot be compared |
| `version_too_old` | Below the threshold; report both numbers and which source the threshold came from |
| `cli_missing` | Compatible build, but no CLI at `Contents/MacOS/wechatide` |
| `cli_unavailable` | The CLI exists but does not answer its own help; report the returned error |
| `cli_not_on_path` | Everything works, but no `wechatide` is on PATH, which a drag-installed DMG typically causes |
| `cli_unbound` | A `wechatide` is on PATH but resolves outside an application bundle, so the executor refuses it |
| `cli_other_install` | The inspected installation is compatible, but PATH resolves into a different bundle, which this result says nothing about |

## What this entry does not do

Downloading an installer, running one, updating DevTools and repairing PATH are not delivered here, and no operation of this delivery performs them. Report the diagnosis and what would fix it, then stop.

For `cli_not_on_path`, name the working absolute `command` and say that putting it on PATH is installation work the Human owns. Do not create the link, edit a shell profile, or suggest reinstalling: the installation is already compatible, and reinstalling to fix a missing link is the loop upstream warns against.

For `cli_other_install`, do not report the inspected installation as usable. The runtime and version were read from `installRoot`, while the executor runs whatever PATH resolves to, so a compatible verdict there would describe a bundle the call will not use. The call may well succeed, against the other installation. Report both paths and re-run with `--install-root` set to `pathInstallRoot` to judge the one that would actually run.

For `cli_unbound`, report which file `wechatide` currently resolves to before anything replaces it. Something already owns that name, and this entry does not know whether it is a stale link, a wrapper or an unrelated program. The Human decides what PATH should point at.

For `not_installed`, `nw_runtime_incompatible` or `version_too_old`, say that a download or update is needed and that this delivery does not perform it. Name the official download page rather than constructing a package URL, and do not choose a channel, architecture or version on the user's behalf. Version selection, package resolution and the compatibility-repair rules live upstream and are not adopted here.

Never write into the DevTools application directory, and never copy an installed skill back into it.

## Failures

| Situation | Handling |
| --- | --- |
| The check exits 1 with a message | Correct the option and run it again; only `--install-root` and `--platform` exist |
| Node is unavailable | Report that the diagnosis could not run, rather than guessing the installation state |
| `not_installed` at the default root | Ask whether DevTools lives elsewhere and re-run with `--install-root` before reporting it as missing |
| A compatible result while the executor still refuses | Report both; a passing diagnosis and a failing call disagree, and the call is the evidence that matters |
| A failing result carrying `pathInstallRoot` | The executor would run a different installation, which this result does not describe, so the call may succeed despite the verdict. Re-run against that root before acting on the remedy |
| A failing result with no `executorCode` and no `pathInstallRoot` | PATH is linked into the inspected installation itself, so the verdict and the executor agree. Act on the remedy; there is no second installation to check |
| The user asks for the installer to be downloaded or run | Report it as not delivered and name the official download page |

## Return

Return the exact inspected root, `compatible` with its `reason`, the installed and minimum versions with the threshold's source, what `wechatide` resolves to, which executor refusal the result explains, and what the Human would do next. State plainly that nothing was installed, downloaded, linked or changed. Hand off only to delivered entries in the capability index: once the installation is compatible, readiness, login, windows and AppIDs belong to initializer, and every business operation to its own entry through the call executor.
