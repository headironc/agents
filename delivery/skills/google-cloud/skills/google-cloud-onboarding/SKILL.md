---
name: google-cloud-onboarding
description: >-
  Guide a solo developer's initial setup on Google Cloud, covering CLI and auth
  verification, enterprise organization checks, project selection or creation,
  and billing account linkage. Skip for enterprise landing zones or complex
  multi-project architectures.
license: Apache-2.0
---

# Onboarding to Google Cloud

Adapted from Google's `google-cloud-recipe-onboarding` skill. Telemetry attribution tags are disabled by default. Read the [gcloud CLI contract](../gcloud/SKILL.md) before checking or running commands. Use tool `gcloud` with non-interactive flags (`--quiet`, `--format=json`), and obtain explicit user confirmation before any state-changing project or billing action.

## Scope Guardrail

This workflow targets an individual developer initializing a standalone Google Cloud workspace. For enterprise organizations or multi-tenant landing zones, halt this flow and route the user to the [Google Cloud Setup guided flow](https://docs.cloud.google.com/docs/enterprise/cloud-setup).

## Step 1: Read-Only Environment Audit

Run read-only checks to inspect the local host before proposing mutations:

1. Verify CLI installation: `command -v gcloud`. If absent, stop and ask for explicit consent or direct the user to [Google Cloud CLI Installation Guide](https://docs.cloud.google.com/sdk/docs/install-sdk).
2. Inspect authenticated accounts without modifying credentials: `gcloud auth list --format=json` and `gcloud config get-value account --format=json`. If unauthenticated, ask the user to sign in at [Google Cloud Console](https://console.cloud.google.com/) and run `gcloud auth login` locally.
3. Check for an enterprise organization: `gcloud organizations list --format=json`.
   - If any entry includes `owner.directoryCustomerId` (verified Google Workspace / Cloud Identity domain) or the user requests corporate multi-tenant setup, **halt** and route to the enterprise setup guide above.
   - An empty list `[]` or a Free Trial Self-Owned Organization (without `owner.directoryCustomerId`) may proceed.

## Step 2: Select or Create a Project (With Consent Gate)

1. List active accessible projects safely:

   ```bash
   gcloud projects list --filter="lifecycleState=ACTIVE" --limit=20 --format=json
   ```

2. **Reuse existing project when appropriate**: Present available active projects and ask whether to reuse one (passing `--project=<PROJECT_ID>` explicitly on commands, or only running `gcloud config set project <PROJECT_ID> --quiet` with user consent).
3. **Create a new project only on explicit request and confirmation**:
   - Confirm target `PROJECT_ID`, `PROJECT_NAME`, active account, and target billing account ID in a clear summary before executing `gcloud projects create` or billing commands.
   - Never run `gcloud projects create` or `gcloud billing projects link` autonomously without explicit user approval in the conversation.
   - If `PROJECT_ID` is already taken globally (`ALREADY_EXISTS` / collision), propose a disambiguated ID (for example appending a 4-digit suffix) and re-confirm before retrying.

## Step 3: Verify and Link Billing

1. Check current billing status:

   ```bash
   gcloud billing projects describe PROJECT_ID --format=json
   ```

2. If `"billingEnabled": true` is already returned, skip linkage.
3. Otherwise list available billing accounts (`gcloud billing accounts list --format=json`), confirm the intended billing account with the user, and only upon explicit authorization run:

   ```bash
   gcloud billing projects link PROJECT_ID --billing-account=BILLING_ACCOUNT_ID --format=json
   ```

4. Recommend budget alerts / spend safeguards (such as [Disable Billing Usage with Notifications](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications)) once billing is linked.

## Step 4: Verify Final State

Verify read-only readiness after authorized setup completes:

```bash
gcloud config get-value account
gcloud projects describe PROJECT_ID --format=json
gcloud billing projects describe PROJECT_ID --format=json
```
