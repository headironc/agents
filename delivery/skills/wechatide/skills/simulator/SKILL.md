---
name: simulator
description: >-
  Control the WeChat DevTools simulator toolbar on macOS: query available devices, switch simulator device, toggle simulator dark or light mode, and pop the simulator into a standalone window. Excludes compilation, refresh, screenshots, logs, and page automation.
---

# Simulator toolbar controls

Read the [handoff contract](../../references/capabilities.md), the [CLI contract](../../references/cli.md) and [pending tasks](../../references/tasks.md) before the first operation. Use this entry directly or receive it from the router. Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for the operations below and complete the CLI contract's readiness check first.

All operations require `--project PATH` pointing to an existing local project root. Check flags with `OPERATION -h` before first use.

## Operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Query current and available devices | `simulator_get_device --project PATH` | Read-only; returns the active device and toolbar device list with `os` |
| Switch simulator device | `simulator_set_device --project PATH --device NAME` | Changes the active simulator device immediately |
| Set simulator theme | `simulator_set_darkmode --project PATH --mode MODE` | Applies `dark` or `light` mode to a Mini Program simulator |
| Pop out the simulator window | `simulator_popup --project PATH` | Detaches the simulator into a standalone window |

`simulator_get_device`, `simulator_set_device`, and `simulator_set_darkmode` open a project window automatically when none is open. `simulator_popup` opens a `fullMode` window when closed and detaches the simulator.

## Device selection and OS

Read `devices[].os` from `simulator_get_device` to distinguish iOS and Android devices instead of inferring OS from device names. Pass an exact `devices[].name` value (such as `"iPhone 15"`) to `simulator_set_device --device`.

When `simulator_set_device` fails with an unknown device, DevTools returns `success: false` and the `devices` list without changing the simulator. Select a valid `devices[].name` and retry at most once instead of guessing device names repeatedly.

## Dark mode and Mini Games

Pass `--mode dark` or `--mode light` to `simulator_set_darkmode`. Mini Games do not support simulator dark mode and fail with `小游戏不支持模拟器暗黑模式`. Report that limitation and stop without retrying or modifying `darkmode` in `game.json`. Mini Game device switching and simulator popup remain supported.

## Popping out the simulator

When the simulator is already popped out, `simulator_popup` returns `already: true`; do not call it again.

An already-open `liteMode` project window cannot switch to `fullMode`, so `simulator_popup` returns `success: false` there. Hand off to `initializer` to run `close_project_window --project PATH` first, then run `simulator_popup --project PATH` instead of reopening with default `open_project_window`. If `simulator_popup` returns `success: false` because the popup button is disabled in the current layout, report the returned reason without changing the window layout or retrying repeatedly.

## Boundaries and failures

Rotation, zoom, network throttling, and Home or Back navigation are outside this entry. Never call `simulator_screenshot` from here; hand off to `debugger` for screenshots or `compiler` to recompile or open a page after switching devices or themes.

For `PROJECT_PATH_NOT_FOUND`, `PROJECT_CONFIG_JSON_ERROR`, or `APPID_ERROR`, follow `initializer`'s project-window handling. If a result names a dropped flag in `warnings`: `simulator_get_device` is read-only, so fix the flag from `-h` and rerun; the other three operations change simulator or window state, so report the dropped flag and actual effect without repeating automatically. After a timeout, interruption, or unknown result from `simulator_set_device`, `simulator_set_darkmode`, or `simulator_popup`, observe the current simulator or window state before considering a repeat rather than resending blindly.

## Return

Return the operations run, the exact project, the active or available devices with their `os`, the theme mode or popup state (`already` when already detached), any handoff to `initializer`, `compiler`, or `debugger`, and remaining blockers.
