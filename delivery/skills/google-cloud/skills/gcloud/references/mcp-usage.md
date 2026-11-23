# Google Cloud MCP Server Usage

Read the [gcloud CLI contract](../SKILL.md) before invoking any MCP operation. Both local stdio MCP servers and the Google-hosted remote Cloud CLI MCP server still follow all `gcloud` denylist, data-reduction, and confirmation boundaries.

## 1. Local `gcloud` and Observability MCP Servers (Recommended)

The official `googleapis/gcloud-mcp` packages are currently **Preview** and require Node.js `>=20` plus authenticated local `gcloud` / ADC credentials (and a quota project where required). Never write product MCP configs yourself; if unmounted, direct the user to merge the repository's zero-secret capability fragments:

- **Local `gcloud` MCP (`@google-cloud/gcloud-mcp@0.5.3`)**:
  - Merge [gcloud.mcp.json](../../../../../capability/gcloud.mcp.json) or uncomment `[mcp_servers.gcloud]` in `capability/codex.toml` (`run_gcloud_command` defaults to `approval_mode = "prompt"`).
  - Upstream's built-in `default_deny` only blocks 10 interactive SSH/meta commands and does **not** block `delete`, `iam`, resource-scoped IAM bindings, `billing`, `kms`, or `organizations`. Pass `-c` with the **absolute** physical path to [gcloud-mcp-denylist.json](../../../../../capability/gcloud-mcp-denylist.json) in your personal config to enforce prefix-based denial of top-level `iam`, common resource-scoped IAM/org-policy mutations (`projects`, `resource-manager folders`, `storage buckets`, `secrets`, `run`, `functions`, `pubsub`, `artifacts repositories`, `compute instances`, `iap`), `billing`, `kms`, `organizations`, and core deletions (`gcloud-mcp` normalizes prefixes without `*` wildcards and automatically covers `alpha`/`beta`/`preview` tracks for GA entries). Because `gcloud` spans too many service groups for any denylist to be exhaustive, treat `gcloud-mcp-denylist.json` strictly as defense-in-depth and **never** pair it with auto-approved `run_gcloud_command`: keep per-call client confirmation enabled across every client (or use a strict read-only `"allow"` allowlist config in `-c` instead of `"deny"` for unattended read-only execution).
- **Local Observability MCP (`@google-cloud/observability-mcp@0.2.3`)**:
  - Merge [google-observability.mcp.json](../../../../../capability/google-observability.mcp.json) or uncomment `[mcp_servers.google-observability]` in `capability/codex.toml`.
  - Exposes 12 strictly read-only Cloud Logging, Monitoring, Trace, and Error Reporting tools (`list_log_entries`, `list_log_names`, `list_buckets`, `list_views`, `list_sinks`, `list_log_scopes`, `list_metric_descriptors`, `list_time_series`, `list_alert_policies`, `list_traces`, `get_trace`, `list_group_stats`).

## 2. Hosted Remote Cloud CLI MCP (`cloudcli.googleapis.com/mcp`)

Where a client supports `authProviderType: "google_credentials"` against Google's hosted Cloud CLI Execution API:

- **Endpoint**: `https://cloudcli.googleapis.com/mcp` (Streamable HTTP, tool `run_gcloud_command`).
- **Prerequisites**: Target project must have `cloudcli.googleapis.com` enabled and caller must hold `roles/mcp.toolUser` plus downstream resource IAM roles (missing either yields HTTP `403`).
- **Parameters**:
  - `project`: `"projects/<API_HOST_PROJECT>"` for API quota/billing only.
  - `command`: Must still include explicit `--project=<RESOURCE_PROJECT>` (or `--billing-project`) and `--quiet` / data-reduction flags.
  - `input_files`: Optional `[{"path": "...", "contents": "..."}]`.
- **Response Authority**: `exit_code === 0` is the authoritative success signal (`gcloud` frequently writes normal status updates to `stderr`). Check both `stdout` and `stderr` on nonzero exit.
- **Unsupported Groups**: Local auth/config commands (`gcloud auth`, `gcloud config`, `gcloud init`, `gcloud iam service-accounts`, interactive `ssh`) do not work in the remote sandbox.
