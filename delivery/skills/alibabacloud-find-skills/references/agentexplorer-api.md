# AgentExplorer HTTP requests

This reference owns the request shapes adopted from the retained upstream
revision. It is not a claim of live service compatibility.
Discovery uses the public AgentExplorer HTTP API, without Aliyun CLI flags,
credentials, or plugin setup.

Before invocation, read the shared
[command input and result contract](../../../policy/tool-contracts.md).
Use tool `curl` for the requests below.
Use the actual executable; in PowerShell use `curl.exe` to avoid the
`Invoke-WebRequest` alias.

## Request settings

Use `https://agentexplorer.aliyuncs.com` with the paths below.
Every request includes `--connect-timeout 10 --max-time 30` and both headers:

```text
User-Agent: AlibabaCloud-Agent-Skills/alibabacloud-find-skills
x-acs-version: 2026-03-17
```

Quote each input and pass query values through `--data-urlencode` with `-G`.
Keep remote tokens and user text as argument data, never interpolated shell code.
Apply the active shell's escaping rules when constructing literal arguments;
`--data-urlencode` encodes URL data after shell parsing and cannot repair quoting.
For values already held in Bash or PowerShell variables, pass them as a single
double-quoted argument, for example `--data-urlencode "nextToken=$token"`.
Use HTTP names such as `searchMode`, not CLI names such as `search-mode`.
The examples append an HTTP status line using `--write-out`; separate that line
from the JSON body before parsing, and retain the process exit status independently.
Apply [verification](verification-method.md) to each response before another step.

## Select the operation

| Operation | GET path | Query |
| --- | --- | --- |
| Intent or keyword match | `/openapi/for-agent/skills` | `keyword`, `searchMode=semantic`, `maxResults=20` |
| List categories | `/openapi/for-agent/categories` | None |
| List category members | `/openapi/for-agent/skills` | `categoryCode`, `maxResults=20`; omit keyword and semantic mode |
| Match within a selected category | `/openapi/for-agent/skills` | `keyword`, `categoryCode`, `searchMode=semantic`, `maxResults=20` |
| Inspect one skill | `/openapi/for-agent/skills/{skillName}` | None; encode the selected name as one URL path segment |

The retained reference specifies a default `maxResults` of 20 and maximum 100.
It also lists `skip`; prefer the returned `nextToken` for category pagination.
Keep the same category and page size and pass the returned token unchanged with
`--data-urlencode`. Continue only after validating the preceding response.

Resolve category codes from the categories response when needed.
`computing` and `database` are examples, not a current exhaustive catalog.
Use dot-form child codes such as `computing.ecs` only when supported for that
category. The retained API also describes comma-separated categories.
If child filtering is uncertain, inspect categories or use the product as a
semantic keyword; do not invent a category or claim unverified filter coverage.

## Bash-compatible examples

For macOS, Linux, WSL, and Git Bash:

```bash
curl -sS -G --connect-timeout 10 --max-time 30 \
  'https://agentexplorer.aliyuncs.com/openapi/for-agent/skills' \
  --data-urlencode 'keyword=ECS instance diagnosis' \
  --data-urlencode 'searchMode=semantic' \
  --data-urlencode 'maxResults=20' \
  -H 'User-Agent: AlibabaCloud-Agent-Skills/alibabacloud-find-skills' \
  -H 'x-acs-version: 2026-03-17' --write-out '\nHTTP_STATUS=%{http_code}\n'

curl -sS --connect-timeout 10 --max-time 30 \
  'https://agentexplorer.aliyuncs.com/openapi/for-agent/categories' \
  -H 'User-Agent: AlibabaCloud-Agent-Skills/alibabacloud-find-skills' \
  -H 'x-acs-version: 2026-03-17' --write-out '\nHTTP_STATUS=%{http_code}\n'

curl -sS -G --connect-timeout 10 --max-time 30 \
  'https://agentexplorer.aliyuncs.com/openapi/for-agent/skills' \
  --data-urlencode 'categoryCode=<confirmed-category>' \
  --data-urlencode 'maxResults=20' \
  -H 'User-Agent: AlibabaCloud-Agent-Skills/alibabacloud-find-skills' \
  -H 'x-acs-version: 2026-03-17' --write-out '\nHTTP_STATUS=%{http_code}\n'

curl -sS --connect-timeout 10 --max-time 30 \
  'https://agentexplorer.aliyuncs.com/openapi/for-agent/skills/<encoded-skill-name>' \
  -H 'User-Agent: AlibabaCloud-Agent-Skills/alibabacloud-find-skills' \
  -H 'x-acs-version: 2026-03-17' --write-out '\nHTTP_STATUS=%{http_code}\n'
```

For the next category page, add `--data-urlencode 'nextToken=<returned-token>'`
to the category command after substituting the exact parsed token.
For combined search, add `--data-urlencode 'categoryCode=<confirmed-category>'`
to the semantic command.
Preserve all common request settings in either case.

## PowerShell example

Run directly in PowerShell; no nested command string or Bash continuation is
needed. Replace only the endpoint and query arguments for the chosen operation.
This command shape is not a cmd.exe template; select PowerShell before using it.
Capture `$LASTEXITCODE` immediately after invocation.

```powershell
curl.exe -sS -G --connect-timeout 10 --max-time 30 'https://agentexplorer.aliyuncs.com/openapi/for-agent/skills' --data-urlencode 'keyword=ECS instance diagnosis' --data-urlencode 'searchMode=semantic' --data-urlencode 'maxResults=20' -H 'User-Agent: AlibabaCloud-Agent-Skills/alibabacloud-find-skills' -H 'x-acs-version: 2026-03-17' --write-out '\nHTTP_STATUS=%{http_code}\n'
```

If PowerShell reports alias parameter-binding errors, correct the invocation to
the actual executable. Do not install Aliyun CLI as a workaround.
