# Model selection

This policy owns Codex model and execution-route selection, native chats, Goals, collaboration, and succession. Shared workspace, context, and closeout rules belong to [execution](execution.md); project adoption follows the [rule ownership requirements](common.md#code-preferences).

## Stable principles

- Select a model by the business judgment, responsibility boundaries, impact, and uncertainty the work involves. File counts and lines of code do not measure that burden.
- For complex work, prefer one task or domain lead continuously responsible for understanding the business, designing responsibilities, settling key judgments, and accepting the result. That lead can delegate complete implementation while retaining those responsibilities. An explicitly adopted overall coordinator has the separate coordination role below.
- Apply model selection to both the lead agent and delegated tasks. It does not require creating subagents or building a scheduling framework. Choose within the tools and delegation authority actually available.
- Follow explicit user model choices, applicable project overrides, and higher-priority instructions. The defaults below do not override them.

## Task start and execution routing

Establish the intended outcome, current slice, authoritative sources, effective Human authorization, and any existing division of responsibility. Reuse a clear assignment and valid evidence. Route execution by task scale so both quick fixes and multi-slice autonomous projects run at maximum speed and minimal token cost:

- **Mode 1 — Direct Solo Execution (Single-Session Default)**: Complete a self-contained question, bug fix, single-slice feature, or sequential multi-slice iteration directly in the current chat (`Coder / Reviewer` at `low` effort by default) without adding a coordinator chat, Goal, or preliminary Astra stage when the Human has not adopted the overall-coordinator arrangement or requested parallel worker sessions.
- **Mode 2 — Autonomous Coordinator + Scoped Workers**: Use this mode only when the Human adopts the overall-coordinator arrangement or authorizes parallel multi-session execution across slices. The coordinator owns decomposition, interface contracts, and the active `slice -> worker_thread_id -> worktree_path` table in `spec.md` / `progress.md`. Delegate scoped work under [current defaults](#current-defaults), then apply [delegation and acceptance](#delegation-and-acceptance) and [closeout](#task-completion-and-chat-archival) before advancing covered work without routine confirmation. Keep routine coordinator context under `50K` tokens by delegating product code and noisy test suites; apply the [succession thresholds](#lead-succession), not a restart per slice.

Select the responsible role and [model](#current-defaults) separately from the client, receiving service, execution mechanism, and execution host, applying [runtime limits](#runtime-limits) to the actual invocation. Route work across the three fast/slow tiers in [current defaults](#current-defaults): `Architect / Debugger` only for initial system architecture, core invariant changes, or escalation after repeated failures; `Coder / Reviewer` (explicit `low` effort) as the daily driver for coding, refactoring, and routine review; and `Runner / Explorer` (explicit `low` effort) for codebase search, test execution, mechanical scripts, and UI/vision inspection. Apply [escalation](#escalation) when implementation reveals a new business, authorization, transaction, or recovery judgment, continuing unaffected work while that lead resolves it.

Apply [local development](#local-development) when choosing the execution host and the [workspace rules](#workspaces) when choosing a new chat's binding. Each owner completes the assigned implementation, validation, signing, publication, and repairs from a suitable local workspace within effective authorization, using the project's normal Git, PR, and CI flow. Coordinate integration through identified Git revisions and their evidence. A change of role, model, or chat does not require copying the candidate or creating another checkout.

When organized implementation belongs to another project, route the slice to that project's responsible chat before writing source. Reuse a suitable existing owner. The recipient verifies the original grant, target project, checkout, candidate, writable scope, and acceptance conditions under [delegation and acceptance](#delegation-and-acceptance), then accepts the assignment. The originating chat retains coordination and its own project's work. A cross-project request does not transfer workspace ownership or authorize a competing writer. If the target owner or dispatch authority is missing, resolve that gap and continue independent authorized preparation.

When authorized to organize independent tasks, prefer visible, persistent chats. Use that route for complete independent implementation, PR delivery, follow-up repairs, or ongoing responsibility. Use authorized internal subagents for small, well-defined auxiliary work within the same task, returning results to the original owner; preserve the writable scope and single-writer requirements. The short-task rule above still allows self-contained work in the current chat. Choose the actual client and execution mechanism, including [DeepSeek Harness (`dsh`)](#deepseek-harness-delegation), by the complete result, acceptance needs, supported capabilities, and cost of splitting a cohesive responsibility. Apply the single [route preference](#route-model-preferences) before assigning execution, including complete implementation. A visible-chat request requires a visible chat; an internal subagent does not substitute for it. If the required native chat entry point is unavailable, report the specific gap and select a supported, authorized path; do not mask an independent-chat requirement with a subagent. This preference grants no chat-creation authority. Create chats only under effective Human authorization, reusing a covered batch grant without a new approval for each covered dispatch. Do not create a chat for every small step. Use the [delegation contract](#delegation-and-acceptance) for binding, original authorization, writer ownership, result delivery, and acceptance.

For design-draft creation and iteration, use the Codex model and effort in [current defaults](#current-defaults), honoring an explicit Human choice under [runtime limits](#runtime-limits). Load `sketch-native` for macOS `.sketch` documents, or produce a project-supported editable source (such as local HTML/CSS) with durable rendered previews rather than flattened images or short-lived asset URLs; freeze an approved visual direction and stop after the authorized slice without expanding into product-code implementation. DeepSeek Harness (`dsh`) is an optional route under effective Human choices, not a prerequisite for producing a draft. Open readable full-screen PNG or inline previews matching the final candidate revision for visual acceptance (never relying on node JSON, URLs, or stale screenshots); when Terra assists with reference-image understanding or draft inspection (or when same-model critique runs as a self-check), filter observations against actual pixels and product requirements, check mobile keyboard/focus layouts where applicable without claiming static placeholders prove real OS input, and retain lead-agent acceptance. For browser or desktop interface operation, default to Terra under the model table and runtime limits. Prefer a suitable connector or API when available; a model preference does not require using a GUI.

Before execution, settle [workspace binding](#workspaces), any authorized [Goal](#goals), and the recipient's verification under [delegation and acceptance](#delegation-and-acceptance). Complete the selected slice and repairs under the [implementation rules](../AGENTS.md#implementation-slices). Notify or wake the original owner promptly when a result or next authorized action is ready; distinguish actionable work from dependencies and running operations. A turn ending does not complete the responsibility.

## Local development

Apply [shared local development](execution.md#local-development). When the Human switches the development device across collaborating Codex chats, apply [running instructions](#running-instructions) before the next affected operation.

### Desktop capabilities

Apply [shared capability checks](execution.md#desktop-capabilities), binding Codex Desktop stages under [delegation and acceptance](#delegation-and-acceptance). Resolve workspace dependencies under [workspaces](#workspaces) and [check rules](review.md#checks).

## Current defaults

These are maintained usage defaults optimized for solo full-stack latency and cost efficiency, not official capability guarantees or proof that a model is available. Keep the mapping here so model updates do not duplicate or redefine the stable principles.

| Role & Work Tier | Preference | Model identifier | Reasoning effort |
| --- | --- | --- | --- |
| **Architect / Debugger**: Initial architecture, complex domain boundaries, and core authorization, transaction, concurrency, or recovery invariants | Astra Medium / High | `gpt-6-astra` | `medium` (default) or `high` |
| **Architect / Debugger (Escalation)**: Unresolved cross-module defects or rule conflicts after 2+ failed repair attempts | Astra High | `gpt-6-astra` | `high` |
| **Coder / Reviewer (Daily Driver)**: Feature implementation, refactoring, unit tests, and routine code review under a confirmed design | Sol Low (or Gemini / DeepSeek / Qwen) | `gpt-6.1-sol` (`gemini-3.8-flash` / `deepseek-v4.1-flash` / `qwen`) | `low` (explicit default; `medium` only for multi-hop call chains) |
| **Designer (Page & Stack Layout)**: Native `.sketch` or editable UI draft page composition, library component selection, and Stack hierarchy planning | Sol Medium | `gpt-6.1-sol` | `medium` (`high` only for complex multi-state layout constraints) |
| **Designer (Incremental Property & Override Edits)**: Local `.sketch` or editable draft copy, style, symbol override, and prototype link updates | Sol Low / Luna Low | `gpt-6.1-sol` or `gpt-6-luna` | `low` (small single-action edits) |
| **Runner / Explorer**: High-frequency file search, test execution, mechanical edits, and lightweight scripts | Luna Low | `gpt-6-luna` | `low` |
| **Runner / Explorer (UI & Vision)**: Browser/desktop operation, reference-image understanding, and `1x`/`2x` PNG visual draft inspection | Terra Low | `gpt-6.1-terra` | `low` |

The design-draft preference splits initial page/stack layout (`medium` effort) from incremental MCP property, symbol override, and copy refinements (`low` effort), while ordinary product-code implementation keeps its own default (`low` effort). The Terra preferences follow the Human's workflow choice and the [official visual and computer-use positioning](https://learn.chatgpt.com/docs/models); they are not evidence of local design quality or end-to-end operation. Terra assistance preserves the selected design route and lead acceptance and does not expand permission to operate apps, create chats, or create Goals.

## Route model preferences

Honor an effective Human model choice first. Filter candidates by permitted receiving services and material, supported account and invocation arrangement, actual tools, input modalities, available usage, and task acceptance needs. Then choose a suitable model and effort. Model names alone do not establish these conditions. Prefer an adequate lower-cost execution option without transferring unresolved business judgments away from their owner. Do not run a comparison across models merely to select one or add a per-call billing approval.

External OpenAI-compatible or official provider routes (Gemini, DeepSeek, Qwen) are optional routes when the task and actual capabilities fit, with no fixed call share or quota target. This preference does not authorize model trials, new material recipients outside the task grant, or bypassing permissions.

The Codex table above owns defaults for Codex leads and chats. The following preferences map work to model families within the selected, authorized route; they do not create a chat or authorize a model trial. Preserve the lead's key judgments and acceptance. These are maintained starting points, not measured local rankings or equal reasoning budgets across providers.

| Authorized route | Work | Model preference | Starting effort |
| --- | --- | --- | --- |
| Official DeepSeek, OpenCode, Gemini, or Qwen route | Bounded daily coding, refactoring, repairs, tests, and documentation | `deepseek-v4.1-flash` / `gemini-3.8-flash` / `qwen`; resolve the route-specific identifier under the invocation contract | Explicit `low` for daily coding, refactoring, and mechanical work; `medium` or `high` only for escalated multi-hop reasoning |

For DeepSeek and OpenCode routes, resolve client aliases and supported effort under the [invocation contract](deepseek-harness.md). The `[1m]` suffix is a client option only when the actual route supports it, not part of the raw API model ID. V4.1 Flash at `low` effort is the current daily-driver preference for ordinary execution, rising to `high` only when escalated for concrete multi-hop uncertainty. Do not infer a stronger tier from Pro or Flash branding. Verify the actual route's model metadata before assigning tools, images, or other modalities. A remaining capability gap returns to the lead for selection within existing authority.

The [OpenAI model documentation](https://learn.chatgpt.com/docs/models) and [DeepSeek model details](https://api-docs.deepseek.com/quick_start/pricing/) ground the route-specific capabilities. Invocation support still belongs to the actual client. Compare costs using the selected route's account and usage evidence. Recheck affected facts after a catalog, route, or capability change, not before every command.

## Escalation

- Keep `Runner / Explorer` and `Coder / Reviewer` tiers at explicit `low` effort by default under [current defaults](#current-defaults) and [route model preferences](#route-model-preferences) to eliminate reasoning latency.
- Move a Luna (`low`) task to Sol (`low` or `medium`) when it requires tracing a multi-file call chain or coordinating behavior across modules. Move it directly to Astra (`medium` or `high`) when it involves key business or responsibility judgments.
- Move a Sol (`low`) task to `medium` effort when local multi-hop reasoning is needed, or escalate to `Architect / Debugger` (`gpt-6-astra` at `medium` or `high`) only when it introduces a new judgment about fact ownership, state rules, authorization order, transaction boundaries, or recovery responsibility, or after 2 consecutive failed repair attempts on the same defect.
- At Astra (`medium` or `high`), first gather the authoritative rules and trace the actual call chain. If rules still conflict or repairs of the same failure class repeatedly fail, identify the specific contradiction or evidence gap before raising effort to `high`. Reconsider the underlying assumptions instead of repeating them with more reasoning. Return immediately to the daily-driver model (`Sol Low`) once the architectural or debugging blocker is resolved.
- Ask the Human for missing business decisions. Escalation neither supplies those decisions nor expands the [implementation slice](../AGENTS.md#implementation-slices) or [operation authority](../AGENTS.md#operation-boundaries).
- Within a selected external route, use the [route model preferences](#route-model-preferences) for the assigned result. A lighter execution model that encounters an unresolved responsibility or capability boundary returns that judgment to the lead; it does not silently change providers or take over acceptance. Raise only supported effort for a specific remaining uncertainty, choose a stronger suitable family when needed within authority, and return to `low` effort execution after the issue is settled. Never make `high` or `max` effort the default for daily work.

## Runtime limits

- Use only models, reasoning levels, and switching mechanisms supported by the actual tool interface, honoring explicit Human model choices and their scope. Evaluate `model` and `effort` fields independently: if the model field cannot be overridden, still pass the selected `effort` (such as `low`) when supported rather than silently inheriting `high` or `max`.
- Verify emitted parameters and supported readback under the [check rules](review.md#checks). Distinguish requested settings, saved chat settings, and server execution identity; report unverified layers as unknown without omitting permitted parameters.
- Apply per-call or per-chat model choices through supported invocation parameters without modifying persistent global configuration or expanding tool permissions. Product controls are described in the [official OpenAI model documentation](https://learn.chatgpt.com/docs/models).

## Workspaces

Apply the [shared workspace rules](execution.md#workspaces). In Codex Desktop (`create_thread`), resolve the repository's `projectId` via `list_projects` and bind `target: { type: "project", projectId, environment: { type: "local" } }`, using `environment: { type: "worktree" }` only for an isolated writer. Never create a repository coordinator, successor, reviewer, or worker chat with `target: { type: "projectless" }`, even when its handoff anchor sits outside the checkout.

## Task temporary directories

Apply the [shared temporary-directory lifecycle](execution.md#task-temporary-directories).

## Goals

Create a Goal only when sustained pursuit is appropriate and the Human explicitly authorizes Goal creation for that outcome and chat. A Goal records the intended business outcome, scope, required evidence kinds and success criteria, stable constraints, exclusions, and completion conditions; keep runtime instances, progress, logs, operation handles, and detailed evidence in existing task material (`progress.md` / `spec.md`) under the [content boundary](#goal-and-authorization-content). During initial startup or formal succession covered by the original Goal-creation grant, if `get_goal` returns `null`, create the full Goal from the original Goal and latest effective instructions through the [supported Goal interfaces](#goal-tool-interfaces) and read back the complete effective text before ending the turn—even if a Human or worker message arrives mid-startup and requires handling in the same turn.

When instructions change, reconcile them with the full outcome and remaining responsibilities under the [continuing delivery boundary](../AGENTS.md#continuing-delivery), [automatic-review policy succession](#automatic-review-policy-succession), [continuity](#continuity-and-evidence), and [completion](#task-completion-and-chat-archival) rules without falsifying Goal completion.

### Goal and authorization content

Keep Goal and `auto_review.extra_policy` text stable when only the execution instance changes: exclude chat, PR, candidate/head, run, and document identifiers, temporary paths and ports, current queues, progress, logs, and operation handles, keeping those runtime facts in execution material while preserving stable business boundaries (repository, integration branch, and data exclusions). Preserve object, count, device, recipient, material, condition, exclusion, pause, and stop limits so removing instance IDs never turns a single-object or one-time grant into broader authority; before a dependent action, provide the retrievable original authorization and exact action/target mapping (available to the reviewer when required), pausing only the dependent action if that source or mapping is missing.

### Goal tool interfaces

Check the actual interface before calling it: verify chat creation before calling `create_goal`, put the full objective in `objective`, set `token_budget` only when explicitly requested, and use `get_goal` to read back the text. In `update_goal`, set `paused` only at the Human's explicit request, `complete` only when the objective is achieved and no required work remains, and `blocked` only after the same blocker has recurred for at least three consecutive Goal turns with no meaningful progress possible.

## Automatic-review policy succession

When the Human authorizes this workflow for a project and outcome, bind permission gaps to the requested action, target, effective Human authorization, and technical constraint while continuing independent work. At a safe handoff boundary or when a verified gap blocks the critical path, reconcile the complete `auto_review.extra_policy` with still-effective grants (applying the [shared content boundary and exact action mapping](#goal-and-authorization-content)), preserve a recoverable prior value outside disposable scratch, update the field with version checking, and read back the saved configuration. Then apply [lead succession](#lead-succession) or owner handoff to transfer the active Goal, candidate, WIP, and operation handles without restarting in-flight operations, preserving [Goals](#goals) boundaries.

## Delegation and acceptance

- **Lead ownership and scoped dispatch**: Keep one lead or [autonomous coordinator](#task-start-and-execution-routing) responsible for task decomposition, interface contracts (`spec.md` / `progress.md`), and acceptance. Select subsequent slices under the [continuing delivery boundary](../AGENTS.md#continuing-delivery) and bind workspaces under [local development](#local-development) and [workspaces](#workspaces). Create visible collaborating chats or subagents only within effective Human authorization; ordinary single-slice tasks stay in the current chat.
- **Exact slice binding**: Bind each delegated slice to one observable outcome, exact files, interface contracts, permitted operations, excluded work, acceptance commands, sole writer, and result path. Before dependent work, the recipient verifies the original requirements, design, execution binding, authority, and acceptance conditions. Preserve [operation boundaries](../AGENTS.md#operation-boundaries) and the applicable [DeepSeek Harness contract](deepseek-harness.md). The implementation author owns authorized commits, pushes, PR publication, and current-slice repairs by default, applying [pre-push checks](review.md#checks).
- **Result and follow-up**: Observe workers under [asynchronous observation](review.md#asynchronous-observation). Return a compact receipt with the commit SHA, changed files, check status, and remaining boundaries. The coordinator verifies the actual diff and evidence under [checks and admission](review.md) and [review provenance](review.md#review-provenance), updates `progress.md`, and dispatches the next covered slice without waiting for Human relay. Apply [closeout](#task-completion-and-chat-archival) when the preceding responsibility ends.
- **Rolling Mode 2 pool**: While independent, non-overlapping authorized slices remain, maintain dedicated-worktree workers for offline implementation and self-checks (for example, 3–4 `Coder / Reviewer` `low` workers). Serialize only shared single-slot gates, such as native Sketch MCP or PR publication and merge. Replenish a freed worker slot from the pre-staged `progress.md` backlog when a slice enters that gate or completes merge closeout, without waiting for the batch to drain.
- **Shared-slot handoff**: Before granting a serialized resource to the next worker, verify that its previous holder released it to a clean baseline. Recover an orphaned disposable document only after confirming no active write remains.

### Cross-chat message routing

Before sending a cross-chat message, verify the current owner's host and complete chat ID, and send only messages needed for an assigned action, dependency, handoff, or completion receipt. Reuse accepted deliveries without acknowledgment loops.

### Official Codex coordination across devices

When the Human adopts cross-device coordination (such as between a Mac and a Linux `dev` host), bind the primary coordinator and device-local coordinators to their respective hosts, applying [Goals](#goals) and [automatic-review policy succession](#automatic-review-policy-succession) within each host's scope. Use official interactive Codex sessions when cross-client visibility is required, and update the active receiver's host and chat ID on formal [lead succession](#lead-succession).

### Running instructions

When work changes, pauses, is cancelled, or resumes, verify the original Human instruction and propagate the updated boundary to affected workers through [delegation and acceptance](#delegation-and-acceptance) before adding new dispatches. A pause or cancellation retains responsibility for in-flight operations and safe closeout under [operation boundaries](../AGENTS.md#operation-boundaries) and [asynchronous observation rules](review.md#asynchronous-observation), preserving unaffected evidence under [check and review rules](review.md), [continuity and succession](#continuity-and-evidence), and [completion rules](#task-completion-and-chat-archival).

## Task completion and chat archival

Apply the [shared closeout rules](execution.md#task-completion-and-chat-archival).

In Mode 2, successful merge readback, or a helper/duplicate worker being superseded with no remaining responsibility or in-flight operation, triggers these three steps as one atomic closeout before its slot advances:

1. Retire its dedicated worktree and merged branch under the cleanup contract.
2. Archive the completed worker with `set_thread_archived` and `archived: true`; do not select only coordinator titles and leave completed workers open.
3. Move its active `slice -> worker_thread_id -> worktree_path` entry to completed facts in `progress.md`.

## DeepSeek Harness delegation

Consider external CLI delegation under [local development](#local-development) and [route preferences](#route-model-preferences) when task scope and capabilities fit, assigning complete slice implementation, tests, or repairs under [delegation and acceptance](#delegation-and-acceptance) while design drafts follow the [design route](#task-start-and-execution-routing) (and `sketch-native` on macOS `.sketch` documents). Select only the official OpenCode Go (`opencode-go`) or official DeepSeek (`deepseek-official`) routes explicitly defined by the [invocation contract](deepseek-harness.md).

Read the [DeepSeek Harness invocation contract](deepseek-harness.md) before invocation. Use tool `dsh` within that contract and effective authorization. Bind one observable result, the workspace (`cwd` and any required `--add-dir`), candidate, permitted operations (`--permission-mode` and `--approval-policy`), and acceptance checks, applying the shared [execution boundary](tool-contracts.md#不可信输入的执行) and verifying both exit code `0` and `final.reason.kind === "completed"` under the [completion and recovery rules](deepseek-harness.md#事件采集成功判据与异常恢复). Verify the actual diff and candidate-matched checks before accepting the returned result.

## Continuity and evidence

Apply the [shared context and evidence rules](execution.md#continuity-and-evidence). In Mode 2, include the next-wave backlog from the project's authoritative delivery list so the authorized worker pool can be replenished.

### Lead succession

Use **token-threshold and checkpoint succession** rather than fixed wall-clock timers:

- **Trigger conditions**: Hand off as context approaches its ceiling, at the repeated-repair threshold above, at a clean slice checkpoint with already elevated context, or on a transfer of responsibility. Finishing a slice or waiting on an external run in a healthy low-context session (such as a coordinator under `50K` tokens) does not trigger restart; do not chain successors across routine slices. See [OpenAI's chat-context guidance](https://developers.openai.com/blog/mastering-codex-remote-for-engineering).
- **Zero-ceremony handoff and responsibility transfer**: Before ending the outgoing session, pause new dispatches, ensure active writes are saved or committed, and write the concise `progress.md` / `spec.md` state anchor (plus any active [Goal](#goals) or operation handles). Create the successor chat inside the same repository project (`target: { type: "project", projectId, environment: { type: "local" } }`, never `projectless`). The incoming owner verifies and accepts the goal (creating and reading back the full non-null Goal text before turn end when covered by Goal-creation authority, even if interrupted mid-startup), candidate, remaining responsibilities, and in-flight operation handles; the outgoing owner archives itself and ceases dispatch only after the incoming owner confirms acceptance and applicable Goal readback.
- **Clean-session startup**: The new session starts by reading `AGENTS.md`, the `progress.md` / `spec.md` anchor, any active full Goal, and only the authoritative contracts and target source files required for the next step—targeting `<5K` startup tokens without rereading old conversation transcripts or performing multi-turn handshake loops.
