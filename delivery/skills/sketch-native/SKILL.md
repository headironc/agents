---
name: sketch-native
description: MUST load before any .sketch inspection, diagnosis, creation, editing, or review on macOS. Use Sketch 2026.3+ MCP and sketchtool, require reusable Library consumption for UI designs, and forbid offline .sketch archive access.
metadata:
  short-description: Native Sketch workflow with required Library reuse and visual verification
---

# Sketch Native Workflow

Use Sketch 2026.3+ MCP and the bundled `sketchtool` for native `.sketch` work on macOS. This skill is delivered to Codex, DeepSeek Harness, and Antigravity CLI, and skipped off macOS.

## Bind the Task

Resolve the target document, full source path, current candidate, authorized operation, and applicable project rules before work. Project and task contracts own Library selection, visual tokens, platforms, themes, viewports, business flows, canvas organization, delivery paths, performance budgets, and acceptance gates. Keep adopted requirements within their scope; one project's choices do not become universal defaults.

Follow the host's adopted model and collaboration policy. In Codex, the installed `policy/models.md` owns design and screenshot-review routing; this skill does not redefine that route or extend it to other products.

## Required Boundaries

- Use native tools and public APIs only. Never read, synthesize, or modify `.sketch` ZIP/JSON archives with offline scripts, and never use private native APIs as a fallback.
- Creating or modifying a deliverable Sketch UI design **must use an applicable reusable foundation Library**. Its components, variables, and styles must serve real consumers through native references. Listing or installing a Library, importing unrelated assets, or copying detached local layers does not satisfy this requirement. No universal Library name or second physical Library is required.
- Read-only review checks the same requirements without modifying documents or host state. Do not install, register, enable, import, synchronize, repair, migrate, clean up, save, or close windows during that review. Read repair guidance to assess a gap, not as permission to repair it.
- Bind documents by full path and identity. Same-ID open copies can make ID-only tools ambiguous; missing dirty state does not establish safe closure. Preserve unrelated unsaved work.
- Failed calls can leave partial writes. Read back the same target before retrying; a successful save return or an in-memory value does not prove persistence.
- Host configuration and external writes retain existing authorization boundaries. This skill never writes MCP registration or Sketch preferences. Missing authority or native capability stops dependent operations; continue unaffected preparation and report incomplete acceptance.

## Load Guidance Before the Related Operation

Read the applicable references below before acting, including during diagnosis and read-only review. Resolve links from this installed skill directory; do not depend on a repository checkout. Load only the material needed by the task.

| Task or condition | Required guidance |
| --- | --- |
| Any native inspection or tool call; document selection; bounded scans; `sketchtool` inventory, duplicate checks, or exports | [Native tools](references/native-tools.md). Load the installed MCP and use guides in the specified order. |
| Creating, modifying, or reviewing a UI design; selecting a foundation; importing components; changing shared assets or consumer synchronization | [Library selection and actual consumption](references/libraries.md). |
| Creating, changing, or reviewing containers, icons, styles, reflow, themes, Pages, states, or canvas organization | [Native layout and canvas requirements](references/native-layout.md). |
| Creating, changing, or reviewing prototype routes, interactions, state coverage, or visible content | [Prototype behavior and content](references/prototypes.md). |
| Saving, copying, reopening, or closing conflicting documents; same-ID or missing-layer diagnosis; import identity; shared-style failures; override integrity; resource cleanup | [Identity and mutation handling](references/identity-and-mutations.md). |
| Checking a visual change, exporting delivery previews, or completing review or delivery | [Screenshots and final acceptance](references/acceptance.md). |

## Finish with Candidate-Bound Evidence

Verify actual Library consumption, editable native structure, intended layout and interactions, and the project's required states and acceptance gates. Bind screenshots and results to the exact path, document identity, and affected layers.

For edited existing documents, use the no-path `doc.save()` for in-place saves and verify identity, persistence, duplicate IDs, references, and the reopened result through the linked procedures. Read-only reviews report the evidence present and any missing validation without performing those writes.

Report what changed, what was actually checked, and what remains unverified. Distinguish static or skill-format validation, instruction exercises, native Sketch checks, actual prototype interaction, and Human visual acceptance; none substitutes for the others.
