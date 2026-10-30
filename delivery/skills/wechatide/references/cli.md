# DevTools CLI contract

Contract subject: `wechatide`.

The `wechatide` command inside a WeChat DevTools application bundle sends one registered operation to the running DevTools through its local MCP endpoint. This delivery supports macOS only. Its current authentication contract was checked against DevTools 2.02.2610302 and bundled skill 0.3.15. The CLI uses the skill-call route with optional CLI-token authentication; the MCP bridge uses a separate authentication route. Earlier live evidence covers only client authorization and readiness, not business operations. Source identities and compatibility limits are recorded in the repository's source record.

## Invocation

Read the [call executor](../scripts/call.sh). Use tool `wechatide-call` for every operation instead of running `wechatide` directly:

```bash
bash SKILL_ROOT/scripts/call.sh CLIENT OPERATION [FLAG...]
```

SKILL_ROOT is the physical directory of the installed wechatide skill. CLIENT is `ClaudeCode` in Claude Code and `Codex` in Codex. Keep it unchanged, because DevTools authorizes each client name separately. OPERATION must be listed for a delivered entry in the [capability index](capabilities.md); the executor refuses other operations, including the MCP bridge and deprecated project_setting operations. The CLI also resolves a table of legacy and shorthand aliases, such as `miniprogram_upload` for `upload` or `env_list` for `cloud_env_list`. The executor matches the literal argument before the CLI resolves an alias, so an alias is refused as an undelivered operation even when its target is delivered. Always pass the registered operation ID. Check flags with `OPERATION -h` before first use and do not invent parameters. Use absolute local paths, except where the owning entry defines a flag as relative to a project root. Object and array flags accept JSON, or an absolute `--FIELD-file` path when the operation's help lists one.

Run the executor where it can reach local desktop applications and 127.0.0.1. If the host sandbox prevents that, request the host's approval for unsandboxed execution; a denial stops the operation.

## Authentication

The executor neither reads the keychain nor passes a token. DevTools permits skill-call without a token when its optional CLI access token is disabled. Keep the fixed client name and complete DevTools client authorization; the absence of token authentication does not bypass that authorization.

When a result reports `cliTokenRequired` or `tokenRequired` as true, or returns `CLI_TOKEN_AUTH_ERROR`, stop dependent DevTools work and report unsupported CLI token authentication. Never ask for, remember, save or inject a token, or change the application's security settings to continue.

An `MCP_TOKEN_AUTH_ERROR` on this route is a routing or compatibility failure, including when an older DevTools requires an MCP token. Stop and report the failure. Do not restore keychain-token authentication, switch to the MCP bridge or another entry, or upgrade DevTools automatically. Existing keychain items are outside this executor's ownership; leave them unchanged.

## Results and failures

The executor itself refuses with `wechatide-call: CODE` on stderr and does not contact DevTools:

| Exit | Codes | Handling |
| --- | --- | --- |
| 2 | `usage`, `unsupported-client`, `undelivered-operation`, `reserved-option` | Correct the invocation or report the unavailable capability |
| 3 | `unsupported-platform`, `cli-unavailable`, `cli-unbound` | Hand off to installer, which diagnoses the installation; downloading, installing and PATH repair remain the Human's |

Otherwise the CLI's JSON stdout and exit status pass through. Success exits 0 with `ok: true` and `result`; failure exits 1 with `ok: false`, `errorType`, `message` and optional `reason`, `code` and `suggestions`. A flag the operation does not define is dropped instead of refused, together with its separated value, and named in `warnings`. Treat each warning as an argument that did not reach the operation: correct it from `-h` and run the operation again rather than accepting the result. A `no-` prefixed negation of a boolean flag is dropped this way too, because only the names `-h` prints are defined; pass `--FLAG false` or `--FLAG=false` to set one explicitly false. Check the returned tool and required fields before using a result. A result whose status is `pending` with a `taskId` is not completion; follow [pending tasks](tasks.md). Report only the fields needed for the task; do not paste raw results wholesale.

| errorType | Handling |
| --- | --- |
| `INPUT_ERROR` | Correct flags only from `-h` and confirmed inputs |
| `CONNECT_ERROR`, `MCP_INIT_ERROR` | The CLI starts DevTools and requests client authorization itself; a returned authorization task follows pending tasks, and a failure is reported |
| `AUTH_ERROR`, `AUTH_DENIED` | The Human must authorize this client in DevTools; run `auth` again only on request |
| `MCP_TOKEN_AUTH_ERROR` | Routing or compatibility failure; stop without token storage, fallback or retry |
| `CLI_TOKEN_AUTH_ERROR` | Unsupported CLI access token; stop |
| `MCP_TOOL_ERROR` | Report reason, code and message; the owning entry handles project errors |
| `AUTH_TASK_ERROR`, other or non-JSON output | The outcome is unknown; report it |

After a timeout, interruption, non-JSON output or unknown result from an operation with effects, do not repeat it. Observe the state first, for example with a status check, and follow the owning entry's recovery.

## Readiness

Before the first other operation in a session, run:

```text
check_wechatide_status --skill-version VERSION
```

VERSION is `metadata.version` from the loaded wechatide SKILL.md. Handle the result against every applicable row before continuing. A version relation alone never overrides a token, login or status failure:

| Result | Handling |
| --- | --- |
| `versionRelation: skip_check` | Stop dependent work; the required version comparison was not performed |
| `versionRelation: agent_behind` | Stop dependent work and report that the repository skill needs an update and reinstallation |
| `versionRelation: agent_ahead` | Record the compatibility risk; continue only if the other readiness conditions pass |
| `versionRelation: equal` | Continue only if the other readiness conditions pass; this is not behavior acceptance |
| `loginExpired: true` | Log in through initializer, then check again |
| `success: false` with `loginExpired: false` | A transient status failure, not login expiry; report it and check again later |
| `cliTokenRequired` or `tokenRequired` true | Unsupported, as above |

The returned `skillPath` is read-only upstream input. Never copy it over an installed skill or write inside the DevTools application. Reuse one successful check for the session; later entries do not repeat it. An equal version does not prove identical instructions, because DevTools can change its bundled skill without changing that version.
