---
name: sketch-native
description: MUST load before any .sketch inspection, diagnosis, creation, editing, or review on macOS. Use Sketch 2026.3+ MCP and sketchtool, require reusable Library consumption for UI designs, and forbid offline .sketch archive access.
metadata:
  short-description: Native Sketch workflow with required Library reuse and visual verification
---

# Sketch Native Workflow (`sketch-native`)

Shared macOS skill for native `.sketch` work through Sketch 2026.3+ MCP and the bundled `sketchtool`, delivered to Codex, DeepSeek Harness, and Antigravity CLI. It is skipped off macOS. Never read, synthesize, or modify `.sketch` ZIP/JSON archives through Python, Node/Bun, shell archive tools, or other offline scripts.

Follow the host's adopted model and collaboration policy. In Codex, the installed `policy/models.md` owns design and screenshot-review routing; this skill does not redefine that route or extend it to other products.

## 0. Scope and Required Reusable Library

### Bind the Project Contract and Operation

Resolve the target document, current candidate, authorized operation, and applicable project rules before work. Project and task contracts own Library selection, visual tokens, platforms, themes, viewports, business flows, canvas organization, delivery paths, performance budgets, and acceptance gates. Keep adopted requirements in force within their scope; do not apply one project's choices to another.

Read-only review checks the same requirements and reports gaps without modifying documents or host state. Do not install, register, enable, synchronize, repair, migrate, clean up, or save during that review. Resolve unknown write outcomes by reading the same target before retrying. Host configuration and external writes retain their existing authorization boundaries; this skill never writes MCP registration or Sketch preferences.

### Require Actual Library Consumption

Creating or modifying a deliverable Sketch UI design **must use an applicable reusable foundation Library**. “Reusable” means its foundational components, variables, and styles can serve real consumers. The Library may come from an official, team, or project-adopted design system; no single name, component namespace, physical file, or directory is universal. A project-specific foundation Library can satisfy this requirement without a second physical Library.

1. Resolve source, path or remote origin, registration, Library ID, compatible version, and target-document association from project rules, the task, and actual dependencies. Inspect `get_libraries` or `sketch.Library.getLibraries()` and document imports. A display name alone does not establish identity; distinguish missing, inaccessible, disabled, stale, and same-name/different-ID resources.
2. Verify real consumption: applicable shared components, color variables, and text or layer styles use native Library references. Trace imported assets and their instances or style assignments to the selected Library. Merely listing or installing it, importing unrelated assets, using an empty Library, or copying layers that lose their references does not satisfy the requirement.
3. Reuse suitable existing components before drawing the same foundation again in a business document. Discover the selected Library's actual names and structure rather than requiring predetermined prefixes or variant organization.
4. Without a project-specific Library, select a suitable existing reusable Library. If none is applicable and accessible, report the concrete missing dependency. Within effective authorization, connect a suitable resource or add only the minimum shared assets needed by the current real consumer. Do not silently fall back to local clones, create an empty compliance Library, or prebuild a complete design system. Missing authorization stops only dependent operations; continue unaffected preparation and report incomplete acceptance honestly.
5. Use a compatible official platform Library when the target needs system components. Resolve the platform and version from the target contract. Apple UI resources are not a dependency of non-iOS work merely because they are installed. Default Templates and Inspire UI Kit are candidate resources, not mandatory companions for every task.

When Library registration or enabling is authorized, use the supported native API, for example `sketch.Library.getLibraryForDocumentAtPath('/absolute/path/to/foundation.sketch')` and `lib.enabled = true`. The path is illustrative. Verify the resulting identity, enabled state, document association, and actual consumption; do not assume a fixed `Libraries/` mirror is required.

## 1. Native MCP Workflow

### Load the Built-In Guides

Load `get_guide({ topic: "mcp" })` before other MCP tools and `get_guide({ topic: "use" })` before reading, creating, laying out, styling, exporting, or wiring documents. Load relevant subtopics on demand: `layout`, `styling`, `symbols`, `assets`, `prototyping`, and `troubleshooting`. Use the installed application's guides to verify current API support, parameter semantics, and limitations before relying on them.

