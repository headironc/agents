---
name: google-cloud-storage
description: >-
  Manage Cloud Storage (GCS) buckets and objects on Google Cloud, covering
  storage classes, uniform bucket-level access, public access prevention,
  lifecycle rules, soft delete, IAM, gcloud storage safety, and Storage MCP
  safe-mode boundaries. Skip for Persistent Disk block storage, BigQuery, or
  Cloud SQL / Spanner databases.
license: Apache-2.0
metadata:
  maintenance: local-adaptation
  upstream-repository: https://github.com/google/skills
  upstream-path: skills/cloud/google-cloud-storage-basics
---

# Google Cloud Storage

Adapted from Google's `google-cloud-storage-basics` skill. Telemetry attribution (`CLOUDSDK_METRICS_ENVIRONMENT` and tracking `User-Agent` tags) is omitted by default in this local adaptation.

## Tool Execution and MCP Boundaries

When a Storage MCP server is already mounted in the client and covers the operation, prefer its structured tools over ad hoc shell commands; otherwise use `gcloud storage`. Never edit `~/.gemini/config/mcp_config.json`, `~/.codex/config.toml`, or install plugins automatically:

- **Companion Safe-Mode Local MCP (`@google-cloud/storage-mcp@0.6.0`)**: Defined by the repository's zero-secret [google-storage fragment](../../../../capability/google-storage.mcp.json) and `[mcp_servers.google-storage]` in `capability/codex.toml`.
  - Run in safe mode without `--enable-destructive-tools` by default.
  - Keep read-only bucket/object inspection separate from mutations: Codex marks the 4 safe-mode create/write tools (`create_bucket`, `write_object_new`, `upload_object_new`, `copy_object_new`) with `approval_mode = "prompt"`.
  - Across all clients (Codex, DeepSeek Harness, Antigravity), stop and obtain explicit user confirmation naming the target project, bucket, and `gs://` object key before creating buckets, overwriting/moving/deleting objects or buckets, changing bucket IAM policies, or enabling `--enable-destructive-tools`.
- **Hosted Remote MCP (`https://storage.googleapis.com/storage/mcp`) or Local MCP Toolbox (`cloud-storage`)**:
  - Remote MCP caps `read_object` and `write_text` at 8 MiB (text/PDF/image reads, text writes) and enforces OAuth (`roles/mcp.toolUser` plus `roles/storage.*`) with optional Model Armor and IAM deny policies.
  - Local `@toolbox-sdk/server` `cloud-storage` handles larger/binary `download_object` / `upload_object` and requires `CLOUD_STORAGE_PROJECT` (it does not fall back to `GOOGLE_CLOUD_PROJECT`); use ADC via `gcloud auth application-default login` rather than exported service account JSON keys.
- **Unmounted MCP Hint**: If no Storage MCP is mounted and `gcloud storage` suffices, proceed with `gcloud storage` without blocking workflow; you may point once to the repository `capability/` fragment when interactive object work is frequent.

## `gcloud storage` CLI Safety

Read [the gcloud CLI contract](../gcloud/SKILL.md) before inspecting or running CLI commands. Use tool `gcloud` only within explicitly authorized boundaries.

- **Leaf Help and Explicit Scope**: Validate flags with `gcloud help <leaf_command>` (for example `gcloud help storage buckets create`) and pass `--project=<PROJECT_ID>` and `--quiet` explicitly.
- **Data Reduction and `snake_case` Projections**: Bound listing output with `--limit` or prefix filters (`gcloud storage ls --project=<PROJECT_ID> gs://<BUCKET>/<PREFIX>`). Note that `gcloud storage` output fields use `snake_case`, not JSON-API camelCase—project `--format="json(soft_delete_policy,versioning_enabled,retention_policy)"` rather than `softDeletePolicy`.
- **Secure Defaults**: Enforce Uniform Bucket-Level Access (`--uniform-bucket-level-access`), Public Access Prevention (`--public-access-prevention`), explicit regional `--location`, and appropriate storage class (`STANDARD`, `NEARLINE`, `COLDLINE`, `ARCHIVE`) with lifecycle and soft-delete policies instead of legacy ACLs.
- **Destructive and Billing Confirmation Gates**: Explicitly confirm with the user (naming exact buckets/prefixes) before running `gcloud services enable storage.googleapis.com`, `gcloud storage rm`, `gcloud storage buckets delete`, `gcloud storage rsync --delete-unmatched-destination-objects`, or IAM binding mutations, and never expose credentials or private signed URLs in output.

## On-Demand Specialized Workflows

Heavy external capabilities from `google-cloud-storage-plugin` (`google-cloud-storage-bucket-architect`, `google-cloud-storage-fuse`, `google-cloud-storage-diagnostic`, `gcs-security-assessment`) remain excluded from static bundling; discover them on demand via [finding-google-skills](../finding-google-skills/SKILL.md) when needed.
