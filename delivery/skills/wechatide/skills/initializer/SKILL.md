---
name: initializer
description: >-
  Prepare WeChat DevTools on macOS: check status, log in, open or close a
  project window, list manageable AppIDs, read runtime context or quit DevTools.
  Not automation, compilation, preview, upload or cloud operations.
---

# DevTools initialization

Read the [handoff contract](../../references/capabilities.md), the
[CLI contract](../../references/cli.md) and
[pending tasks](../../references/tasks.md) before the first operation.
Use this entry directly or receive it from the router.
Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for
the operations below and complete the CLI contract's readiness check first.

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

Use `--type miniprogram` or `minigame` to filter AppIDs when the task needs it.
ACTION is `pageStack`, `currentPage` or `systemInfo`, and requires an open
project window. Use `--type image` for login only when the host can show the
returned image to the user.
Resolve the absolute project path from authorized context; if more than one
project could be the target, ask before opening a window.

## Login

A login result means the QR code is ready, not that the user has logged in.
Tell the user to scan it and poll the task as pending tasks require.
After `success`, run the status check again and continue only when
`loginExpired` is false. Report other final states without claiming login.

## Project windows

Use liteMode by default; request `--window-mode fullMode` only when the task
needs the editor or debugger. Opening an already open project returns its
window, so do not reopen it to refresh state.
Call the operation first instead of pre-reading project configuration, then
handle a returned reason or code:

| Error | Handling |
| --- | --- |
| `PROJECT_PATH_NOT_FOUND` | Report the path; creating a project is not delivered |
| `PROJECT_CONFIG_JSON_ERROR` | Hand the path and error to project-config; retry once after its verified repair |
| `APPID_ERROR` | Use a supplied AppID or list AppIDs for the user to choose; hand the change to project-config and retry once |

If the retry returns `APPID_ERROR` again, stop and let the user choose another
AppID or log in again; do not loop. Report other failures without retrying the
same call unchanged.

## Quit

Run `quit` only when the user explicitly asks to quit DevTools. It closes every
project window, so do not use it to recover from another failure.

## Return

Return the operations run, the exact project, confirmed facts such as login
state, versionRelation, window mode, AppID and current page, any retained
pending task and remaining blockers.
Hand off only to delivered entries in the capability index: page opening,
simulator refresh, npm build and single-file compilation summaries belong to
compiler, console, network, screenshot, wx API and cache evidence to debugger,
phone previews, preview QR codes and uploads to previewer, the project list
and code snippets to project-manager, page or canvas automation to automator,
and cloud environments, functions, database, storage and message push to
cloudbase-operator, and installation diagnosis to installer.