The native MCP tools are `get_guide`, `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, `run_code`, and `get_screenshot`.

### Resolve the Document and Inspect Before Editing

- Inspection, asset, override, and screenshot tools take an open document's `targetDocumentID`. Resolve it through `sketch.Document.getDocuments()` or open the exact file with `sketch.Document.open('/absolute/path/to/design.sketch', (err, doc) => { ... })` in `run_code`. Never substitute offline archive parsing when no document is open.
- Use `get_document_info({ targetDocumentID })` for Pages, counts, and frame bounds, then `get_layer_tree_summary({ targetDocumentID, layerID, depth })` for the relevant subtree (`depth`: `1..10`).
- Reserve `sketch.find(predicate, root)` for targeted type, UUID, or property queries. For multi-frame scans, recurse cached `node.layers` in JavaScript rather than repeatedly invoking `sketch.find('*', frame)` over large trees.
- Check `layer.isGraphicFrame` before `layer.isFrame`: Frames, Graphics, and plain Groups all report `type === 'Group'`, and Graphics report both flags as true.

### Discover Assets and Overrides

- Use `get_libraries({ targetDocumentID })` and `get_design_assets({ targetDocumentID, kind, nameContains, sourceLibraryID })`. Supported asset kinds include `symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, and `graphicTemplate`. Bind filters to discovered Library and asset identities.
- Import and assign native references, for example `const inst = ref.import().createNewInstance()` or `override.swatchValue = swatchRef.import()`. Confirm that the consumer retains the reference.
- Before overriding an instance, call `get_symbol_overrides({ targetDocumentID, symbolInstanceID, kind })` and obtain `commonOverrideIDPrefix`. Here `kind` is `'text' | 'color' | 'image' | 'all'`; do not pass `layerID` in place of `symbolInstanceID`.

### `run_code` Safety and Performance

- Start with `const sketch = require('sketch')` and use public JavaScript APIs only, without `sketchObject`, Objective-C selectors, or Node `fs`. Follow the MCP execution format: no comments, no one-line minification, no redeclaring a function in scope, and one final `console.log(JSON.stringify({ ok: true, ... }))` result rather than top-level `return` or `sketch.UI.message`.
- Keep each call bounded to one coherent action, re-resolve document and layer IDs, and verify the result. A failed call is not proof that all preceding mutations rolled back; inspect before retrying.
- Compare layer wrappers by `.id`, never object identity. Parent access can allocate fresh wrappers. Bound a parent walk, for example with `cur && cur.id !== rootFrame.id && cur.type === 'Group'`, so it cannot pass its intended root.
- Cache `.layers` and `.frame` before indexed or pairwise loops: `const arr = page.layers; const rects = arr.map(x => x.frame)`. Repeated `page.layers[i]` or `group.layers[i]` access re-bridges native arrays and can exhaust memory.
- Filter relevant instances by discovered master IDs or names before reading `.overrides`; batch by Page or a bounded instance set. Large composite trees can make unfiltered override expansion stall Sketch. Batch size follows observed cost, not a universal frame-count threshold.

## 2. Bundled `sketchtool` and File Boundaries

Use `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` for native inventory and exports. Check the installed subcommand's help before invoking repair or migration.

| Operation | Effect and authorization |
| --- | --- |
| `metadata <file>`; `list pages\|artboards\|layers <file>` | Read document structure without editing the source. |
| `duplicates <file>` | Inspect duplicate IDs with the default repair-disabled behavior. Require zero duplicates for a completed edited candidate; report findings in read-only review. |
| `duplicates <file> --fix` | Attempts to modify the document to repair duplicate IDs; not a read-only check and not all duplicate types are repairable. |
| `migrate <file> --output=<path>` | Opens and saves a migrated document and discards cached collaboration patches. Bind the exact source, output, recovery needs, and edit authorization first. |
| `export preview\|artboards\|layers\|pages <file> --output=<directory>` | Writes preview artifacts to the task's authorized output directory without treating them as source edits. |

