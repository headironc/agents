# Shared instructions

## Working together

- Communicate in Chinese; write code, code comments, identifiers, and commit messages in English.
- Lead with the result or intended action. Use concise explanations and mark material uncertainty.
- Before selecting, starting, resuming, or changing an implementation checkout, apply the [workspace rules](execution.md#workspaces). Keep solo work in the current verified checkout and branch; use a separate worktree only for conflicting writers or WIP, an experimental spike, or explicit Human isolation.
- After the last file edit and before reporting completion, make a separate verification tool call under the [check rules](review.md#checks), including the final diff, `git diff --check`, and applicable project checks. Report actual results; a successful write or pre-edit inspection is not verification.
- Read relevant project instructions and affected code first. Reuse established decisions and unchanged verification results.
- Apply [context and continuity rules](execution.md#continuity-and-evidence) when reading source, collecting output, or handing off: keep active context below 150K tokens, filter searches and output, and use a compact state anchor at the defined thresholds. Ordinary single-session work needs no separate record.
- For each new Human requirement, the task owner assesses whether it applies only to the current task, corrects execution of an existing rule, or reveals a lasting rule gap or conflict. Check the applicable authoritative rules before deciding. Apply task-specific directions within their stated scope; correct execution deviations using the existing rule. Reuse adequate rules rather than adding duplicates, and preserve the requirement's original scope and authorization.
- When a requirement establishes a lasting preference or exposes a recurring rule gap or conflict, update the owning authoritative source within the authorized slice and operation boundaries. Follow the existing [rule ownership requirements](#code-preferences) and update affected references and acceptance scenarios. Resolve conflicts using instruction priority and declared adoption scope; ask only for a missing decision or uncovered action. When an update cannot proceed, identify the specific gap and responsible owner while continuing unaffected work. Assessing a requirement does not authorize writing rules, memory, installed copies, or configuration. Do not make every instruction permanent or require a record, report, or approval for every assessment.
- When a command generates disposable scratch directories, apply the [temporary-directory lifecycle](execution.md#task-temporary-directories). When readback confirms that a PR in the authorized merge workflow has merged, apply [post-merge cleanup](../skills/gh/references/operations.md#post-merge-cleanup) before reporting that workflow complete. Before reporting task completion, handing off remaining work, or archiving, apply the [closeout rules](execution.md#task-completion-and-chat-archival).
- After a test, probe, or exercise, automatically remove its unneeded temporary files, test sessions, and acceptance records; preserve the current installation, necessary recovery materials, and evidence still in use. Read and apply [exercise cleanup](execution.md#test-and-exercise-cleanup) before the final response. The host that creates or manages a test session owns its deletion after the session ends, its results are consumed, and dependencies finish. A test session must not delete itself while running; its final response must identify itself as pending host cleanup, name the responsible host and known session identity or location, and state the remaining deletion conditions. Until the host verifies deletion, keep that session pending rather than reporting no remaining work.
- Complete authorized local preparation, implementation, tests, and repairs under [implementation slices](#implementation-slices). Apply [continuing delivery](#continuing-delivery) across slices and [operation boundaries](#operation-boundaries) for missing decisions or uncovered effects; resolve ordinary reversible technical choices yourself.
- Treat code the Human deleted or rewrote as an intentional change. When that change breaks a build or test, understand the Human's current goal before fixing; do not silently restore the earlier implementation.
- When the Human walks through code with you, show each complete relevant excerpt from the current repository and explain the excerpt's place in the call chain. Proceed in order and track which excerpts the Human has seen. Do not repeat an excerpt the Human has already seen, and honor requests to skip tests or other excerpts.
- Use a plan when it helps resolve dependencies or material risk; do not require a plan approval, role label, or status record for ordinary development.
- Preserve unrelated work. Do not reset, overwrite, rebase, or remove another task's changes without authorization.

### Implementation slices

- Design the complete architecture when the task calls for it, but implement code one small slice at a time. Acceptance of an architecture or implementation roadmap does not authorize implementing all its stages.
- Prefer a cohesive business outcome that can be verified locally. When working solo on a feature branch, you may iterate through local implementation checkpoints within the same deliverable business outcome continuously once each step passes its local unit and type checks, rather than opening a separate micro-PR and waiting for cloud review on every small step.
- Before implementation, state the current slice's observable outcome, necessary changes, acceptance checks, and excluded follow-up work. Reuse an already clear selection; this scope statement does not require a separate plan approval.
- Complete the selected slice's local preparation, edits, tests, and repairs autonomously. A request to implement or fix authorizes that work without repeated confirmation. Resolve an unclear or subsequent slice under [continuing delivery](#continuing-delivery).
- Split by business behavior and responsibility. File count, directories, crates, lines, and commits do not define slices. Keep unrelated refactoring and formatting cleanup out of the current change. Within a slice, organize authorized commits around complete purposes with their related documentation and validation, preserving runnable intermediate states.
- Deliver supporting facilities with their first real consumer, limited to what that consumer currently needs. Do not prebuild a general framework, complete infrastructure, or future capabilities from the roadmap.
- Make each slice complete, runnable, and verifiable. Include the transaction and database protections, authorization checks, failure handling, recovery behavior, tests, and documentation required for its outcome. Do not shrink the apparent scope by deferring these responsibilities or splitting business facts and invariants that must be delivered together. A slice may cross technical layers when its one outcome requires them. A repair may address the same cause across affected paths within the authorized scope; keep that repair complete instead of splitting it merely to reduce PR size.
- When implementation reveals a second independent topic or a capability that materially expands acceptance, finish the current slice and list the addition as follow-up work. If completing the current outcome actually requires a wider scope, explain the added responsibilities and why they are necessary, and obtain the Human's confirmation before implementing the expansion. Continue unaffected authorized work while that decision is pending.
- Report the completed outcome, validation, limitations, and recommended next slice, then apply [continuing delivery](#continuing-delivery). Current-slice defects and authorized review repairs remain current work; arbitrary iteration or review-round limits do not end that responsibility.

### Continuing delivery

By default, "start", "continue", or a request to act proactively authorizes the currently proposed slice. An accepted architecture, roadmap, or standing objective alone does not authorize implementing its remaining stages. When the next slice is unselected and lacks continuing authorization, recommend it and wait for the Human's choice; clarify an unclear current slice before coding.

Reuse effective Human authorization that covers continuing work across slices within a defined project or business outcome. Verify the original instruction's scope, conditions, and latest applicable changes. Select and proceed through covered slices under that authorization without asking the Human to choose each one again. Keep each slice complete and independently acceptable, and put independent deliverable business outcomes in separate PRs (while local implementation checkpoints within one outcome may share a feature branch). Preserve required checks, review, candidate acceptance, integration order, and the separate authority for publication, merge, deployment, or other external effects. A new business decision, scope expansion, pause, or uncovered operation still stops only the dependent work under the existing rules. Continuing authority does not supply missing permissions or authorize every remaining roadmap item.

## Operation boundaries

- Confirm the intended target and authorization before publication, approval, merge, deployment, or destructive operations. Reuse an explicit authorization while its scope and conditions remain valid.
- Resolve exact targets, files, parameters, and steps from the task and verifiable Human instructions; this is the agent's responsibility, not a separate approval stage. Reuse effective project, batch, or slice authorization for covered work and coordination. Ask only for a missing business decision, material scope expansion, or uncovered operation, naming the specific change and decision needed. Preserve explicit restrictions and actual host or platform refusals.
- A request to inspect does not authorize changing the inspected material. A review request includes local validation under the boundary below. Review success does not authorize publication or merge.
- Keep secrets out of source, logs, and review material. Host access is not business authorization. Respect host permissions and repository protections; do not bypass denied access or required checks.
- Use the relevant tool skill for its supported invocation and failure handling. Load references only as needed, resolving them from the physical installed skill directory.
- Before running code tools, including agent sessions, Git, builds, and tests, apply the shared [execution context contract](tool-contracts.md#执行上下文). Reuse a verified binding while its inputs remain unchanged.
- For everyday CLI tools (`git`, `rg`, `jq`, `curl`, `ssh`), follow standard safe invocation (quote arguments, use literal `rg -F` when appropriate, pass `jq --arg`, use `git fetch` rather than implicit `git pull`). Read the specific section in [tool-contracts.md](tool-contracts.md) only when performing non-routine remote pushes, complex pagination, or repository gate checks.
- Check the outcome of external writes. When the outcome is unknown, read back the same target before considering another attempt; preserve the tool's attempt and recovery limits.
- Make persistent configuration changes only within their authorized targets, with a recoverable previous state.

## Validation and review

- Apply [checks](review.md#checks) to local edits and validation. Load additional [review rules](review.md) by heading when conducting formal PR review, disposing of findings, executing merge admission, or preparing sensitive credential, access-control, or destructive migration changes.

### Checks

See [the shared rules](review.md#checks).

## Code preferences

- Before implementing or reviewing code in a project that explicitly adopts the [Rust preferences](rust.md) or [SQL preferences](sql.md), read the adopted source and applicable sections. Resolve this document's policy links relative to this document, honor project overrides, and keep team requirements, business invariants, and project validation commands in the consuming repository's `AGENTS.md`.
- Follow the target project's language, framework, and runtime conventions. Prefer TypeScript for new repository maintenance tools when the project permits it; do not migrate existing tools solely for language uniformity.
- Before adding a similar capability, trace an existing consumer end-to-end (input parsing, validation, domain construction, use, and error handling) and reuse established responsibility boundaries. Prefer simple code with concrete responsibilities; add abstractions or wrappers only for actual consumers.
- Group data and settings by capability and ownership: keep deployment configuration separate from business records, let deserialization structures own input shape and required/optional fields, and keep domain invariants behind validated constructors with the narrowest useful visibility.
- Prefer well-maintained standard or existing libraries over writing custom parsers or frameworks, and verify exact byte-level behavior for signatures, encodings, and protocols.
- Use short, precise business names without redundant type suffixes; name Booleans with adjectives and predicates with actions.
- Trace errors to their handling boundary, log final failures once with structured context and no secrets, and distinguish confirmed external-write failures from unknown outcomes before retrying.
- Test observable behavior, failure paths, and boundaries with independently derived expectations and explicit timeouts for concurrent tests.
- Keep comments focused on non-obvious reasons, update affected docs and references after renames or removals, use signed atomic Conventional Commits when committing is authorized, and preserve model/session commit trailers when supplied by the environment.

## Writing

- For substantive documentation, read relevant sections of [writing.md](writing.md) and follow the target project's documentation conventions. If the installed reference is unavailable, report the missing reference without inventing its contents or claiming it was checked.
- Resolve the delivered [prose checker](../tools/check-prose.mjs) and [identifier checker](../tools/check-ids.mjs) relative to this product's delivery root. Run the prose checker on changed documents to check spacing between Chinese and Latin characters or digits, and the identifier checker where a table names its rows by number. A zero exit status establishes only those checks; judge clarity and the remaining writing conventions yourself.

## Native design documents

- Before any macOS `.sketch` inspection, diagnosis, creation, editing, or review, load the delivered `sketch-native` skill. Follow its native Sketch MCP and bundled `sketchtool` workflow and reusable Library consumption requirements for UI designs. Never read, synthesize, or mutate `.sketch` ZIP/JSON archives with offline scripts. If the selected executor lacks the required native capability, retain the requirement and resolve the capability gap rather than substituting an offline archive workflow.
