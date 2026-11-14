---
name: project-guide
description: Identify a project's working version, discover task-relevant authoritative guidance, select and run its existing checks, and report evidence and gaps. Use for repository orientation or project-defined validation when the applicable sources, version, or checks need discovery.
---

# Project Guide

Use the target project's sources and only the capabilities the task requires. This skill owns discovery and validation guidance, not business decisions, implementation scope, review, or external operations. Ordinary development needs no extra workflow; orientation requires no check execution.

Read the [Git contract](../../policy/tool-contracts.md#git). Use tool `git` under that contract. Read the [search contract](../../policy/tool-contracts.md#rg). Use tool `rg` under that contract. Resolve these references from this installed skill directory.

## Identify the project and version

Bind the actual project root and execution directory to the requested branch or revision. Distinguish a requested version, a locally available remote-tracking ref, and the current worktree; a remote-tracking ref alone does not establish current server state. Include relevant staged, unstaged, and untracked inputs when the task concerns the working candidate. HEAD alone does not identify that candidate.

Read guidance and command definitions from the selected version. Reading a different revision's files does not switch the execution tree. Resolve a version mismatch before running its commands; preserve unrelated changes and use only preparation authorized by the task. Obtain a comparison baseline only when the project's checks or requested assessment require one. Report unavailable revisions or uncertain comparison scope rather than silently substituting the default branch.

## Discover authoritative guidance

Follow project instructions and navigation for this task's paths, reading order, authority, and adoption scope. Trace relevant links to their rule or executable owner without loading every document.

Distinguish confirmed decisions and current requirements from proposals, unresolved questions, samples, and historical evidence. Apply the project's precedence rules; recency alone does not settle a conflict. Expose a material unresolved conflict before dependent work, while continuing unaffected work.

When navigation is absent, inspect the existing source, manifests, scripts, and CI entrypoints to discover operational facts. State where authority is missing. Do not invent a documentation layout, copy another project's commands, or promote a sample convention into a business rule.

## Select and execute existing checks

Prefer the project's existing change classifier and check runner. Read their input contract, including baseline semantics, dirty and untracked inputs, dependency consumers, and unknown-comparison handling. A selected package is not necessarily its affected consumers. A list or classification result is a check plan, not an executed check. Follow the project's conservative fallback when comparison is unknown, retaining the reason; malformed parameters remain errors.

Without a classifier, derive checks from project instructions and actual manifest, script, or CI definitions. Follow aliases to their executable scope; preserve runtime versions, working directories, arguments, and required environment. Report actual coverage, including bundled checks, and choose a narrower supported entrypoint only when it satisfies the task.

Inspect unfamiliar entrypoints for effects before execution. A check may generate files, update snapshots, access services, or format source. Verify required runtime and tool versions before launching the dependent check. If the available version does not satisfy the project's requirement, use an already available compatible executable or report that check as blocked; do not launch it with a different version merely to obtain an exit status. Run the checks covered by the task's authorization and applicable project rules. Reuse authorized dependency preparation; when preparation or effects exceed that scope, report the exact missing prerequisite and continue independent checks. An orientation request does not authorize installation or source changes.

Record completion, exit status, and relevant output, distinguishing blocked prerequisites, failure, skipped checks, timeout, and success. After interruption or uncertainty, establish process and effect state before retrying or cleaning up. Preserve unrelated work and use existing runners and reports; do not add a generic runner, configuration, or parser for this skill.

## Report evidence and limits

Use the existing response or project record, scaled to the task. Include the project and version, relevant authority locations, selected checks and reasons, actual execution directory and arguments, results, and remaining gaps. For orientation alone, label suggested commands as unexecuted.

Reuse passing evidence only for inputs and conditions it actually covers. When code, guidance, tools, or baseline changes affect a result, recheck that coverage while retaining unaffected evidence. A clean exit establishes only the check's declared scope: classification, formatting, compilation, static checks, business acceptance, runtime behavior, independent review, and deployment are separate claims. Pending acceptance cases are not passing tests. End with the next concrete action required by an unresolved gap, without implying authority for it.
