# GitHub operations

Read the [GitHub CLI contract](../SKILL.md). Use tool `gh` for the operation actually requested. Read the [Git transport rules](../../../policy/tool-contracts.md#git). Use tool `git` only within the same authorized target and action limits.

## Identity and authorization

Before a named operation, read this skill's [workflow authorization](workflow-authorization.md). Use the installed `gh-identity` skill and its `references/auth-readiness.md` for identity selection and credential recovery. Resolve references from each skill's physical directory. Preserve the workflow's target, authorized effects and limits; command examples grant no additional authority.

Every operation uses `headironc`. Follow the Git transport rules for the HTTPS default, credential helper and target access checks. A GitHub API identity alone does not prove which credentials Git uses or establish push permission. Verify the actual transport before its write; require SSH identity evidence only when the operation uses SSH. After an identity failure, stop and report it; do not select another account or credential source.

## Open or reuse a PR

Bind the host/repository and exact base/head pair before any mutation. Apply the [opening authorization boundary](workflow-authorization.md#targets-and-authorized-effects) to preparation, implementation changes, and signed commits. Publishing an existing candidate does not grant implementation authority. Preserve the one normal push and one create-or-reuse limit. A commit-only request does not authorize publication.

Require a feature branch, a clean committed candidate, matching final diff and required validation. Verify the remote's effective URLs, fetch successfully, and establish the intended base without updating another workspace. All commits must belong to the change or a declared dependency.

Create new PRs ready for review by default. Use a draft only when the user requests it or an explicit project requirement calls for it. Preserve an existing PR's draft state when reusing it unless a state change is authorized. Missing reviewer configuration or review results does not justify creating or reverting a draft.

Query the exact head before pushing. Reuse only one open PR with the intended base, head, title, repository and human author; conflicting matches block the operation. Verify its head SHA, not merely the branch name. Establish the exact upstream if absent, then use one normal push with an explicit refspec. Read the remote ref back and require the intended object ID.

When no matching PR exists, create with the explicit repository, base, head, title and body file. Apply the [writing conventions](../../../policy/writing.md). Read back number, URL, state, draft status, author, base and exact head. A failed or timed-out creation is not permission to create again: query the exact head once and verify exactly one matching result, otherwise report an unknown outcome and stop. A failed or unknown push likewise requires readback, never an automatic retry.

## Automatic review and feedback

Apply [automatic-review authorization and waiting](workflow-authorization.md#automatic-review-and-waiting) to authorized PR creation, ready transitions and repair pushes.

Use the installed [shared review rules](../../../policy/review.md#review-coverage) for review, authorized finding repair, and explicit evidence audits. Reuse evidence within its actual coverage. This evidence supplies the review portion of the adopted workflow; it cannot replace enforcement that the project explicitly requires.

For direct verification, read the required review surfaces and paginate each required connection: review bodies, top-level comments, inline comments and GraphQL review threads with resolution state. A green job, zero threads, or an old-head review alone is insufficient. Verify current-head coverage and distinguish verified blockers from optional advice. Read a finding's severity, location, and reason from the provider's actual report; read thread resolution from the thread when one exists. Do not require every provider to publish findings as inline threads. Preserve threadless findings and the source report URL for disposition. Keep out-of-scope observations in their source reports for separately authorized work. Preserve the reviewer's original report; omission from a later summary does not resolve an earlier finding. Record the actual run or completion-summary identity and published results; unavailable provider internals remain unknown.

For findings that require direct assessment or disposition, apply the severity, disposition, and completion criteria in the installed [review rules](../../../policy/review.md) (`delivery/policy/review.md` when maintaining the agents repository itself), independently of thread resolution state. Verify proposed severity and candidate relevance against the bound PR change before treating a finding as blocking. Preserve the provider's original severity; a label such as `[must-fix]` is its proposed classification, not an automatic verdict. Restrict replies and resolutions to findings covered by the existing disposition authority. Put the disposition required by the shared criteria in each authorized reply, including the severity-change record when reclassifying a finding. Resolve an authorized thread after recording its required disposition; for a blocking finding, also verify that the defect was fixed or that evidence establishes it does not block this candidate. Record any confirmed out-of-scope classification with its evidence and preserve the reported defect for separately authorized work. Read back the resolution. Preserve required conversation resolution and repository protections. Track earlier findings across rounds, reusing unchanged dispositions and reassessing them when relevant code or evidence changes.

For fixes, apply the [repair scope and round boundaries](workflow-authorization.md#review-fixes). Classify new findings against the existing authorization before deciding whether to pause; importance alone does not require a new decision. If direct verification needs an unavailable earlier report, disclose the affected gap instead of inferring resolution. Read back the push before authorized replies or resolutions, then verify the resulting candidate's review coverage and dispositions through applicable gate evidence or the required direct checks. Stop collecting evidence when the shared completion rules are satisfied.

For each named finding whose inline thread could not be posted, use a standalone disposition comment only when the round authorizes it. The workflow contract owns its per-finding limit and retry boundary. Immediately before each post, paginate top-level comments and retain their IDs for that post. Write the exact body to a file, including the source-report URL, finding file and line, and disposition. Use `gh pr comment <number> --repo <host>/<owner>/<repo> --body-file <file>`. This creates a top-level PR comment, not a resolvable review thread. After a confirmed or uncertain write, paginate comments again on the bound host and PR. Match the authorized author, exact body, and one new comment ID absent from that post's pre-write list. If readback cannot verify exactly one new matching comment, stop dependent mutations without retrying.

## Merge

Require explicit authority for the exact PR. Recheck the authorization scope, current operation identity, intended repository and PR, open and non-draft state, target branch, and complete head SHA before the write. Establish the project's adopted workflow under [shared merge admission](../../../policy/review.md#merge-admission), using the target-branch contract or independently trusted configuration. Reuse that contract for its requirements, evidence sources, and supported merge mode.

For an adopted native workflow, verify the applicable current checks, review coverage and dispositions, required discussions and approvals, and actual platform state under the shared rules. Reuse valid evidence and check only affected coverage after changes; do not reread all history for each merge. A dedicated aggregate signal is a prerequisite only when the project adopted it.

For a workflow that explicitly requires a final enforced admission state, read it for the bound target. A missing, blocked, stale, unreadable, or incomplete required state does not permit merge. Report the specific gap; leave review and enforcement repair to their authorized scope. Do not inspect approval bodies, reviewer identities, baseline history, freshness internals, threads, timelines, or protection configuration to manufacture an alternative to that state. A separately requested audit follows the review rules and cannot substitute for required enforcement.

When the adopted conditions are satisfied and the platform permits the action, perform the authorized operation with exact head matching and read back the same PR. Use ordinary squash merge or the target branch's required queue flow. Do not impose a queue on a branch that permits ordinary merge. Do not bypass protection, update the branch, or use `--admin`.

Queue or auto-merge acceptance remains pending until readback proves the PR merged. Resume a pending or uncertain merge at readback of the same PR, not at another submission. Diagnose unexpected removal from the queue before any separately authorized resubmission. No automatic retry. A known unresolved defect or contradictory evidence stops the dependent merge under the shared rules even if a displayed status is green.

After readback proves the authorized PR merged, finish its cleanup without another request. The merge authorization covers that PR's exact remote head branch, an owned local branch, and a worktree created for this PR by the agent. Delete the remote branch only if it still points to the verified PR head. Remove the task-created worktree only if it is clean, unused and contains no unrelated work; then delete its local branch only if that branch still points to the verified PR head and no worktree uses it. Never force removal or delete a pre-existing worktree. Read back each deletion. Preserve any target whose identity, ownership, cleanliness or current use cannot be established, and report the specific blocker. Continue with independently safe cleanup targets if one is blocked. Do not update an unrelated main workspace.

## Native stacks

Bind the exact ordered parent/head pairs and selected remote. Validate each layer against its actual parent. Publish bottom-up, with one normal push and create-or-reuse readback per declared layer. Stop later layers after a failure. Apply the automatic-review boundary separately to each event and resulting head.

Link only already-created PR numbers or explicit URLs using the installed `gh stack link` syntax and explicit remote. Branch arguments can push/create implicitly and are not admitted here. Verify the stack number, size, positions, ordered PRs, bases, heads and repository after linking. Do not substitute `stack submit`, `stack add`, or an extension for missing native capability.

Alignment is a separately authorized history rewrite and publication; opening or review alone does not authorize it. Merge requires authority for the exact complete stack, satisfaction of the adopted workflow for every layer under [Merge](#merge), and a compatible native complete-stack squash invocation. Do not silently merge a prefix or one layer at a time. Confirm all members merged before deleting any stack branch.

## Release

Use explicit release authority, the verified protected branch and exact tag. Require a clean committed source matching the successfully fetched remote base and no existing tag/release collision. Use the Human's version; if absent, the retained personal convention is the next patch of the latest stable semantic release, or `v0.0.1` when none exists. Bind it before creation, not from commit messages. Create once with scoped release notes, then verify tag, target commit and URL. An uncertain outcome requires readback; do not rewrite tags, force-push or create source commits as part of releasing.
