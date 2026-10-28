---
name: automator
description: >-
  Automate a running WeChat Mini Program or Mini Game on macOS: navigate pages, act on elements by selector or coordinates, read or set page data, scroll, touch the Mini Game canvas, evaluate a function in the runtime, manage test-account tickets and generate an automator script, with actual evidence for every assertion. Not compilation, console or network diagnostics, preview, upload or cloud operations.
---

# Page and canvas automation

Read the [handoff contract](../../references/capabilities.md), the [CLI contract](../../references/cli.md) and [pending tasks](../../references/tasks.md) before the first operation. Use this entry directly or receive it from the router. Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for the operations below and complete the CLI contract's readiness check first.

All operations need an open project window; initializer owns opening it. Decide first whether the project is a Mini Program or a Mini Game, from the confirmed project facts or the `compileType` in its `project.config.json` (`miniprogram`, or `game` and `gamePlugin`), and use only that branch's operations. A Mini Game has no page stack and no WXML, so selectors, navigation, page data and runtime information do not apply to it.

## Mini Program operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Navigate | `automation_navigate --project PATH --action ACTION` | `navigateTo`, `redirectTo`, `switchTab` and `reLaunch` take `--url`; `navigateBack` takes `--delta` |
| Act on or read one element | `automation_element_action --project PATH --action ACTION` | `tap`, `longpress`, `input`, `trigger`, `scrollTo`, `touchstart`, `touchmove` and `touchend` change the page; `text`, `value`, `attribute`, `property`, `style`, `wxml`, `outerWxml`, `size`, `offset`, `scrollWidth` and `scrollHeight` read it |
| Read or change the page | `automation_page_action --project PATH --action ACTION` | `getData`, `querySelector`, `querySelectorAll`, `size` and `scrollTop` read; `setData` and `callMethod` change the page |
| Scroll the page | `automation_viewport_action --project PATH --action pageScrollTo --scroll-top N` | Scrolls the current page |
| Current page and stack | `automation_runtime_info --project PATH --action ACTION` | Read-only; owned by initializer, used here for context |
| Screenshot | `simulator_screenshot --project PATH` | Owned by debugger; the only screenshot route, also for evidence here |
| Generate a script | `automation_generate_script` | Renders the calls recorded in this session as a Node automator script; Mini Program only |

Select an element with `--selector`. For `tap`, `longpress` and the touch actions, pass either `--selector` or `--x` and `--y` in viewport CSS pixels, never both; every other element action needs `--selector`. Take coordinates from a screenshot or an `offset` read rather than guessing them. `input` takes its text in `--value`, `trigger` its event in `--type` with `--detail-file`, `attribute` and `property` their name in `--name`, and `scrollTo` its position in `--x` and `--y`. `setData` takes its changes as a JSON string in `--patch`, and `getData` narrows with `--data-path`. Arrays and objects use their `--FIELD-file` JSON alternative (`--args-file`, `--detail-file`, `--touches-file`, `--changed-touches-file`); the executor refuses `--args`. Prefer `--wait-for-selector` over a fixed `--wait` of up to 10 seconds, and put the wait on the operation that needs it instead of a separate step. When a selector is uncertain, run `querySelectorAll` first. Check flags with `OPERATION -h` before first use.

## Mini Game operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Touch the canvas | `automation_game_action --project PATH --action ACTION` | `tap`, `touchstart`, `touchmove` and `touchend` take `--x` and `--y`; `swipe` takes `--start-x`, `--start-y`, `--end-x`, `--end-y` and an optional `--duration` in milliseconds |
| Screenshot | `simulator_screenshot --project PATH` | The reference image for coordinates and the evidence afterwards |

Coordinates are canvas coordinates by default. To use pixels measured on a screenshot, pass `--coordinate-space image` with the `--image-width` and `--image-height` that screenshot returned; DevTools converts them, so do not scale them yourself. A Mini Game has no selector wait; only `--wait` applies. Do not call `automation_navigate`, `automation_element_action`, `automation_page_action`, `automation_runtime_info` or `automation_generate_script` for a Mini Game, and do not call `automation_game_action` for a Mini Program.

