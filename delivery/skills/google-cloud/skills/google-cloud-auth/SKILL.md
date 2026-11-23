---
name: google-cloud-auth
description: Provide guidance on Identity and Access Management (IAM) and authenticating and authorizing to Google Cloud services and APIs, covering human users, service identities, Application Default Credentials (ADC), impersonation, Workload Identity Federation, and restricted API keys.
license: Apache-2.0
---

# Authenticating and Authorizing to Google Cloud (IAM)

Adapted from Google's `google-cloud-recipe-auth` skill. Telemetry attribution tags are disabled by default. If running or validating any `gcloud` command, read the [gcloud CLI contract](../gcloud/SKILL.md) first. Use tool `gcloud` only within explicitly authorized boundaries (IAM policy/binding modifications always require explicit user confirmation).

## Clarify Context Before Recommending Changes

Establish four facts from task context before proposing commands or IAM bindings:

1. Who or what is authenticating (human developer, local script, CI pipeline, or deployed workload)?
2. Where does the code execute (local workstation, Compute Engine, GKE, Cloud Run, or external cloud/on-prem)?
3. What target is being accessed (a Google Cloud API, a Cloud Run/IAP service, or a custom app)?
4. Which SDK/runtime is in use (standard client libraries use ADC automatically)?

## Human Developer Authentication

- **Google Cloud Console**: Sign in via Gmail, Google Workspace, or Cloud Identity.
- **`gcloud` CLI (`gcloud auth login`)**: Authenticates CLI management commands (`--no-browser` on headless hosts).
- **Local Development ADC (`gcloud auth application-default login`)**: Generates local user credentials used by client libraries and local MCP servers when running outside GCP. ADC resolution order is `GOOGLE_APPLICATION_CREDENTIALS` -> local gcloud ADC JSON -> attached metadata server.
- **Service Account Impersonation (Recommended over JSON keys)**: Authenticate as a human (`gcloud auth login`), then set `auth/impersonate_service_account` or `--impersonate-service-account` with `roles/iam.serviceAccountTokenCreator` to mint short-lived tokens without downloading private key files.

## Workload and Service-to-Service Authentication

- **On Google Cloud (Compute Engine, Cloud Run, GKE)**: Attach a dedicated custom least-privilege **Service Account** instead of relying on default compute service accounts or downloading JSON keys.
  - On **GKE**, use [Workload Identity Federation for GKE](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity.md.txt) to map Kubernetes ServiceAccounts to IAM principals.
  - Note for legacy Compute Engine / GKE node pools: OAuth 2.0 **Access Scopes** still restrict what an attached service account can reach alongside IAM; check scopes if IAM looks valid but calls return `403`.
- **Outside Google Cloud (AWS, Azure, GitHub Actions, on-prem)**: Use [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation.md.txt) to exchange external OIDC/cloud tokens for short-lived Google Cloud tokens rather than storing static JSON keys.
- **Private Service-to-Service HTTP (Cloud Run / IAP)**: Pass Google-signed OIDC ID tokens in `Authorization: Bearer <TOKEN>` when calling private endpoints.
- **End-User Access**: Use Identity-Aware Proxy (IAP) for internal workforce web apps, or Identity Platform for consumer CIAM login.
- **API Keys**: Use only for services that explicitly require API keys (such as public APIs or Developer Knowledge REST/Codex HTTP headers). Always restrict API keys to specific APIs and projects, store them outside repositories (environment variables or Secret Manager), and pass keys via headers (`X-Goog-Api-Key`) rather than URL query strings.

## Authorization Best Practices

- Prefer **Predefined Roles** (for example `roles/storage.objectViewer`, `roles/bigquery.dataViewer`) over broad primitive roles (`roles/owner`, `roles/editor`).
- Use **Custom Roles** only when predefined roles are genuinely too broad.
- Treat any IAM policy or binding mutation (`add-iam-policy-binding`, `set-iam-policy`) as a high-risk operation requiring explicit user approval after inspecting the target policy first.
