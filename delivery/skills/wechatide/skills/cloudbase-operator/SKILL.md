---
name: cloudbase-operator
description: >-
  Operate WeChat Mini Program or Mini Game cloud development on macOS: list cloud environments, read and deploy cloud functions, read and change cloud database collections and documents, read and manage cloud storage, and read and manage message-push subscriptions, always for an explicitly confirmed AppID and environment. Not local project configuration, compilation, diagnostics, preview, upload or page automation.
---

# Cloud development

Read the [handoff contract](../../references/capabilities.md), the [CLI contract](../../references/cli.md) and [pending tasks](../../references/tasks.md) before the first operation. Use this entry directly or receive it from the router. Read the [call executor](../../scripts/call.sh). Use tool `wechatide-call` for the operations below and complete the CLI contract's readiness check first.

These operations act on resources that live in WeChat's cloud, not on this machine, and they need no open project window. A deployed function, a dropped collection, a deleted file and a replaced subscription cannot be undone from here.

## AppID and environment

Every operation needs an AppID. Take it from the user's request, from an authorized fact already confirmed upstream, or, for `cloud_env_list`, `cloud_fn_list` and `cloud_fn_info` only, from `--project PATH`, which reads the AppID out of that project's own `project.config.json`. The other ten operations require `--appid` and accept no project path. Report a resolved AppID before any write uses it.

`--env` is a cloud environment ID. Take it only from the user, from an authorized confirmed fact, or from an ID that `cloud_env_list` returned for this AppID. Never guess an ID, never derive one from an environment's display name. Resolve the intended environment from the effective task authorization and verified project facts. Ask when that evidence leaves a business choice unresolved; a returned environment alone does not authorize writes. Reuse an already bound environment without asking again because it appeared in a new list.

When a function name, collection, cloud path or subscription is not already confirmed, read before writing: `cloud_fn_list` then `cloud_fn_info`, `cloud_db_read_struct` then `cloud_db_read_doc`, `cloud_query_storage --action list` or `info`, and `cloud_query_msg_push --action list`.

## Read operations

| Goal | Operation | Effect |
| --- | --- | --- |
| List environments | `cloud_env_list --appid APPID` | Read-only; `--project PATH` resolves the AppID instead |
| List functions | `cloud_fn_list --appid APPID --env ENV` | Read-only |
| Function detail and status | `cloud_fn_info --appid APPID --env ENV --names NAMES` | `--names` is one comma-separated string, not a JSON array |
| Collections and indexes | `cloud_db_read_struct --appid APPID --env ENV --action ACTION` | `listCollections`, `describeCollection`, `checkCollection`, `listIndexes` and `checkIndex`, with `--collection-name`, `--index-name`, `--limit` and `--offset` |
| Documents | `cloud_db_read_doc --appid APPID --env ENV --collection-name NAME` | Narrowed by `--query`, `--projection`, `--sort`, `--limit` and `--offset` |
| Storage | `cloud_query_storage --appid APPID --env ENV --action ACTION --cloud-path PATH` | `list`, `info`, `url` and `read`; `--max-age` sets the temporary link's lifetime |
| Message-push configuration | `cloud_query_msg_push --appid APPID --action ACTION` | `list` takes an optional `--env` to narrow it; `listSupportedEvents` needs no environment |

## Write operations

| Goal | Operation | Effect |
| --- | --- | --- |
| Deploy a function | `cloud_fn_deploy --appid APPID --env ENV --path DIR` | Replaces the whole function; the directory name is the function name and only one directory deploys at a time |
| Deploy one change | `cloud_fn_inc_deploy --appid APPID --env ENV --path DIR --file REL` | `--file` is relative to the function directory, not absolute |
| Change collections or indexes | `cloud_db_write_struct --appid APPID --env ENV --action ACTION --collection-name NAME` | `createCollection`, `updateCollection` with indexes in `--update-options`, and `deleteCollection` |
| Change documents | `cloud_db_write_doc --appid APPID --env ENV --action ACTION --collection-name NAME` | `insert` takes `--documents`, `update` takes `--query` and `--update`, `delete` takes `--query`; `--is-multi` and `--upsert` widen it |
| Change storage | `cloud_manage_storage --appid APPID --env ENV --action ACTION --cloud-path PATH` | `upload` and `delete` change the cloud; `upload` takes its source and `download` its destination in `--local-path` |
| Change message push | `cloud_manage_msg_push --appid APPID --env ENV --function-name NAME --action ACTION` | `subscribe`, `unsubscribe`, `setEnable` and `ensureCloudFunctionMode`; `--msg-type` selects the routing key and defaults to `event`, and `--event-types` narrows an event binding |

Object and array fields take inline JSON or an absolute `--FIELD-file` path: `--query-file`, `--projection-file`, `--sort-file`, `--documents-file`, `--update-file`, `--update-options-file` and `--event-types-file`. Prefer the file form, because a JSON literal has to survive shell quoting. The executor refuses `--args`, which no cloud operation defines. `--remote-npm-install`, `--is-multi`, `--upsert`, `--is-directory` and `--enable` are set by passing the flag alone. To pass one as false, write `--enable false` or `--enable=false`; `--no-enable` is not a defined flag, so DevTools drops it with a warning and runs with the default instead. Check flags with `OPERATION -h` before first use.

