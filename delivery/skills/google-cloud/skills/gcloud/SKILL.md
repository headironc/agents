---
name: gcloud
description: >-
  Safety-critical validation, guardrails, and data reduction for gcloud CLI and
  gcloud MCP operations across Google Cloud Platform services. Use when
  planning, constructing, validating, describing, or executing gcloud CLI
  commands. Skip for client library code or raw REST/gRPC API requests without
  gcloud.
license: Apache-2.0
---

# gcloud CLI and MCP Contract

Contract subject: `gcloud`.

This contract governs every `gcloud` CLI invocation and `run_gcloud_command` MCP call across all delivered Google Cloud skills. Read-only inspection and documentation lookup do not authorize creating, modifying, enabling, or deleting cloud resources.

## Mandatory Pre-Conditions

1. **Leaf-Level Syntax Validation**: Always inspect `gcloud help <leaf_command>` (for example `gcloud help compute instances create` or `gcloud help sql instances describe`) before proposing flags or executing a command, unless the user explicitly supplied current `gcloud help` output or instructed not to execute commands. Parent group help is not transitive; never invent flags from memory or web search.
2. **Preserve User Targets**: Preserve user-specified flags including `--project=<PROJECT_ID>`, `--region`, `--zone`, and `--location` verbatim unless fixing an explicitly verified syntax error.
3. **Preview Before Mutation**: Whenever the leaf command's help lists `--dry-run` or `--validate-only`, run or propose the preview step before any live mutation.
4. **No Implicit Installation**: Never install the `gcloud` CLI or run `gcloud components install` / `gcloud components update` autonomously. If `gcloud` is missing, report the absence and ask for explicit user confirmation before any setup action.
5. **Telemetry Opt-Out**: Do not inject `CLOUDSDK_METRICS_REQUEST_ATTRIBUTION` or tracking `User-Agent` suffixes by default unless the user explicitly requests usage attribution.

## Data Reduction and Execution Hygiene

- **No Blind Lists**: Every `list` command must include at least one data-reduction flag (`--limit`, `--filter`, or `--format`). When discovering an unfamiliar schema, inspect one item first: `gcloud <GROUP> <RESOURCE> list --limit=1 --format=json`.
- **Single Command Execution**: Execute one `gcloud` command per invocation without chaining (`&&`, `;`), pipes (`|`), command substitution (`$(...)`), or redirection (`>`, `<`) so commands stay reviewable and bounded.
- **Non-Interactive Flag**: Include `--quiet` (`-q`) on commands that might prompt for TTY confirmation so headless sessions fail cleanly instead of hanging.
- **Explicit Scope**: Pass `--project=<PROJECT_ID>` (or `--billing-project` where applicable) and required regional/zonal flags explicitly rather than relying on mutable local defaults.
- **Long-Running Operations**: Prefer `--async` when supported by slow provisioning/mutation operations, then inspect the returned operation with `gcloud <GROUP> operations describe <OPERATION_ID>`.

## Prohibited Autonomous Operations (Denylist)

Never execute the following operations without explicit human authorization covering the target resource and effect:

- **IAM policy, role, or binding changes** (risk of privilege escalation or lockout).
- **API enablement or disablement** (`gcloud services enable` / `disable` — risk of unexpected billing or service disruption).
- **Resource deletion** (`gcloud * delete`, `secrets versions destroy`, `storage rm`).
- **Billing changes** (`gcloud billing *`).
- **Organization-level changes** (`gcloud organizations *`).
- **Encryption key management** (`gcloud kms *`).
- **Infrastructure Manager apply/delete** (`gcloud infra-manager deployments apply` / `delete`).
- **CLI installation or component modification** (`gcloud components *`).

## References

- [CLI Usage](references/cli-usage.md): Installation boundaries, authentication methods, service account impersonation, and local configurations.
- [MCP Usage](references/mcp-usage.md): Local `@google-cloud/gcloud-mcp`, prefix denylist, `@google-cloud/observability-mcp`, and remote `cloudcli.googleapis.com/mcp`.
