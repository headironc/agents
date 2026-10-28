---
name: debugger
description: >-
  Diagnose a running WeChat Mini Program or Mini Game on macOS: filter the simulator console and network buffers, take screenshots, call, mock or restore a wx API, and clear local debug caches. Not compilation, preview, upload, page automation or cloud operations.
---

# DevTools diagnostics

Read the [handoff contract](../../references/capabilities.md), the [CLI contract](../../references/cli.md) and [pending tasks](../../references/tasks.md) before the first operation. Use this entry directly or receive it from the router. Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for the operations below and complete the CLI contract's readiness check first.

Collect the smallest evidence that explains the reported symptom, then report a cause and the next step. Prefer the read-only operations; the wx API and cache operations change the running project and need their own authorization.

## Operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Console lines | `get_simulator_console --project PATH --command GREP` | Read-only filter over the console buffer |
| Network lines | `get_simulator_network --project PATH --command GREP` | Read-only filter over the network buffer |
| Screenshot | `simulator_screenshot --project PATH` | Writes an image file and returns its path and size |
| Runtime context | `automation_runtime_info --project PATH --action ACTION` | Read-only; owned by initializer, used here for context |
| wx API | `automation_wx_api --project PATH --action ACTION --method METHOD` | Calls, mocks or restores an API in the running project |
| Local debug caches | `debug_clear_cache --project PATH --action ACTION` | Clears the selected cache of that project |

All of them need an open project window; initializer owns opening it. Check flags with `OPERATION -h` before first use. `simulator_refresh` belongs to compiler: return the task with the observed symptom instead of calling it here or forcing a refresh another way.

## Console and network

`--command` is a grep expression over the buffer, not an enumerated value and not a shell command. Use `grep -n .` for every line, `grep -i error` or a similar pattern to filter. Do not pass `all`. An empty result means no line matched. It does not prove the buffer is empty or that the project logs nothing; widen the pattern before concluding that. Quote the expression as one argument and report which pattern produced the evidence, because a later reader cannot tell a filtered result from a full one.

## Screenshots

A screenshot writes an image file: by default an optimized JPEG in the system temporary directory, whose path and pixel size come back in the result. Pass `--path` only when the user asked for a specific location, and check that writing there is authorized. Prefer `--wait-for-selector` over a fixed `--wait` of up to 10 seconds, and use `--optimize false` for a raw PNG only when the task needs full resolution. Report the returned path; a screenshot is evidence of the visible state, not of a passing test.

## wx API and caches

These two operations change the running project, so they are not diagnostics to run by default:

- `automation_wx_api --action call` runs the API in the project, `mock` replaces its result until it is restored, and `restore` removes that mock. A mock survives this task: restore it once the evidence is collected, or report the API and project that remain mocked.
- Array and object arguments use `--args-file` and `--result-file` with an absolute JSON file path. The executor refuses `--args` with `reserved-option`, so a literal array cannot be passed on the command line.
- `debug_clear_cache --action` selects what is cleared, from a single cache such as `cleanStorageCache` or `cleanCompileCache` to `cleanAll`. `clearAuth` and `clearSession` drop the signed-in session inside the simulator, so the user has to sign in again in the project.

Bind the exact project and effects to the effective task authorization. An authorized repair or test includes necessary reversible mocks and their restoration; a read-only diagnosis does not. Ask before uncovered API effects, data loss or session removal, and report what changed afterwards.

## Result and failures

Check the returned operation and fields before using a result. A warning names a dropped argument, so correct it from `-h` and run the operation again as the CLI contract requires, instead of reporting the weaker result as evidence. A wx API call or a cache clear is the exception: it already took effect, so report the dropped argument rather than repeating it. Follow the CLI contract for failures. For `PROJECT_PATH_NOT_FOUND`, `PROJECT_CONFIG_JSON_ERROR` or `APPID_ERROR`, return the project to initializer rather than repairing it here. If an operation fails or its outcome is unknown, report it; do not repeat a wx API call or a cache clear to see whether it works.

Never change the project's test account, enable remote debugging, quit DevTools or edit project files as part of a diagnosis.

## Return

Report the symptom, the operations run with their exact project, the evidence including each grep pattern and screenshot path, the likely cause, what it would take to confirm it, and the remaining blockers. Separate observation from change: state any mock left in place or cache cleared. Hand off only to delivered entries in the capability index: a refresh, recompilation or npm build belongs to compiler, project windows to initializer, phone previews, preview QR codes and uploads to previewer, the project list and code snippets to project-manager, page or canvas automation to automator, and cloud environments, functions, database, storage and message push to cloudbase-operator, and installation diagnosis to installer.
