---
name: gh
description: >-
  Apply GitHub CLI, API targeting, response handling, and native-stack command guidance. Supports named workflows without granting mutation authority.
metadata:
  maintenance: local
  upstream-repository: https://github.com/cli/cli
  upstream-revision: 40b742f76d68e6b1f472942a6368db4b5d765641
  upstream-path: skills/gh/SKILL.md
  upstream-sha256: 262301bdc39ea698034c68b0a9b80ce526199c91ab9295a53e348d65eb5304bb
  upstream-verification: Historical attribution; upstream bytes were not reverified in this rebuild slice.
---

# GitHub CLI

Contract subject: `gh`.

Use this contract for an operation already selected by the caller. Take the intended host, repository, object or ref, requested fields and completeness scope from the task or verified handoff. Return the exact target, command result, required data and pagination coverage; report failed or incomplete evidence before any dependent action. Identity selection and business authorization remain with the caller. For opening, reviewing, merging or releasing, load the relevant [operation reference](references/operations.md) before preparing the operation.

Use the installed command's help for actual flags, supported fields and preview availability before constructing an invocation. Before preparing a named GitHub workflow, read [workflow authorization](references/workflow-authorization.md) from this skill's physical directory. It owns targets, authorized effects, repair scope, automatic reviews, waiting, and completion. Use the installed `gh-identity` skill only for identity readiness and permitted credential recovery. These invocation patterns do not start it or expand its authority. If a required installed skill or reference is unavailable, stop the dependent operation; do not reconstruct its permissions from these examples.

## Interactivity policy

Supply the selected command's required noninteractive inputs explicitly. Missing inputs can fail instead of prompting; other commands perform their default action without confirmation in a non-TTY context. Do not treat absence of a prompt as permission or a safety gate. Normal non-TTY output avoids the pager and color unless overridden. Do not pass an unsupported `--no-pager` flag or force a TTY merely to make a failing command proceed.

## Parsing JSON

Human output from `gh` is for display. Select structured fields when a decision depends on response data:

- Add `--json field1,field2,...` for structured output.
- Run a command with `--json` and **no field list** to print the full set of available fields, then pick what you need.
- Use a fixed `--jq '<expr>'` for projection; do not interpolate untrusted values into the expression. Preserve the command's failure and required response shape before accepting projected data; empty output is not proof of an empty successful result.
- Use `--template '<go-template>'` (alongside `--json`) when you want shaped text output. Note that `--template`/`-T` collides with a body-template flag on a few commands (e.g. `gh pr create -T`, `gh issue create -T`); always check `--help` before assuming which one you're hitting.

Pass argument values as quoted arguments, not executable command text. For multiline bodies, use a body file where the command supports `--body-file`. For an API body, use `--input` with the caller's exact payload and method; field flags used with `--input` become query parameters.

## Pagination and silent truncation

List commands cap results.

- `gh issue list`, `gh pr list`, `gh search ...`: pass `-L N` (`--limit N`). The default is usually 30.
- `gh issue list` / `gh pr list` do not expose aggregate totals like `totalCount` via `--json`. If you need a true total, use `gh api graphql` to query `totalCount`; otherwise, treat `-L` as the cap for the current call.
- For REST lists, use `gh api --paginate` when the workflow permits it. It follows the response's next-page links. Pages can be arrays or objects containing arrays; select the endpoint's actual collection instead of assuming one flat array. `--slurp` collects page results into an outer array. A failed later page leaves the accumulated result incomplete.
- GraphQL automatic pagination requires a `$endCursor: String` variable consumed by the connection's `after` argument and that connection's `pageInfo { hasNextPage endCursor }`. Each required connection, including nested comments or replies, needs its own completeness evidence. Follow the workflow's fixed queries and independent cursor procedure when it requires separate connections or forbids `--paginate`. A continuing connection without an advancing usable cursor is incomplete.
- Treat a cap, missing page, query error, or changing bound target as incomplete evidence, not an empty or complete result.

## Repo targeting

Resolve the intended host and repository from the task or verified workflow handoff. Use `--repo <host>/<owner>/<repo>` (`-R`) where the command supports that repository override. Search filters retain their command-specific syntax. For `gh api`, pass `--hostname <host>` and explicit repository components in the endpoint or GraphQL variables. Do not let `GH_REPO`, the current directory, or `{owner}`, `{repo}`, and `{branch}` placeholders select a bound target. When a command has no repository flag, use the workflow's verified target worktree and its command-specific targeting procedure. Check supplied object URLs against the bound host and repository rather than assuming `-R` overrides a conflicting URL. Keep required base/head or ref identities bound across pages and readback.

## Search vs list

Search indexing and API caps cannot establish an exhaustive set merely because a search returned fewer than its requested limit. For non-search lists, assess completeness against the endpoint and pagination contract.

