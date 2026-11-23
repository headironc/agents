---
name: cloud-sql-postgresql
description: >-
  Provision, inspect, connect to, and operate Cloud SQL for PostgreSQL
  instances on Google Cloud, covering Cloud SQL Auth Proxy, Private IP/SSL, IAM
  database auth, high availability, backups/PITR, gcloud sql safety, and
  read-only vs mutating SQL boundaries. Skip for non-Google Postgres, Spanner,
  AlloyDB, or Cloud Storage.
license: Apache-2.0
metadata:
  maintenance: local-adaptation
  upstream-repository: https://github.com/google/skills
  upstream-path: skills/cloud/cloud-sql-basics
---

# Cloud SQL for PostgreSQL

Adapted from Google's `cloud-sql-basics` skill (`SKILL.md` and `references/mcp-usage.md`) and scoped to Cloud SQL for PostgreSQL. Telemetry attribution (`CLOUDSDK_METRICS_REQUEST_ATTRIBUTION` and tracking `User-Agent` tags) is omitted by default, and no repository file may ever contain real private database hostnames, accounts, CA certificates, or credential IDs.

## `gcloud sql` CLI Safety

Read [the gcloud CLI contract](../gcloud/SKILL.md) before inspecting or running CLI commands. Use tool `gcloud` only within explicitly authorized boundaries.

- **Validate Leaf Commands First**: Inspect `gcloud help <leaf_command>` (for example `gcloud help sql instances create` or `gcloud help sql backups list`) before proposing flags or running commands. Pass `--project=<PROJECT_ID>` and `--quiet` explicitly.
- **Inspect Before Mutating**: Read instance edition, PostgreSQL version, network posture, and maintenance windows with bounded read-only calls (`gcloud sql instances list --project=<PROJECT_ID> --limit=20 --format=json` and `gcloud sql instances describe <INSTANCE> --project=<PROJECT_ID> --format=json`) before suggesting configuration changes.
- **Confirmation Gates**: Require explicit human authorization naming the exact project, region, and instance before `gcloud services enable sqladmin.googleapis.com`, `gcloud sql instances create` / `patch` / `restart` / `failover` / `delete`, `gcloud sql databases` / `users` mutations, or `gcloud sql backups restore`.

## Connectivity, Auth, and Operational Hygiene

- **Connectivity**: Prefer Private IP with TLS (`sslmode=verify-full`) inside VPCs or [Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/sql-proxy) using `<PROJECT_ID>:<REGION>:<INSTANCE_NAME>` (`connectionName`) over exposing public IPv4 with broad authorized networks (`0.0.0.0/0`).
- **IAM Authentication Over Static Passwords**: Prefer IAM database authentication (`roles/cloudsql.instanceUser` and short-lived OAuth2 tokens) instead of setting static passwords or logging `postgres` superuser credentials in terminal commands or `.env` files.
- **Availability and Recovery**: Use `REGIONAL` availability (`--availability-type=REGIONAL`) and automated backups with transaction logs (PITR) for production PostgreSQL workloads, and run `gcloud sql` / version upgrade pre-checks (`postgres_upgrade_precheck`) before major PostgreSQL version upgrades.

## Strict Read-Only vs. Mutating MCP and SQL Boundaries

No Cloud SQL MCP fragment is bundled by default in `capability/`. When a user explicitly mounts Google's remote Cloud SQL MCP (`https://sqladmin.googleapis.com/mcp/readonly` or `https://sqladmin.googleapis.com/mcp`, requiring OAuth with `roles/mcp.toolUser` + `roles/cloudsql.*`) or a local PostgreSQL MCP Toolbox:

- **Read-Only Operations**: Prefer the read-only endpoint (`https://sqladmin.googleapis.com/mcp/readonly`) when mutations are unneeded. Read-only inspection covers `get_instance`, `list_instances`, `list_users`, `get_operation`, `postgres_upgrade_precheck`, and `execute_sql_readonly` (bounded `SELECT` queries without side effects).
- **Mutating and Destructive Operations**: Never run `execute_sql` (DDL, DML writes, privilege/role changes, or `DCL`), `create_instance`, `update_instance`, `clone_instance`, `create_user`, `update_user`, `create_backup`, `restore_backup`, `import_data`, failover, or deletion without explicit user confirmation naming the exact project, instance, and database. Verify outcome with a follow-up read (`get_operation` / `execute_sql_readonly`) rather than blindly retrying unknown writes.

## On-Demand Specialized Workflows

Heavy external `data-cloud` submodules (`cloud-sql-postgresql-plugin` and the remaining database plugins) are excluded from static bundling; discover specialized Cloud SQL workflows on demand via [finding-google-skills](../finding-google-skills/SKILL.md).