## Shared operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Run a function in the runtime | `automation_evaluate --project PATH --fn-source SOURCE` | Executes that function in the running project and returns its result |
| Test accounts | `automation_testaccount --project PATH --action ACTION` | `list` and `getTicket` read; `setTicket --ticket T` and `refreshTicket` change the signed-in test identity |
| wx API | `automation_wx_api --project PATH --action ACTION --method METHOD` | Owned by debugger; call or mock only inside the requested flow, under its rules |
| Real-device debugging | `automation_viewport_action --project PATH --action remote` | Starts real-device debugging on the developer's phone |

`automation_evaluate` executes code. Inspect the function's effects against the authorized test flow before running it. The agent may write the function needed for that flow, including read-only evidence expressions such as `wx.getSystemInfoSync()`, without separate approval of each function body. Do not infer authority for external writes, identity changes or destructive actions from a request to test a page. Report the exact source that ran. Function arguments go in `--args-file`. In a Mini Game, do not rely on `getCurrentPages` or `Page` inside it. `setTicket` and `refreshTicket` change which test account the simulator is signed in as, and `remote` involves the developer's phone: run them only on the user's explicit request, and treat a denied permission dialog as a stop rather than retrying it. The `screenshot`, `stopAudits` and `close` actions of `automation_viewport_action` are not used here: screenshots go through `simulator_screenshot`, no entry starts an audit, and closing the window belongs to initializer. For a Mini Program, `automation_generate_script` returns a script built from the calls recorded in this session; a Mini Game has no page calls to record. Check whether the result carries the script text or a file path. Review the script before anyone runs it, and treat installing `miniprogram-automator` and running the script with Node as ordinary source work outside this entry that needs the user's request. `--include-failed` keeps failed calls, and `--clear-history` discards the recording, so pass it only when asked. Coordinate taps do not produce runnable element taps.

## Assertions and evidence

A successful interaction proves only that DevTools dispatched it. Establish every assertion with a read that returned the expected state: an element read, page data, a runtime read, or a screenshot whose returned path is reported. The absence of an error is not a pass, and a screenshot is evidence of the visible state, not a test result. Report each step with its exact project, page, selector or coordinates, and each assertion with the evidence that decided it.

## Failures

| Error | Handling |
| --- | --- |
| No project window, `PROJECT_PATH_NOT_FOUND`, `PROJECT_CONFIG_JSON_ERROR`, `APPID_ERROR` | Hand off to initializer; it owns the window and the project-config handoff |
| Timeout or element not found | Record the step and the current page, check the selector with `querySelectorAll`, then report; do not retry with ever longer waits |
| A touch without visible effect in a Mini Game | Check the coordinate space and the image size against the reference screenshot, take another screenshot, then hand the console to debugger |
| The wrong branch's operation was used | Stop and switch to the operations of the project's type; do not mix them |
| A permission dialog is denied in DevTools | Report it and stop; do not repeat the action |
| The symptom needs console or network attribution | Hand off to debugger with the steps, the selector or coordinates, and the screenshot paths |
| The page needs recompilation | Hand off to compiler: the page for a Mini Program, `simulator_refresh` for a Mini Game |
| A successful result naming a dropped flag in `warnings` | A read is corrected from `-h` and run again. An interaction, evaluation, ticket change or `remote` already took effect, so report the dropped flag and the effect that actually happened rather than repeating it |

Follow the CLI contract for other failures. After a timeout, an interruption or an unknown result of an interaction, observe the page state before considering a repeat; do not repeat an evaluation, ticket change or `remote` whose outcome is unknown.

## Confirmations and pending tasks

An operation that needs a permission inside DevTools, such as a test-account change or real-device debugging, can return `pending` with a `taskId`. Only login and client authorization are polled, so retain the task as [pending tasks](../../references/tasks.md) require, tell the user which confirmation remains, and keep the dependent steps blocked.

## Return

Return the project type, the steps run with their exact project, page, selector or coordinates, each assertion with the evidence that decided it and a pass or fail summary, what was left changed (page data set, a mock in place, a ticket changed, real-device debugging started, a generated script), any retained pending task, and remaining blockers. Hand off only to delivered entries in the capability index: project windows, login and AppIDs belong to initializer, recompilation and refresh to compiler, console, network, screenshot, wx API and cache evidence to debugger, previews and uploads to previewer, the project list to project-manager, and cloud environments, functions, database, storage and message push to cloudbase-operator, and installation diagnosis to installer.
