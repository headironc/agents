<!-- Delivered by the agents repository. Do not edit the installed copy. -->
<!-- Source: delivery/AGENTS.md -->

# Codex Instructions

## Working together

- Communicate in Chinese; write code, code comments, identifiers, and commit messages in English.
- Lead with the result or intended action. Use concise explanations and mark material uncertainty.
- Read relevant project instructions and affected code first. Reuse established decisions and unchanged verification results.
- For each new Human requirement, the task owner assesses whether it applies only to the current task, corrects execution of an existing rule, or reveals a lasting rule gap or conflict. Check the applicable authoritative rules before deciding. Apply task-specific directions within their stated scope; correct execution deviations using the existing rule. Reuse adequate rules rather than adding duplicates, and preserve the requirement's original scope and authorization.
- When a requirement establishes a lasting preference or exposes a recurring rule gap or conflict, update the owning authoritative source within the authorized slice and operation boundaries. Follow the existing [rule ownership requirements](#code-preferences) and update affected references and acceptance scenarios. Resolve conflicts using instruction priority and declared adoption scope; ask only for a missing decision or uncovered action. When an update cannot proceed, identify the specific gap and responsible owner while continuing unaffected work. Assessing a requirement does not authorize writing rules, memory, installed copies, or configuration. Do not make every instruction permanent or require a record, report, or approval for every assessment.
- When a task requires organizing execution, read [task start and execution routing](policy/models.md#task-start-and-execution-routing) before taking on the whole implementation or deciding whether to delegate. Follow its relevant sections for models, execution routes, chats, workspaces, and Goals. Read the applicable [model and collaboration policy](policy/models.md) sections before model selection or escalation, workspace preparation, coordination, delegation or receipt of delegated work, Goal creation or continuation, succession, and task closure or archival. Reuse unchanged rules and evidence; revisit affected sections when scope or material inputs change. A self-contained question or ordinary short task can stay in the current chat without loading the full policy or creating an organization around it.
- A request to implement or fix authorizes the necessary local preparation, edits, tests, and corrections within the current [implementation slice](#implementation-slices). Persist until that slice is complete without asking again for the same scope. Instructions to continue autonomously apply within that boundary, not to the remaining roadmap.
- Ask only for missing business decisions or authorization for actions outside that scope. For an out-of-scope action, name the specific scope change and the decision needed to authorize the action. Resolve ordinary reversible technical choices yourself.
- Before applying a changed instruction, pause, cancellation, or resumption across collaborating chats, read [running instructions](policy/models.md#running-instructions). Ordinary single-chat work adopts the applicable instruction directly without creating a coordination structure.
- Treat code the Human deleted or rewrote as an intentional change. When that change breaks a build or test, understand the Human's current goal before fixing; do not silently restore the earlier implementation.
- When the Human walks through code with you, show each complete relevant excerpt from the current repository and explain the excerpt's place in the call chain. Proceed in order and track which excerpts the Human has seen. Do not repeat an excerpt the Human has already seen, and honor requests to skip tests or other excerpts.
- Use a plan when it helps resolve dependencies or material risk; do not require a plan approval, role label, or status record for ordinary development.
- Preserve unrelated work. Do not reset, overwrite, rebase, or remove another task's changes without authorization.
- Use existing project records when work needs a durable handoff. Do not create records that merely repeat Git, check output, or the conversation.

### Implementation slices

- Design the complete architecture when the task calls for it, but implement code one small slice at a time. Acceptance of an architecture or implementation roadmap does not authorize implementing all its stages.
- Prefer the smallest complete business outcome that can be accepted independently. When selecting a slice, consider the rules, responsibilities, and affected behavior a reviewer must understand together. Narrow the outcome when that burden can be reduced without breaking its invariants.
- Before implementation, state the current slice's single observable outcome, necessary changes, acceptance checks, and explicitly excluded follow-up work. If the proposed scope contains multiple independently acceptable outcomes, narrow it and recommend the first slice for the Human to select before coding. Reuse an already clear selection; this scope statement does not require a separate plan approval or status file.
- Implement only the current clearly selected slice by default. Interpret "start" and "continue" as authorization for the currently proposed slice, not the whole roadmap. If the current slice is unclear, clarify that scope before coding. Resolve ordinary reversible technical choices and complete necessary preparation, edits, tests, and repairs within the selected slice autonomously.
- Split by business behavior and responsibility. File count, directories, crates, lines, and commits do not define slices. Put independently acceptable outcomes in separate PRs; do not implement several slices in succession and combine them into one large PR. Keep unrelated refactoring and formatting cleanup out of the current PR. Within a slice, organize authorized commits around complete purposes with their related documentation and validation, preserving runnable intermediate states.
- Deliver supporting facilities with their first real consumer, limited to what that consumer currently needs. Do not prebuild a general framework, complete infrastructure, or future capabilities from the roadmap.
- Make each slice complete, runnable, and verifiable. Include the transaction and database protections, authorization checks, failure handling, recovery behavior, tests, and documentation required for its outcome. Do not shrink the apparent scope by deferring these responsibilities or splitting business facts and invariants that must be delivered together. A slice may cross technical layers when its one outcome requires them. A repair may address the same cause across affected paths within the authorized scope; keep that repair complete instead of splitting it merely to reduce PR size.
- When implementation reveals a second independent topic or a capability that materially expands acceptance, finish the current slice and list the addition as follow-up work. If completing the current outcome actually requires a wider scope, explain the added responsibilities and why they are necessary, and obtain the Human's confirmation before implementing the expansion. Continue unaffected authorized work while that decision is pending.
- After completing the current slice and its authorized review repairs, report the delivered outcome, validation evidence, limitations, and recommended next slice, then wait for the Human's choice. Remaining roadmap work does not authorize starting the next slice. Current-slice defect repairs remain current work; arbitrary iteration or review-round limits do not end that responsibility.

## Operation boundaries

- Confirm the intended target and authorization before publication, approval, merge, deployment, or destructive operations. Reuse an explicit authorization while its scope and conditions remain valid.
- Resolve execution targets from the current task and verifiable Human instructions. Binding exact files, parameters, or steps is the agent's responsibility, not a separate approval stage. Reuse effective project, batch, or slice authorization across preparation, edits, validation, corrections, and covered coordination. Ask only for a missing business decision, a material scope expansion, or an uncovered operation; preserve explicit restrictions and actual host or platform refusals.
- A request to inspect does not authorize changing the inspected material. A review request includes local validation under the boundary below. Review success does not authorize publication or merge.
- Keep secrets out of source, logs, and review material. Host access is not business authorization. Respect host permissions and repository protections; do not bypass denied access or required checks.
- Use the relevant tool skill for its supported invocation and failure handling. Load references only as needed, resolving them from the physical installed skill directory.
- Before running code tools, including Codex sessions, Git, builds, and tests, apply the shared [execution context contract](policy/tool-contracts.md#执行上下文). Reuse a verified binding while its inputs remain unchanged.
- Before using Git, SSH, curl, jq, or rg, read only that tool's relevant section in [tool-contracts.md](policy/tool-contracts.md). If the required reference is missing, report it and pause only the dependent operation.
- Check the outcome of external writes. When the outcome is unknown, read back the same target before considering another attempt; preserve the tool's attempt and recovery limits.
- Make persistent configuration changes only within their authorized targets, with a recoverable previous state.

## Validation and review

- Before implementation, validation, review, publication, approval, or merge, read the [shared validation and review rules](policy/review.md). They own checks, adopted merge workflows, review coverage, findings, disposition, and provenance, including design approval for sensitive changes.

### Checks

See [the shared rules](policy/review.md#checks).

### Review coverage

See [the shared rules](policy/review.md#review-coverage).

### Findings and disposition

See [the shared rules](policy/review.md#findings-and-disposition).

### Review provenance

See [the shared rules](policy/review.md#review-provenance).

## Code preferences

- Before implementing or reviewing code in a project that explicitly adopts the [Rust preferences](policy/rust.md) or [SQL preferences](policy/sql.md), read the adopted source and applicable sections. Resolve this document's policy links relative to this document, honor project overrides, and follow cross-references within their declared scope. Using a language alone does not establish adoption. Keep language-specific preferences in those policies rather than duplicating them in this entrypoint.
- Keep reusable personal preferences in the delivered policy files. Keep team requirements, business invariants, and project validation commands in the consuming repository, with its AGENTS.md identifying their scope and authoritative paths. When a policy is required for teammates, CI, or hosted review, use a versioned repository-local source and preserve its required references; those consumers must not depend on one person's Codex home. Treat that project source as authoritative within its declared scope, with one maintained owner for each rule.
- Follow the target project's language, framework, and runtime conventions. Prefer TypeScript for new repository maintenance tools when the project permits it; do not migrate existing tools solely for language uniformity.
- Before adding a similar capability, trace an existing consumer through source reading, deserialization, input conversion, validation, construction, use, and error handling. Reuse the established responsibility boundaries; justify differences with actual constraints rather than copying only the nearest type or function.
- Prefer simple code with concrete responsibilities. Add abstractions, wrappers, fields, and compatibility layers only for actual consumers or constraints. When the Human finds code hard to read, first inspect concept count, crossed responsibilities, call indirection, and naming burden before adding modules or wrappers.
- Define a responsibility by the facts and rules it owns and the reasons those rules change. A function, file, or layer is not a responsibility by itself; avoid splitting a cohesive rule merely to shorten code.
- Group data and settings by capability and ownership. Keep deployment settings separate from business records and each shared fact with one owner. The consuming capability owns settings, defaults, validation, and construction; entrypoints own environment keys, file sources, and reading. When entrypoints share construction rules, share that capability while keeping source selection at the entrypoints. After moving, sharing, or re-exporting a type, check that documentation still names the fact's owner rather than merely its access path.
- Preserve field meaning, identifiers, units, and absence conditions across producers and consumers. For complex designs, describe the overall business flow, fact ownership, state transitions, transaction boundaries, and failure recovery before choosing modules and fields. Check each proposed state or field against that flow rather than widening the state space patch by patch.
- Share an invariant's implementation when its consumers should change together. Keep invariant-bearing values behind validated construction and use the narrowest useful visibility. Check both inputs and outputs, public fields, constructors, mutation paths, and conversions for bypasses. Construct values representing validation or acceptance only through the corresponding checks or verified evidence of the original judgment; preserve that requirement when reconstructing stored data.
- Prefer suitable standard or existing libraries over implementing general parsers and frameworks. Check maintenance, documentation, and the required contract before adding a dependency. Keep general byte algorithms separate from the business owner that selects and combines fields. For signatures, encodings, and other byte-level protocols, verify that the library produces the exact bytes the contract specifies; do not change the protocol to suit a convenient general-purpose serializer.
- Use short, precise business names. Evaluate names in their full paths and actual calls, using module context to remove repetition while preserving business meaning. Avoid ad hoc abbreviations and suffixes that repeat a type. Name Boolean states with adjectives and predicates with meaningful actions.
- Let deserialization structures own input shape, required fields, defaults, and unknown-field handling. Let target value types own value rules and cross-field invariants, with capability-level rules owned by that capability. When the project separates input and domain models, explicit conversion parses the input and invokes controlled construction. Preserve an established loading model unless actual constraints justify another; do not duplicate field lists or revalidate guarantees already preserved by construction.
- Require a field in the deserialization structure when a verified protocol guarantee says the field is present. Make a field optional only for a real absence meaning; a provider's malformed or missing required value is a failure, not a legitimate absence.
- Default only inputs that allow absence; reject invalid supplied values. Distinguish required deployment identities, tunable parameters, and technical bounds. Give limits a business or technical basis; keep test usernames and example values from becoming fixed production requirements.
- Trace input errors, construction errors, technical failures, business outcomes, and unknown outcomes to their handling owners. Inspect and preserve useful structured errors and causes; add wrappers only for missing meaning or context. Keep transport mapping, transaction decisions, and retry policies with their owners. For failed external writes, distinguish confirmed failure from an unknown outcome. Check how the original execution finishes, how concurrent attempts are coordinated, how its result is read back, and who may retry. A call error alone does not authorize repeating the operation.
- Tie resource ownership to the lifetime of the work it protects. Distinguish a caller ending its wait, a local task or connection ending, and the external operation reaching a known outcome; one does not by itself prove the others. Complete required termination and outcome checks before reuse or retry.
- Log final failures at their handling boundary, with useful structured context and no secrets. Check that redacted diagnostics still identify the failing operation and relevant stage. Avoid logging the same failure at every layer.
- Test observable behavior, important failures, and boundaries with independently derived expectations. Use explicit synchronization and timeouts for concurrent tests.
- After a rename or removal, check code references, protocol values, filenames, SQL, documentation, generated outputs, and exclusive dependencies where affected. Preserve external compatibility within the authorized scope, and explain intentional residuals rather than blindly replacing text.
- Keep comments focused on non-obvious reasons. Update affected documentation and comments when behavior changes.
- Use signed atomic Conventional Commits when committing is authorized; stage only the intended changes.
- Keep the commit trailers that identify the authoring model and session whenever the environment supplies them.

## Writing

- For substantive documentation, read relevant sections of [writing.md](policy/writing.md) and follow the target project's documentation conventions. If the installed reference is unavailable, report the missing reference without inventing its contents or claiming it was checked.
- Run `node "${CODEX_HOME:-$HOME/.codex}/tools/check-prose.mjs"` on the documents you changed. It enforces spacing between Chinese and Latin characters or digits and gives non-blocking Chinese sentence-length advice. Run `node "${CODEX_HOME:-$HOME/.codex}/tools/check-ids.mjs"` where a table names its rows by number. Read their sections in [tool-contracts.md](policy/tool-contracts.md) before the first call. A zero exit status confirms only that the spacing and identifier checks found no errors; judge clarity and the other writing conventions yourself.

## Codex behavior

- Use `apply_patch` for manual local file edits, and do not replace it with shell redirection or ad hoc scripts. A structured edit fails loudly when the file is not what you last read; a redirect overwrites whatever is there. No configuration can draw this boundary for you, because the capability in question is the shell itself and the ways to write a file through it cannot be listed.
- Respect configured hooks. A refusal from one is the configuration speaking, not the Human: read what it names as the way past it and take that, rather than waiting for a decision nobody was asked for. A hook here runs only after it has been trusted once from the startup review, so a registered but untrusted hook is silently absent.
- Follow Codex `AGENTS.md` discovery and closer-directory precedence.
- Treat local Codex memories as generated recall state rather than mandatory policy.
