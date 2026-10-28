---
name: compiler
description: >-
  Compile and refresh a WeChat Mini Program or Mini Game simulator on macOS: open a page, refresh the simulator, build npm, or inspect a single WXML or WXSS compilation summary. Not preview, upload, automation or diagnostics.
---

# Simulator compilation

Read the [handoff contract](../../references/capabilities.md), the [CLI contract](../../references/cli.md) and [pending tasks](../../references/tasks.md) before the first operation. Use this entry directly or receive it from the router. Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for the operations below and complete the CLI contract's readiness check first.

An open project window is a prerequisite; initializer owns opening it.

## Operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Compile and open a page | `simulator_open_page --project PATH --page PAGE` | Triggers compilation and shows that page |
| Refresh the simulator | `simulator_refresh --project PATH` | Triggers recompilation of the current page |
| Build npm | `build_npm --project PATH` | Writes the local npm build output |
| Inspect a template result | `compile_wxml --project PATH --file-path FILE` | Read-only summary for one Mini Program WXML file |
| Inspect a style result | `compile_wxss --project PATH --file-path FILE` | Read-only summary for one Mini Program WXSS file |

`--query` passes page parameters and `--scene` a scene value for `simulator_open_page`. `--compile-type` selects `miniprogram` or `plugin` for the build and single-file operations. FILE is relative to the project's miniprogram or plugin root, unlike the absolute `--project` path. Check flags with `OPERATION -h` before first use.

## What a result proves

A successful `simulator_open_page` or `simulator_refresh` means the trigger reached the simulator. Neither returns a compilation result, so neither proves that the package or that page compiled. Confirm the intended behaviour through the requested evidence, and report compilation success only with evidence that shows it.

The single-file operations summarise one template or style. They cover neither the whole package nor runtime behaviour, and they apply to Mini Program pages only. For a Mini Game, refresh the simulator or build npm instead, and report that a single-file compile request is not applicable.

`build_npm` writes local build output. Run it when requested or needed to prepare or repair the authorized compilation or validation; no separate approval is needed for that preparation. Report its dependency and output errors as returned.

## Failures

| Error | Handling |
| --- | --- |
| No project window | Hand off to initializer to open one, then run the operation again |
| `PROJECT_PATH_NOT_FOUND`, `PROJECT_CONFIG_JSON_ERROR`, `APPID_ERROR` | Follow initializer's project-window handling; it owns the project-config handoff |
| Refresh succeeded but the symptom remains | Hand off to debugger for console, network and screenshot evidence |
| `compile_wxml` or `compile_wxss` on a Mini Game | Stop and report that these apply to Mini Program pages only |
| `build_npm` failure | Diagnose the dependency or output error; correct and rebuild within the authorized task, without repeating an unexplained failure |

Do not repeat a refresh or page open to work around an unexplained symptom, and do not repeat an operation whose outcome is unknown; observe state first as the CLI contract requires.

## Return

Return the operations run, the exact project, page or file, what each result does and does not prove, the requested evidence and remaining blockers. Hand off only to delivered entries in the capability index: console, network, screenshot, wx API and cache evidence belongs to debugger, phone previews, preview QR codes and uploads to previewer, the project list and code snippets to project-manager, page or canvas automation to automator, and cloud environments, functions, database, storage and message push to cloudbase-operator, and installation diagnosis to installer.
