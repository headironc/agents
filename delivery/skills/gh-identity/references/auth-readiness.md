# GitHub authentication readiness

Read the available `gh` skill by installed name before CLI use. Read its [invocation contract](../../gh/SKILL.md). Use tool `gh` with the exact host and selected profile under the caller's authorization.

The caller owns workflow authorization under gh's [workflow contract](../../gh/references/workflow-authorization.md). This reference owns only identity readiness and credential recovery.

Use this reference before the first GitHub network command in a workflow that names a profile. That includes a `gh` request and an HTTPS Git command that depends on the selected GitHub credential.

This is read-before-use verification. It does not isolate a later command from credential or repository changes.

For HTTPS Git operations, follow the [Git transport rules](../../../policy/tool-contracts.md#git) to verify the effective credential helper and target access. Selecting a gh account affects Git authentication only when the effective helper uses that account. It does not select a commit email or signing key. An HTTPS operation does not require an SSH key or an SSH authentication test. Credential recovery does not authorize changing an existing remote, installing a helper or generating keys.

## Common rules

Reject credential, host/configuration and debug environment overrides before checking a selected identity. Do not print their values or let GH_TOKEN, GITHUB_TOKEN or an alternate configuration root mask the stored account.

1. Resolve the host selected by the calling workflow before selecting a profile.
2. When that workflow reads back a resource URL, require it to name the same host before treating the URL as target authority.
3. Require the caller's scope to cover the literal host, selected profile, and identity operation. Use the existing host permission or a bounded grant for that operation. A denial blocks the dependent identity check; it does not authorize a broader grant or another identity. Follow the caller's workflow contract for repository targets, mutations, and cleanup.
4. Run `gh auth status --active --hostname <host>` without `--json`. If it fails, distinguish a network or host-access restriction from a confirmed credential failure. A restricted-network result, even one that says the token is invalid, does not establish that the stored credential is invalid. With the required host network permission, repeat the exact status check for the same host, profile and stored configuration. Do not change the account, refresh credentials or start device authorization before that recheck. If network access remains unavailable, report identity as unverified and stop the dependent workflow. Enter the recovery sequence below only after the permitted recheck confirms invalid credentials or a missing stored account.
5. After any selection or recovery, repeat that status check and require the profile's expected active account.
6. Before a mutation, require this separate target-host identity query to report the profile's expected `viewer.login`:

   ```text
   gh api graphql --hostname <host> -f query='query { viewer { login } }'
   ```

   A workflow may reuse an existing query only when it already selects `viewer.login`. Do not add `viewer` to a fixed workflow query that forbids it; keep the identity query separate.

If a read-only GitHub command confirms invalid authentication after the same network-permitted recheck, perform this profile sequence once and retry that exact read once. Do not retry a mutation automatically. Re-read its target and stop when a mutation outcome cannot be verified.

Do not repeat a successful profile selection in one named workflow.

Leave the selected profile active. Do not restore an earlier account.

## Human profile: `headironc`

This is the only profile. Use it for `pr-open`, `pr-review`, `pr-merge` and `github-release`. The `cladiron[bot]` profile, its fixed credential provider and the `pr-approve` capability were retired once `main` stopped requiring a separate approving review; no App installation token is created, stored or used here.

Unless the initial status check already verifies the active account as `headironc`, first try the fixed account selection:

```text
gh auth switch --hostname <host> --user headironc
```

When that selection succeeds but the network-permitted status recheck confirms that the stored `headironc` account is invalid, run:

```text
gh auth refresh --hostname <host>
```

When the account selection itself confirms `headironc` is not stored, run:

```text
gh auth login --hostname <host> --git-protocol https
```

At the `Authenticate Git with your GitHub credentials?` prompt, explicitly select **No** unless the existing authorization also covers configuring Git credentials. Do not accept the default Yes with Enter: it can install gh as the helper when none is configured, or write credentials through an existing helper. If Git configuration is required, obtain authorization for that target and effect before accepting Yes. An existing gh helper can omit this prompt because it already returns the active account's token; still verify the effective helper and target access afterward. This behavior is implemented by the [gh credential flow](https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/auth/shared/git_credential.go).

Both recovery commands require the Human to complete their browser or device interaction. Stop until that interaction completes, then repeat the status and `viewer.login` checks. Never supply, replace, persist, or display a human token.

## Retired bot profile

No App, installation token or credential provider is used. A workflow that cannot proceed under `headironc` stops and reports that; it does not look for another account, an installed launcher or a stored bot credential.