For read-only audits, omit repair options: `--no-fix` may be rejected, while `-E NO`, `--fix=NO`, or other Boolean aliases may enable repair. Check stderr and the reported operation, not just exit zero. Compare file digests before and after when nonmutation evidence is required.

Deliver documents at project-defined paths. Bind temporary artifacts to actual task-owned locations and the existing [temporary-directory contract](../../policy/tool-contracts.md#task-temp). Do not recursively clean a presumed project directory or delete files or layers by broad name matching. Read-only review performs no cleanup. Preserve unrelated files, documents, and open unsaved work.

## 3. Components, Library Updates, and Native Layout

### One Master Home and Explicit Consumer Updates

Keep shared master components in their owning Library. Within a document that owns masters, use the top level of its Symbols page (`sketch.Page.getSymbolsPage(doc)`), with instances on showcase or business pages. Avoid duplicate masters and repeated clones; discover actual component and variant organization from the selected Library.

Use native imported symbols, swatches, and shared text/layer styles. Saving a Library source does not prove that its registered resource or any consumer has updated. Trace the actual source-to-registration-to-consumer relationship; some setups use a separate registered copy, others do not.

For an authorized shared change, identify affected consumers and validate a representative consumer before wider propagation. Update the registered resource only where the actual setup requires it and authorization covers it. In affected consumers, call `syncWithLibrary()` on the changed imported `SymbolMaster`, `Swatch`, or `SharedStyle`, and `resizeWithSmartLayout()` on affected instances as appropriate. Verify references, layout, screenshots, and saved results. Do not blanket-sync unrelated consumers. Batch order, parallelism, and Human acceptance follow the existing project delivery policy and effective authorization; this skill adds no file-count trigger or approval gate.

### Native Overrides and Reference Integrity

Drive supported variations with `commonOverrideIDPrefix + '_' + property`, without arbitrary `detach()`. Relevant properties include `stringValue`, `symbolID`, `isVisible`, `preservesSpaceWhenHidden`, `swatchValue`, `color:fill-N`, `color:border-N`, `textColor`, `fillColor`, `textStyle`, `layerStyle`, `horizontalSizing`, `verticalSizing`, `image`, `imageResizeBehavior`, and `flowDestination`. Preserve API semantics, such as image resize values `2` for Fit and `3` for Fill, as defined by the installed guide; these are not visual tokens.

After swapping a nested `<prefix>_symbolID`, clear stale overrides under that prefix that refer to the former master's child IDs, or duplicate a clean compatible template instance and reapply intended values. For example, `Control/Rest` to `Control/Focused` is an illustrative swap, not a required naming scheme. Preserve unrelated overrides and verify zero dangling `unresolvedOverrides` and no broken imported references.

### Editable Containers, Styles, and Reflow

- Build UI containers with `sketch.Group.Frame` and proportional icons or illustrations with `sketch.Group.Graphic`. Do not create legacy plain Groups or convert Frames to them. During authorized edits, use `convertToFrame()` or `convertToGraphic()` according to the layer's role; preserve existing Graphics. Use `background: { enabled: false }` for transparent wrappers.
- Apply container fills, borders, dividers, shadows, and corners through native styles, including `sharedStyle`, Swatch-linked `style.fills`, `style.borders`, and per-side `border.sides`. When a child shape merely duplicates container chrome, transfer its intended styling before removing that specific redundant layer by ID. Keep independent vector artwork, masks, and other shapes with a real design purpose. A name such as `background` or `divider` is a search clue, never sufficient evidence for deletion.
- Prefer the selected Library's focus treatment or native borders/shadows over redundant external focus rectangles. Measure the actual ring and ancestor clipping. Adjust clipping or available inset as appropriate, while preserving intentional scroll clipping; verify the whole focus indicator remains visible. No universal ring offset, padding, or variant name applies.
- Reuse Library icons where suitable. For missing icons within scope, use editable vector geometry such as `ShapePath.fromSVGPath` in a Graphic, with the Library's stroke, caps, joins, size, and alignment. Do not substitute an arbitrary single-character Text glyph for a UI icon. Intentional text or symbols remain text when that is their actual semantic role.
- Default flow-based UI regions to `stackLayout` (`Direction.Row` / `Direction.Column`, `gap`, `padding`, `wraps`, `bordersAffectLayout`) so content changes reflow siblings. Use fixed positioning for genuinely fixed or overlapping compositions, verifying the required variants. Highest `parent.layers` index renders first in a Stack; reorder through `layer.index = n` and `stackLayout.apply()`, not `parent.layers = [...]`.
- Use `FlexSizing.Fixed`, `Fit`, `Fill`, `Relative`, `minSize`, and `maxSize` according to the component's geometry. Lock genuinely fixed-size icons, avatars, and indicators on both axes; do not let `Fill` stretch them or force accidental wrapping. Fit single-line labels and allow multiline text to fill its intended available width without an arbitrary minimum-width rule. Run `resizeWithSmartLayout()` after relevant text overrides.
- After changing text or child geometry, recompute legacy non-Stack ancestor bounds from the inner container outward. Verify subsequent controls and the outer frame still fit. Text must show all intended lines; siblings must have no unintended overlap, and child overflow must match an explicit design purpose such as focus, overlays, or scrolling. Bounding-box collisions are diagnostic candidates, not proof that intentional overlap is wrong.
- For trees and other connectors, verify the intended parent/child relationship, endpoint alignment, spacing, continuity, and termination at the last visible descendant. Avoid crossings through controls or dividers. Derive geometry from actual rows and the component contract rather than prescribing a gap or an L-shaped ending.
- Resolve theme surfaces by semantic role, contrast, and design intent, including nested containers. A dark theme may intentionally use a light emphasis surface. Use `CornerStyle.Smooth`, `corners.concentric = true`, or `style.tint = { swatch }` only when the chosen design calls for them. Process pending changes with `doc.processPendingChanges()` after relevant Swatch, shared-style, or corner updates, then inspect the result.

## 4. Pages, States, and Canvas Organization

Organize files and Pages by responsibilities and coherent flows. Keep master ownership unique and avoid meaningless duplicates. A simple design may use one business Page; no minimum page count or universal Page/frame/layer ceiling applies. Read project hard limits where present. If opening, editing, rendering, or tool calls slow down, measure the actual problem and reduce redundant content, partition by responsibility, or batch inspection while preserving required coverage. Do not describe a project budget or local measurement as a Sketch technical limit.

Choose platforms, themes, viewports, breakpoints, frame names, ordering, and spacing from the current contract. Cover the required primary states and real layout reflows separately; avoid multiplying every state by every width and theme without a reason. Retain combinations that the business or accessibility contract actually requires.

One optional canvas arrangement is three bands: primary interactive journeys, exceptional/boundary states, and responsive reflows. Use it only when suitable or project-adopted. It dictates neither fixed dimensions nor numbering, and band membership alone does not decide whether a frame is interactive. Keep canvas and layer-list order understandable under the chosen organization.

Derive main paths, single-step branches, errors, boundaries, and meaningful combinations from the business contract. That contract owns pagination versus incremental loading, loading/retry/recovery behavior, status codes, field lengths, cancel/delete behavior, and multistep form combinations. Avoid exhaustive combinations with no distinct outcome, but do not omit a required combination to reduce frame count. Examples from another product are not acceptance requirements.

## 5. Prototype Behavior and Visible Content

### Verify the Intended Graph

Identify intended entry points, paths promised to be interactive, static reference frames, and legitimate terminal states. Set `flowStartPoint` accordingly, without a fixed number or naming prefix. Check every promised path for reachability from its intended entry, and report unintended dead ends and self-loops. A completion frame may have no outgoing flow; a static reference does not need invented interaction.

Resolve `layer.flow` targets and `flowDestination` overrides to actual valid frames or `sketch.Flow.BackTarget` (`'back'`). Use `layer.flow.isValidConnection()`, target IDs, and `isBackAction()` as applicable; graph traversal must reflect the intended scope and actual back behavior. Confirm the important transitions in the native prototype, since a valid target ID alone does not prove interaction behavior. Clear stale unintended flows during authorized edits, not all links in a category of frames.

Report accidental theme or device jumps; preserve explicit theme switching, device handoff, and appropriately sized overlays. Current-navigation clicks, cross-module entries, and return behavior follow the product contract and prototype scope. Do not hijack a real control to a placeholder destination or remove a required link merely to satisfy a generic graph check. If a required destination is unavailable, report that coverage gap.

### Preserve Context and Use Real Interaction Targets

Menus, dialogs, and transitions must preserve the applicable filters, form state, record context, and unchanged identity. Use capabilities verified in the installed prototyping guide and actual document. If the API lacks a needed overlay operation, choose an authorized supported implementation or report the limitation; do not turn a tool workaround into a product-wide menu restriction. Context-preserving paired frames, native overlays, and other supported approaches follow the actual requirement.

Keep the same record's fields and the unchanged logged-in identity consistent across connected views. Explicit account switching and legitimate business-state transitions may change them. After an action, use the destination and recovery path required by the business flow, including completion pages or continued work where appropriate.

Wire visible controls or other genuine interaction targets. A `sketch.HotSpot` may match a visible sub-control when a composite instance lacks a suitable nested flow override; a dismissible scrim may itself be a real target. Verify bounds, stacking, modal blocking, and resulting behavior. Never add hidden corner hotspots, off-control targets, or concealed error jumps to fabricate reachability.

### Review User Copy Separately from Metadata

Inspect rendered Text and instance string overrides as user content. Treat layer names, tracking IDs, and design annotations according to their audience; internal identifiers are not copy leaks unless rendered or otherwise exposed to the user. Do not apply one blacklist to all three categories.

User-facing screens must not accidentally expose irrelevant debugging controls, internal workflow notes, or predetermined results. Judge technical terms, examples, help text, and keyboard instructions by context: developer tools and help pages may legitimately display them. Verify the final pixels as well as the source text.

Refresh, retry, recovery, back navigation, draft saving, cancel, and submit actions follow the product contract. Keep actions real and results accurate; button labels must not reveal a presumed outcome before it is known. Avoid purposeless duplicate actions without imposing universal button counts, footer layouts, or wording.

## 6. Screenshot, Save, and Final Acceptance

After each visual or layout change, use `get_screenshot({ targetDocumentID, layerID })` on the affected result. Check hierarchy, alignment, spacing, complete text, focus visibility, intended theme roles, connectors, and bounds. Inspect affected instances after Library changes as well as the Library source. Keep screenshots tied to the exact candidate and layer IDs; old screenshots do not validate subsequent edits.

Export durable previews to the authorized location when required. For example, `sketch.export(layer, { output: '/absolute/output/directory', filename: 'preview.png', formats: ['png'], scales: ['2.0'], overwriting: true })` uses an absolute directory, not `output: false`. These path, filename, and scale values illustrate invocation, not delivery policy; permit overwrite only for the bound output.

For edited candidates, save with `doc.save()`, verify the saved path and zero duplicate IDs using `sketchtool duplicates <file>` without repair options, then reopen the saved candidate through native tools. Verify Library references, overrides, layout, required interactions, and screenshots of affected content after reopening. Close only task-owned documents when safe, preserving unrelated unsaved work. For read-only review, report the observed candidate and any limits without save, repair, or host changes.

Final review must cover:

- Required Library identity, actual native consumption, and affected consumer synchronization.
- Unique master ownership, editable Frame/Graphic structure, native styles, valid overrides, reflow, complete text, visible focus, and no unintended overlaps or broken references.
- Project-required themes, widths, states, organization, scale limits, and business combinations.
- Intended prototype entries, reachability, legitimate endings, real interaction targets, context continuity, and audience-appropriate copy.
- Candidate-bound screenshots, saved/reopened results for edits, and applicable project acceptance gates.

Report gaps and unverified behavior explicitly. Skill-format checks, document lint, and static scenarios do not establish real model behavior or native Sketch acceptance. Distinguish a validated target graph, actual prototype interaction, saved-file verification, and Human visual acceptance rather than claiming one proves the others.
