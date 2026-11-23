# gcloud CLI Usage

Read the [gcloud CLI contract](../SKILL.md) before checking or running commands. Use tool `gcloud` strictly within the authorized task scope.

## Environment Check and Installation Boundary

Check availability with `command -v gcloud` before running CLI commands. If `gcloud` or a required component is absent, direct the user to the official [Google Cloud CLI Installation Guide](https://docs.cloud.google.com/sdk/docs/install-sdk.md.txt) and strictly wait for explicit user consent before running any installer, package manager command, or `gcloud components install` / `gcloud components update`.

When user-approved component inspection or management is requested:

```bash
gcloud components list
gcloud components install COMPONENT_ID --quiet
gcloud components update --quiet
```

If `gcloud` was installed via a system package manager (APT, DNF, Homebrew), use that package manager rather than `gcloud components`.

## Authentication and Credential Selection

- **Interactive user CLI login**: `gcloud auth login` (or `gcloud auth login --no-browser` over SSH/headless hosts).
- **Application Default Credentials (ADC)**: `gcloud auth application-default login` (append `--no-browser` on headless hosts) for local libraries and local MCP servers.
- **Service Account Impersonation (preferred over static JSON keys)**:
  Keep credentials short-lived by authenticating as a human (`gcloud auth login`) and impersonating a least-privilege service account:

  ```bash
  gcloud config set auth/impersonate_service_account SERVICE_ACCOUNT_EMAIL
  ```

  Requires `roles/iam.serviceAccountTokenCreator` on the target service account. Never copy or commit service account key JSON files into repositories or logs.
- **Workload Identity Federation**: Preferred for CI/CD and non-GCP compute without long-lived keys; see [Authenticate for the gcloud CLI](https://docs.cloud.google.com/sdk/docs/authenticate.md.txt).

## Named Local Configurations

Prefer explicit `--project`, `--region`, and `--zone` flags over mutating shared local state. Only inspect or switch named configurations when requested or authorized by the task:

```bash
gcloud config list
gcloud config configurations list
gcloud config configurations create CONFIG_NAME
gcloud config configurations activate CONFIG_NAME
```