## Writes and confirmation

Bind each write to the exact AppID, environment, target and effect covered by the user's effective task or batch authorization. Carry that authorization through the covered writes and their required preparation and validation; do not ask again for each call. A grant for one write remains limited to that write. Ask for missing business choices or effects outside the grant, including uncovered destructive changes. Preserve action limits and unknown-outcome handling. When the user or DevTools declines a write, or a required confirmation times out, stop the dependent action and report; do not retry it.

`cloud_fn_deploy` replaces the whole function. Pass `--remote-npm-install` whenever the function has dependencies, because they install in the cloud, and its absence usually surfaces later as `Cannot find module` at runtime. `cloud_db_write_doc --action update` changes one document unless `--is-multi` is set. Prefer `$set`, `$inc` and `$unset` in `--update` over a replacement document, and never send `update` or `delete` with an empty `--query`. `cloud_db_write_struct --action deleteCollection` drops the collection and the data in it. `cloud_manage_storage --action delete --is-directory` removes every file under that prefix. List the prefix first, report what it holds, and verify that the authorized deletion covers the exact `--cloud-path` and its contents. Ask if that inspection reveals a wider deletion than the user authorized. `cloud_manage_storage --action upload` sends the `--local-path` file into the cloud, and `download` writes a cloud file to `--local-path` on this machine; check that writing to that location is authorized. `cloud_manage_msg_push` binds one cloud function per `(MsgType, Event)` pair, so a subscribe replaces whatever that pair pointed at. Its `ensureCloudFunctionMode` action moves the whole AppID back to cloud-function push, so a cloud-hosting service that was receiving every message stops receiving any: read the current `pushMode` first and report what the switch would stop. Read [message push](references/message-push.md) before configuring a subscription or a mode.

The `ensureContainerMode` and `setContainerCallback` actions of `cloud_manage_msg_push` are not used here. Container mode makes every cloud-function callback stop taking effect and needs a cloud-hosting service and path that no delivered entry owns. Report that goal as unavailable and name the DevTools cloud console instead.

## Temporary links

`cloud_query_storage --action url` and an upload result return a link that expires, `--max-age` seconds from now and 3600 by default. Use it inside the current task, say that it expires when reporting it, and never write it into source, documentation, a commit, memory or any durable record. A `publicUrl` or `note` in a result is not a permanent address either. The durable reference is the Mini Program's own FileID, `cloud://ENVID.BUCKETID/path`.

## Failures

| Error | Handling |
| --- | --- |
| The environment is unknown, or several came back | Run `cloud_env_list`, resolve the target from verified task context, and ask only if the intended environment remains ambiguous |
| The environment is not enabled, or the account lacks permission | Report that cloud development needs enabling on the WeChat platform, or an account with permission for this AppID; do not repeat the deploy |
| `PROJECT_PATH_NOT_FOUND`, `PROJECT_CONFIG_JSON_ERROR`, `APPID_ERROR` | Follow initializer's project handling; it owns the project-config handoff |
| The user declines a write, or its confirmation times out | Stop and report; do not retry the write |
| A deploy or a write partially succeeded | Keep the returned structure as it is, report which items succeeded and which failed, and do not re-run the whole operation to tidy it up |
| A message-push write reports a version conflict | Re-read with `cloud_query_msg_push --action list` and report the changed binding; ask if replacing that state exceeds the authorized effect, and resolve the failed attempt before any retry |
| Timeout, interruption, non-JSON output or an unknown result of a write | Report the outcome as unknown and read the same target back with its read operation before considering a repeat; never resend the write |
| A successful result naming a dropped flag in `warnings` | A read is corrected from `-h` and run again. A write already took effect, so report the dropped flag and what actually changed rather than repeating it |

Follow the CLI contract for other failures.

## Confirmations and pending tasks

A write can return `pending` with a `taskId` when a confirmation remains inside DevTools. Only login and client authorization are polled, so retain the task as [pending tasks](../../references/tasks.md) require, tell the user which confirmation to complete, and keep the dependent work blocked. Query the retained task before repeating the operation: a pending or successful original is not repeated, and a cancelled or expired one restarts only on the user's explicit request.

## Return

Return the exact AppID and environment ID, the operations run with their targets, what each read returned that the task needed, and what each write actually changed in the cloud. Report a partial result as partial, with its succeeded and failed items. Say which temporary links were used and that they expire. Report any retained pending task with the confirmation that remains, and remaining blockers. Hand off only to delivered entries in the capability index: `cloudfunctionRoot` and other local configuration belong to project-config, login, project windows and AppIDs to initializer, npm build and recompilation to compiler, console and network evidence for a failing cloud call to debugger, previews and trial uploads to previewer, the project list and code snippets to project-manager, and page or canvas automation to automator, and installation diagnosis to installer.
