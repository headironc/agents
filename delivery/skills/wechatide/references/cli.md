# DevTools CLI contract

Contract subject: `wechatide`.

The `wechatide` command inside a WeChat DevTools application bundle sends one
registered operation to the running DevTools through its local MCP endpoint.
This delivery supports macOS only. Its invocation, token and result shapes were
read from the CLI source of DevTools Nightly 2.02.2609162, whose bundled skill
reports version 0.3.11, and re-checked byte for byte against Nightly
2.02.2609182. Only client authorization and the readiness check below have been
observed against those installations.

## Invocation

Read the [call executor](../scripts/call.sh). Use tool `wechatide-call` for
every operation instead of running `wechatide` directly:

```bash
bash SKILL_ROOT/scripts/call.sh CLIENT OPERATION [FLAG...]
```

SKILL_ROOT is the physical directory of the installed wechatide skill.
CLIENT is `ClaudeCode` in Claude Code and `Codex` in Codex. Keep it unchanged,
because DevTools authorizes each client name separately.
OPERATION must be listed for a delivered entry in the
[capability index](capabilities.md); the executor refuses other operations,
including the MCP bridge and deprecated project_setting operations.
The CLI also resolves a table of legacy and shorthand aliases, such as
`miniprogram_upload` for `upload` or `env_list` for `cloud_env_list`. The
executor matches the literal argument before the CLI resolves an alias, so an
alias is refused as an undelivered operation even when its target is
delivered. Always pass the registered operation ID.
Check flags with `OPERATION -h` before first use and do not invent parameters.
Use absolute local paths, except where the owning entry defines a flag as
relative to a project root. Object and array flags accept JSON, or an absolute
`--FIELD-file` path when the operation's help lists one.

Run the executor where it can reach local desktop applications and
127.0.0.1. If the host sandbox prevents that, request the host's approval for
unsandboxed execution; a denial stops the operation.

## MCP token

DevTools rejects a business operation that carries no MCP token. The executor
reads the token for every operation except `auth` and `-h`, from the login
keychain item with service
`wechatide-mcp-token` and the current account, then passes it only to the
DevTools CLI resolved inside an application bundle.

The Human copies the MCP configuration in DevTools Settings → Security and
stores or replaces the token value with this interactive command, which keeps
it out of shell history and the conversation:

```bash
security add-generic-password -U -s wechatide-mcp-token -a "$(id -un)" -w
```

Never ask for the token in chat, search DevTools files for it, print the
keychain item, or save it in a repository, memory or log.
Any process of the same user that runs `security` can read this item, and the
token is visible in the DevTools CLI process arguments while it runs.

The CLI access token is a separate optional DevTools setting. When a result
reports `cliTokenRequired` or `tokenRequired` as true, this delivery does not
support the operation: stop dependent DevTools work and report it.

## Results and failures

The executor itself refuses with `wechatide-call: CODE` on stderr and does not
contact DevTools:

| Exit | Codes | Handling |
| --- | --- | --- |
| 2 | `usage`, `unsupported-client`, `undelivered-operation`, `reserved-option` | Correct the invocation or report the unavailable capability |
| 3 | `unsupported-platform`, `cli-unavailable`, `cli-unbound` | Hand off to installer, which diagnoses the installation; downloading, installing and PATH repair remain the Human's |
| 3 | `mcp-token-unavailable`, `mcp-token-invalid` | Ask the Human to store or replace the keychain item as above |

Otherwise the CLI's JSON stdout and exit status pass through. Success exits 0
with `ok: true` and `result`; failure exits 1 with `ok: false`, `errorType`,
`message` and optional `reason`, `code` and `suggestions`.
A flag the operation does not define is dropped instead of refused, together
with its separated value, and named in `warnings`. Treat each warning as an
argument that did not reach the operation: correct it from `-h` and run the
operation again rather than accepting the result. A `no-` prefixed negation of
a boolean flag is dropped this way too, because only the names `-h` prints are
defined; pass `--FLAG false` or `--FLAG=false` to set one explicitly false.
Check the returned tool and required fields before using a result.
A result whose status is `pending` with a `taskId` is not completion; follow
[pending tasks](tasks.md).
Report only the fields needed for the task; do not paste raw results wholesale.

| errorType | Handling |
| --- | --- |
| `INPUT_ERROR` | Correct flags only from `-h` and confirmed inputs |
| `CONNECT_ERROR`, `MCP_INIT_ERROR` | The CLI starts DevTools and requests client authorization itself; a returned authorization task follows pending tasks, and a failure is reported |
| `AUTH_ERROR`, `AUTH_DENIED` | The Human must authorize this client in DevTools; run `auth` again only on request |
| `MCP_TOKEN_AUTH_ERROR` | For `mcp_token_required` or `mcp_token_invalid`, ask the Human to recopy the MCP configuration and replace the keychain item |
| `CLI_TOKEN_AUTH_ERROR` | Unsupported CLI access token; stop |
| `MCP_TOOL_ERROR` | Report reason, code and message; the owning entry handles project errors |
| `AUTH_TASK_ERROR`, other or non-JSON output | The outcome is unknown; report it |

After a timeout, interruption, non-JSON output or unknown result from an
operation with effects, do not repeat it. Observe the state first, for example
with a status check, and follow the owning entry's recovery.

## Readiness

Before the first other operation in a session, run:

```text
check_wechatide_status --skill-version VERSION
```

VERSION is `metadata.version` from the loaded wechatide SKILL.md. Handle the
result in this order:

| Result | Handling |
| --- | --- |
| `versionRelation: skip_check` | Run again with the version |
| `versionRelation: agent_behind` | Stop dependent work and report that the repository skill needs an update and reinstallation |
| `versionRelation: agent_ahead` | Record the compatibility risk and continue |
| `versionRelation: equal` | Continue |
| `loginExpired: true` | Log in through initializer, then check again |
| `success: false` with `loginExpired: false` | A transient status failure, not login expiry; report it and check again later |
| `cliTokenRequired` or `tokenRequired` true | Unsupported, as above |

The returned `skillPath` is read-only upstream input. Never copy it over an
installed skill or write inside the DevTools application.
Reuse one successful check for the session; later entries do not repeat it.
An equal version does not prove identical instructions, because DevTools can
change its bundled skill without changing that version.
