---
name: initializer
description: >-
  Prepare WeChat DevTools on macOS: check status, log in, open or close a project window, list manageable AppIDs, read runtime context or quit DevTools. Not automation, compilation, preview, upload or cloud operations.
---

# DevTools initialization

Read the [handoff contract](../../references/capabilities.md), the [CLI contract](../../references/cli.md) and [pending tasks](../../references/tasks.md) before the first operation. Use this entry directly or receive it from the router. Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for the operations below and complete the CLI contract's readiness check first.

## Operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Status, login and version relation | `check_wechatide_status --skill-version VERSION` | Read-only readiness check |
| Log in | `login --type window` | Shows a QR code window and returns a task |
| Open a project window | `open_project_window --project PATH` | Opens a simulator window or returns the existing one |
| Close a project window | `close_project_window --project PATH` | Closes that project's window, not DevTools |
| List AppIDs | `get_user_appids` | Read-only list for the logged-in user |
| Runtime context | `automation_runtime_info --project PATH --action ACTION` | Reads the page stack, current page or system information |
| Quit DevTools | `quit` | Closes DevTools and all of its windows |

Use `--type miniprogram` or `minigame` to filter AppIDs when the task needs it. ACTION is `pageStack`, `currentPage` or `systemInfo`, and requires an open project window. Use `--type image` for login only when the host can show the returned image to the user. Resolve the absolute `--project` directory rather than a parent storage folder (selecting a concrete project subdirectory when creating a new project under a parent folder). When a path is uncertain or points at a filesystem root, home directory, or multi-project parent without confirmed project files or `miniprogramRoot` / `pluginRoot`, inspect existing configuration, entry files (`app.json`, `game.json`), and build scripts within a bounded search inside the confirmed workspace (excluding dependencies and caches, never scanning a whole disk or home directory), ask when multiple candidates or ambiguity remain, and never write configuration or entry files in an unconfirmed directory to satisfy CLI validation.

## Login

A login result means the QR code is ready, not that the user has logged in. Tell the user to scan it and poll the task as pending tasks require. After `success`, run the status check again and continue only when `loginExpired` is false. Report other final states without claiming login.

## Project windows

Use `liteMode` by default; request `--window-mode fullMode` only when the task enters editing or debugging. Pass `--always-on-top true` or `--always-on-top false` (or `--always-on-top=false`) only for `liteMode` windows (`fullMode` ignores `--always-on-top`). When `--always-on-top` is omitted on a new `liteMode` window, DevTools reuses its last recorded pin preference and defaults to `true` if unrecorded; passing `false` disables top-pinning and saves that preference. Opening an already-open project returns its window without changing `windowMode`, and omitting `--always-on-top` preserves the open `liteMode` window's pin state while passing it updates that state. Call the operation first instead of pre-reading project configuration, then handle a returned reason or code:

| Error | Handling |
| --- | --- |
| `PROJECT_PATH_NOT_FOUND` | Check whether `--project` confused a parent storage folder with the project directory. For an existing project, locate the existing directory or run the project's authorized build workflow to produce its output directory, and never turn a missing path on an existing project into from-scratch creation; if no existing project directory resolves and creation was not requested, report the missing path and stop. When the user explicitly asks to create a project from scratch at a confirmed project directory, resolve an AppID with `get_user_appids` (and cloud environments via `cloudbase-operator` `cloud_env_list --appid` when CloudBase applies), create minimal starter files as ordinary source work (`app.json` and starter page for `miniprogram`, or `game.json` and `game.js` for `game`), configure `project.config.json` via `project-config`, and register the directory with `project-manager` (`project_import`) before opening a window |
| `PROJECT_CONFIG_JSON_ERROR` | Verify the target project directory first, because an existing directory does not prove it is the project root. Hand confirmed configuration repair or completion to `project-config` and retry once with the resolved `--project` after its verified change; if the retry returns `APPID_ERROR`, follow the `APPID_ERROR` row |
| `APPID_ERROR` | Use a supplied AppID or list AppIDs for the user to choose; hand the change to project-config and retry once |

If the retry returns `APPID_ERROR` again, stop and let the user choose another AppID or log in again; do not loop. Report other failures without retrying the same call unchanged.

## Quit

Run `quit` only when the user explicitly asks to quit DevTools. It closes every project window, so do not use it to recover from another failure.

## Return

Return the operations run, the exact project, confirmed facts such as login state, `versionRelation`, window mode, AppID and current page, any retained pending task and remaining blockers. Route any follow-up work to its owning entry in the [capability index](../../references/capabilities.md).
