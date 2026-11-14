# Shared execution rules

## Local development

Run source edits, builds, debugging, and developer tests on the development device selected by the Human. Keep the current verified device and checkout until an authorized change. Use the project's supported native environment; containers and VMs require project support and effective authorization. Bind macOS-only native or pixel acceptance to a capable macOS host and the same candidate.

Apply the [untrusted-input execution boundary](tool-contracts.md#不可信输入的执行) before running candidate-controlled code or dependencies. If the device lacks suitable isolation, continue trusted local work and static preparation, using the project's supported isolated CI path for untrusted execution.

## Desktop capabilities

Select the simplest supported execution path from the actual tool inventory, relevant skills, and local commands. Reuse verified availability without a full audit at every task start. A worker, child chat, or CLI does not automatically inherit another client's browser, app connector, or chat tools. Assign each operation to an authorized executor with the required capabilities; preserve missing capabilities as explicit gaps.

## Workspaces

- **Primary checkout writable by default for solo work**: Under [local development](#local-development), bind source work to the actual repository directory on the selected device. For single-session development, edit directly in the primary Git checkout and current feature branch so local build caches (`target/`, `node_modules/`) and ignored files remain intact.
- **When to isolate in a worktree**: Allocate an independent Git worktree only when multiple sessions or conflicting WIP would collide, when isolating an experimental spike, or when the Human explicitly requests a separate worktree. Default investigation, coordination, read-only review, and single-writer tasks to Local (the existing project directory).
- **Single-worktree limit per chat**: Limit each chat to at most one owned source-implementation worktree (managed or native), counting any client-provisioned worktree and reusing existing bindings. Disposable Git fixtures created and cleaned entirely by a foreground test do not count toward this limit.
- **Staged sharing and execution context**: Design, implementation, and acceptance can share the same checkout in stages once the outgoing writer stops and the recipient verifies the candidate and WIP, reusing valid evidence under the [check rules](review.md#checks). Before editing or validating, apply the [execution context contract](tool-contracts.md#执行上下文) and preserve actual refusals under the [operation boundaries](common.md#operation-boundaries).
- **Worktree retirement**: Keep still-needed acceptance originals and required ignored recovery material outside a disposable checkout before retirement. Follow the [completion and archival requirements](#task-completion-and-chat-archival).

## Task temporary directories

Keep disposable command output under one private allocation with a traceable task or chat owner and a stated purpose. Reuse that allocation for the same foreground operation instead of scattering scratch directories. Read the [temporary-directory tool contract](tool-contracts.md#task-temp). Use tool `task-temp` for foreground commands that support its scratch environment and await all descendants. Keep Git worktrees under the existing workspace lifecycle, and keep shared caches with their capability owner.

Keep acceptance originals, recovery snapshots, and diagnostics outside disposable scratch while they remain necessary under [exercise cleanup](#test-and-exercise-cleanup). At task closeout or after interrupted execution, verify removal or record any retained allocation path, owner, retention reason, and next cleanup condition in the existing task result; use a bounded read-only scan only to locate leftovers from interrupted runs without deleting unmarked historical directories.

## Test and exercise cleanup

Treat cleanup of disposable resources created for an authorized test, probe, or exercise as part of that work. Track their ownership and locations as they are created, including resources outside scratch directories and in client storage. Once the operation and dependent acceptance work have ended, remove its unneeded temporary files, test projects or documents, test sessions, and acceptance records without waiting for another Human reminder. Include screenshots, logs, report copies, and installation-plan review copies whose consumers have finished.

Before deletion, verify exact ownership, the original operation's terminal state, and current dependencies. An empty object, idle status, old timestamp, or absence of open file handles alone does not establish that a resource is unused. Preserve unrelated work, shared resources, and objects with unresolved ownership or use. Cleanup of a read-only review covers its own disposable output; it does not authorize changing the reviewed project or document.

Preserve the current installation and necessary recovery materials, including canonical plans and receipts, backups, recovery runtimes, and required archives. Retain evidence still needed for an unresolved check, review, delivery, diagnosis, or explicit retention requirement. Verify actual consumers and recovery dependencies before removing redundant copies. Keep canonical recovery records intact, including historical paths to copies that can now be removed.

Use supported client or tool operations, and reconcile the deleted objects' registrations, indexes, caches, and resume references within the same scope. Reuse effective cleanup authority under the [operation boundaries](common.md#operation-boundaries), while honoring mandatory tool confirmations and actual refusals. Archiving a session alone does not complete its deletion. If a required decision, confirmation, or deletion capability is missing, retain only the affected resources and continue independent cleanup.

Read back the cleanup results and check preservation of any installation or recovery materials involved. Summarize the result and any retained resources, reasons, and next cleanup conditions in the existing task response or record. Do not create a new report, backup, or ledger solely to document cleanup.

## Task completion and chat archival

Before completion, handoff, or archival, reconcile task-owned scratch under the [temporary-directory lifecycle](#task-temporary-directories), finish outstanding [exercise cleanup](#test-and-exercise-cleanup), and retire unneeded task-owned worktrees. Confirmed merge readback in an authorized PR workflow triggers [worktree and branch cleanup](../skills/gh/references/operations.md#post-merge-cleanup).

Before archiving, confirm no work is running and no participant depends on the chat. Never force-remove primary, pinned, or shared checkouts. At closeout, apply [requirement assessment and ownership](common.md#working-together) to reusable rule gaps at their authoritative source without adding a ledger. Use only the actual client's supported archival operation and effective authorization.

## Continuity and evidence

Keep source reads, output collection, and handoffs within the active context budget:

- **Active context ceiling (150K tokens)**: Keep active session context below **150K tokens**, using the client's visible indicator or estimating loaded files and outputs. Never load full repository trees, lockfiles, build artifacts, or unbounded `git log` / `git diff`. Filter `rg` searches and command output at the tool boundary, using line limits and targeted file ranges.
- **Reuse without rereading**: Reuse already-read unchanged rules and valid check evidence. Do not reload full policy files or repeat passing test suites when inputs have not changed.
- **Lightweight state anchor (`progress.md` / `spec.md`)**: For cross-session or long-horizon handoffs, approaching the context ceiling, or 3 consecutive failed repairs of the same defect, update a compact anchor under 100 lines / 2K tokens. Reuse an existing task record and update state in place; do not append poll chronology or repeat raw Git history or command output. Ordinary single-session tasks need no separate record. Include the applicable sections below:
  1. **Current Slice Goal & Acceptance Checks**
  2. **Completed & Verified Facts** (commit SHAs and passing checks reusable while their inputs remain unchanged)
  3. **Active Workspace & WIP** (branch, modified files, and `git status --short`)
  4. **Eliminated Dead Ends** (approaches already tried and why they failed, preventing repeated mistakes)
  5. **Next Concrete Action** (exact target file and command to run first, plus a pre-staged next-wave backlog from the project's authoritative delivery list during authorized multi-slice coordination so the rolling parallel worker pool can be replenished immediately)