- `gh search issues|prs|code|repos|commits` uses GitHub's search index and accepts the full search syntax (`is:open`, `author:`, `label:`, `repo:owner/name`, `in:title`, ...). Pass each qualifier as its own bare token, not as one quoted string: `gh search issues repo:cli/cli is:open author:monalisa` works, but `gh search issues "repo:cli/cli is:open"` is treated as a single keyword (parsed as `repo:"cli/cli is:open"`) and fails with `Invalid search query`. Quote only multi-word free text (`gh search issues "broken feature"`). Most qualifiers also have a dedicated flag (`--repo`, `--author`, `--label`, ...). Prefer search for anything cross-repo or filtered by author/label.
- `gh issue list --search "..."` and `gh pr list --search "..."` take the query as one quoted string (it is a flag value) and are scoped to one repo.
- Bots author as GitHub Apps, so `--author dependabot` matches nothing. Use `--app dependabot` (on `pr`/`issue list` and `search prs|issues`; expands to `author:app/<slug>`) or `--author "dependabot[bot]"`.
- `gh search issues` also takes `--search-type <lexical|semantic|hybrid>` (github.com/GHEC only, issues only): use `semantic` when the user describes a problem in natural language rather than exact terms, and `hybrid` to blend keyword and semantic ranking; `lexical` (default) is exact matching.

## Task-specific commands

Read only the relevant section of [extended commands](references/extended-commands.md):

- [Issue types and relationships](references/extended-commands.md#issue-types-sub-issues-and-relationships) for sub-issues and blocking relationships.
- [Attachments](references/extended-commands.md#attaching-images-and-videos) for file uploads and their authentication restrictions.
- [Discussions](references/extended-commands.md#discussions-gh-discussion) for discussion threads and comments.
- [Repository files](references/extended-commands.md#reading-files-and-directories-gh-repo-read-file--read-dir) for API-based file retrieval.

## Fall back to `gh api` for anything `--json` doesn't expose

Contract subject: `github-api`.

Apply the target and result requirements here to the API request regardless of client. A workflow's fixed executable or query retains its own interface. For API requests through `gh`, use these patterns:

- PR inline comments: `gh api --paginate --hostname <host> repos/<owner>/<repo>/pulls/<number>/comments`. Do not use `gh pr view --comments` as complete inline review-thread evidence. This REST collection does not provide thread resolution state; use GraphQL `reviewThreads` with complete connection coverage when that state is required.
- GraphQL: use `gh api graphql --hostname <host>` with a fixed query and explicit variables. Use `-f` for literal strings and `-F` for intended typed values. `-F` also interprets placeholders and `@file` inputs.
- For REST reads with field arguments, specify `--method GET`; adding fields otherwise changes the default method to POST.

Apply [failure and readback requirements](#failures-and-readback) before using the response or taking another action.

The [API command manual](https://cli.github.com/manual/gh_api) describes field conversion, method selection, and pagination mechanics.

## Failures and readback

Preserve process exit status and useful stderr separately from response data. Check required object identities, field types and nullability before using JSON. A parseable body or HTTP success with GraphQL `errors`, partial `data`, missing fields or an unmatched target is not sufficient evidence. Do not convert authentication, access, rate-limit, transport or server failures into empty results. Keep secrets and sensitive response values out of diagnostics.

For a write with a timeout, nonzero exit or partial success, retain the exact target and observed effects and use the caller's readback procedure. Do not infer that nothing changed and repeat the write. Retry limits, polling cadence and recovery remain owned by the calling workflow.

## Authentication

For a named workflow, use the installed `gh-identity` skill to load its `references/auth-readiness.md` before the first network command. Use its selected profile and required status and identity queries. Do not substitute generic `gh auth status --json` output for that identity proof. Follow that owner's explicit credential-recovery and read-retry procedure when its conditions apply. A command failure alone does not authorize another account, credential recovery or a configuration change outside that procedure.

## Native stacks

Contract subject: `gh-stack`.

Before the first `gh stack` call, inspect the actual subcommand's help. Read the relevant [operation reference](references/operations.md) for opening, reviewing, merging or publishing, including native stacks. These are operations under this tool, not separate workflow skills. Their named identity capabilities remain owned by the installed gh-identity contract.

If the native command or required identity capability is unavailable, report the missing capability instead of installing an extension or substituting an unrelated stack implementation.

For read-only inspection, use the verified target worktree and check the returned stack identity. Keep the selected remote and ordered PRs bound to the operation; a branch name alone does not establish a native stack. Use each subcommand's supported explicit remote selector when available. Inspect the argument semantics: `stack link` can push branch arguments and create PRs, and bare numbers can resolve differently from explicit PR URLs. Let the selected workflow bind the exact ordered objects before any write. Actual `stack merge` help may expose a prefix selection or queue behavior; the merge operation must bind the complete authorized stack and compatible invocation. Neither acceptance nor queued status proves that all required members have merged. Do not use another stack command as an implicit substitute for the selected workflow. Local availability does not authorize a checkout, push, or merge.

## Other notes

- `gh pr checkout <n>` switches branches. Use `gh pr diff <n>` or `gh pr view <n>` if you only need to read.
- `gh pr checkout <n> --worktree <path>` checks the PR out into a git worktree at `<path>` instead of switching the current branch.
- `gh issue develop <n> --checkout` creates a linked branch for the issue and checks it out. Add `--worktree <path>` to check that branch out into a git worktree at `<path>` instead of switching the current branch; `--worktree` requires `--checkout`, cannot be blank, and cannot be combined with `--list`.
- `NO_COLOR`, `CLICOLOR_FORCE`, and `GH_FORCE_TTY` affect output formatting. Leave `GH_FORCE_TTY` unset for machine processing. TTY-style display does not provide authorization or guarantee an interactive confirmation.
