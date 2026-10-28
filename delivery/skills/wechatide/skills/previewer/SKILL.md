---
name: previewer
description: >-
  Preview and publish a WeChat Mini Program or Mini Game on macOS: push a
  preview to the developer's WeChat, create a preview QR code, or upload the
  code package as a trial version when the user explicitly asks for it.
  Not compilation, diagnostics, page automation or cloud operations.
---

# Preview and upload

Read the [handoff contract](../../references/capabilities.md), the
[CLI contract](../../references/cli.md) and
[pending tasks](../../references/tasks.md) before the first operation.
Use this entry directly or receive it from the router.
Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for
the operations below and complete the CLI contract's readiness check first.

These operations act on the project's current code and need a logged-in
developer account, not an open project window. Login and windows belong to
initializer.
DevTools runs the project's own `scripts.beforePreview` and `scripts.beforeUpload`
commands on this machine before these operations, so a preview or upload can
execute local shell commands this entry never reads. Those fields belong to
project-config; report what the configuration would run when the user needs to
know, and do not edit them to change what runs.

## Operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Preview on the developer's phone | `auto_preview --project PATH` | Pushes the preview into the developer's WeChat; writes no QR code file |
| Preview QR code | `create_preview_qrcode --project PATH --qr-format window` | Returns a scannable preview QR code, shown in a new window |
| Publish a trial version | `upload --project PATH --upload-version VERSION` | Uploads the code package as that version's trial build |

`--page-path`, `--query` and `--scene` select the previewed page, its parameters
and its scene value for both preview operations. The page path is a route inside
the project, such as `pages/index/index`, not the absolute `--project` path.
`--desc` records the uploaded version's note.
Pass no local output path to `auto_preview`. When the user asked for a QR code
file, use `create_preview_qrcode --qr-output` instead and check that writing
there is authorized.
Check flags with `OPERATION -h` before first use.

## Upload

`upload` sends the code package to WeChat as the trial version, so it publishes
the project rather than previewing it. Run it only when the user explicitly asks
to upload the code or publish a trial version, and treat that request as its
authorization for the exact project and version.
`--upload-version` is required. Take it from the user's request or an authorized
project fact; do not invent a version number or reuse an earlier one.
A declined upload or a cancelled confirmation ends the request: report it and do
not upload again unasked.

## Confirmations and pending tasks

A preview or an upload returns `pending` with a `taskId` when a confirmation
remains inside DevTools. Only login and client authorization are polled, so
retain the task as [pending tasks](../../references/tasks.md) require, tell the
user which confirmation to complete in DevTools, and keep the dependent work
blocked. Do not poll it and do not treat the returned task as a finished
preview or a published trial version.

Before running the same operation again, query the retained `taskId` and follow
the status it returns: a pending or successful original is not repeated, and a
cancelled or expired one restarts only on the user's explicit request. After a
timeout, an interruption or an unknown result, report the outcome as unknown
instead of resending; an upload that already reached WeChat cannot be withdrawn
by repeating it.

## Failures

| Error | Handling |
| --- | --- |
| `PROJECT_PATH_NOT_FOUND`, `PROJECT_CONFIG_JSON_ERROR`, `APPID_ERROR` | Follow initializer's project-window handling; it owns the project-config handoff |
| Permission or account failure | Report that the account needs developer permission for this AppID, or log in again through initializer; do not retry the same call in a loop |
| The user declines the upload or cancels its confirmation | Report it and stop; do not start another upload |
| Timeout or unknown outcome | Report it as unknown and check the retained task before considering a repeat |
| A successful result naming a dropped flag in `warnings` | An upload has already published: report the dropped flag and the version that actually reached WeChat rather than running it again, as the CLI contract's correction rule would. A QR code is only rendered here, so correct the flag from `-h` and create it again. A pushed preview already reached the developer's WeChat, so say that before correcting the flag and pushing once more |
| The preview arrives but shows stale or wrong content | Hand the project and page to compiler for a refresh, then to debugger for evidence |

## Return

Return the operations run, the exact project, the previewed page with its query
and scene, the uploaded version and description, any retained pending task with
the confirmation that remains, and remaining blockers.
State whether the code left this machine: a pushed preview or a QR code reaches
the developer's own WeChat, while an upload publishes the trial version. A
returned QR code proves neither that the user scanned it nor that the previewed
build is correct.
Hand off only to delivered entries in the capability index: login, project
windows and AppIDs belong to initializer, a refresh, recompilation or npm build
to compiler, console, network, screenshot, wx API and cache evidence to
debugger, the project list and code snippets to project-manager, page or
canvas automation to automator, and cloud environments, functions, database,
storage and message push to cloudbase-operator, and installation diagnosis to
installer.
