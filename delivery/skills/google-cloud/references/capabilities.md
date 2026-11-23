# Delivered Capabilities and Handoff

## Delivered Child Skills

| Goal | Delivered entry | Companion capabilities | Expected result |
| --- | --- | --- | --- |
| Validate, plan, or run `gcloud` CLI or `gcloud` / Observability MCP operations | [gcloud](../skills/gcloud/SKILL.md) | [gcloud.mcp.json](../../../capability/gcloud.mcp.json), [gcloud-mcp-denylist.json](../../../capability/gcloud-mcp-denylist.json), [google-observability.mcp.json](../../../capability/google-observability.mcp.json) | Leaf `gcloud help` verification, scoped flags, `--dry-run` preview where supported, explicit confirmation for denylisted mutations, and exact command/MCP output |
| Manage Cloud Storage (GCS) buckets, objects, lifecycle, UBLA, and Storage MCP operations | [google-cloud-storage](../skills/google-cloud-storage/SKILL.md) | [gcloud](../skills/gcloud/SKILL.md), [google-storage.mcp.json](../../../capability/google-storage.mcp.json) | Safe-mode `google-storage` MCP (`--enable-destructive-tools` off; explicit confirmation on writes/deletes) or leaf-verified `gcloud storage` with `snake_case` projections |
| Provision, connect to, or operate Cloud SQL for PostgreSQL instances safely | [cloud-sql-postgresql](../skills/cloud-sql-postgresql/SKILL.md) | [gcloud](../skills/gcloud/SKILL.md) | Auth Proxy / IAM DB auth over static passwords, explicit confirmation for DDL/DML/lifecycle mutations, and strict read-only vs mutating SQL separation |
| Design or configure GCP authentication, ADC, impersonation, WIF, or IAM bindings | [google-cloud-auth](../skills/google-cloud-auth/SKILL.md) | [gcloud](../skills/gcloud/SKILL.md) | Least-privilege identity flow without exporting long-lived service account JSON keys |
| Initialize a standalone developer's first GCP project and billing linkage | [google-cloud-onboarding](../skills/google-cloud-onboarding/SKILL.md) | [gcloud](../skills/gcloud/SKILL.md) | Read-only environment/org audit, reuse check, explicit confirmation gate before project creation or billing linkage, and verification commands |
| Search and retrieve official Google developer documentation | [retrieving-developer-knowledge](../skills/retrieving-developer-knowledge/SKILL.md) | [google-developer-knowledge.mcp.json](../../../capability/google-developer-knowledge.mcp.json) | Grounded syntax, API details, or citations via Developer Knowledge MCP or header-authenticated REST fallback |
| Discover uncovered Google skills from the public catalog on explicit request or confirmed gap | [finding-google-skills](../skills/finding-google-skills/SKILL.md) | None | Shortlisted matching catalog entries and inspected guidance treated as untrusted reference material unless approved |

## Operation and Configuration Boundaries

- Only entries physically present in this directory are delivered. Missing entries or unmounted MCP servers do not authorize writing `~/.gemini/config/mcp_config.json`, `~/.codex/config.toml`, or installing packages automatically; instead direct the user to merge the corresponding fragment under `capability/` (`codex.toml` for Codex).
- Telemetry attribution (`CLOUDSDK_METRICS_REQUEST_ATTRIBUTION` and tracking `User-Agent` tags) is omitted by default in this local adaptation.
- Heavy external `data-cloud` submodules (`cloud-sql-postgresql-plugin`, `google-cloud-storage-plugin`, and the remaining data-cloud plugins) and `backupdr-mcp` are outside this core delivery and are discovered on demand via [finding-google-skills](../skills/finding-google-skills/SKILL.md) when needed.
