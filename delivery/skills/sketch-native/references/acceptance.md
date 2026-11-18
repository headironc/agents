# Screenshots and final acceptance

Apply this reference after visual changes and before final review or delivery. Keep the main skill's read-only boundary: review checks existing evidence and reports gaps without saving, repairing, or closing windows.

After each visual or layout change, call `get_screenshot({ targetDocumentID, layerID })` with explicit `targetDocumentID` and `layerID` (omitting `layerID` captures the current selection) after resolving any same-ID open-document ambiguity by full path. Inspect both output forms: smaller captures return inline PNGs, while large PNGs return text containing an absolute temporary file path (open that file rather than treating text output as a failure). Captures exceeding 100 megapixels (roughly 10,000 × 10,000 px, commonly hit by wide Pages) fail deterministically; do not retry the refused target unchanged or skip visual verification, and instead capture smaller enclosing `Section`s or individual `Frame`s and report which regions were verified. Check hierarchy, alignment, spacing, complete text, focus visibility, intended theme roles, connectors, and bounds. Inspect affected instances after Library changes as well as the Library source. Keep screenshots tied to the exact candidate path, document identity, and layer IDs; old screenshots do not validate subsequent edits.

Export durable previews to the authorized location when required. For example, `sketch.export(layer, { output: '/absolute/output/directory', filename: 'preview.png', formats: ['png'], scales: ['2.0'], overwriting: true })` uses an absolute directory, not `output: false`. These path, filename, and scale values illustrate invocation, not delivery policy. In Sketch 2026.4, `overwriting: false` checks target existence as UTF-8 text and does not protect existing binary raster files (`.png`, `.jpg`, `.webp`, etc.) from overwriting; verify the destination path before exporting, permit overwrite only for the bound output, and never export from `instance.expandedLayers`.

For existing edited candidates, use the no-path `doc.save()` for an in-place save and follow [saving with identity preservation](identity-and-mutations.md#saving-with-identity-preservation). Path-taking saves and recovery copies can change identity. Verify the document ID, path, Library ID, and real source before and after saving and reopening.

Verify zero duplicate IDs using `sketchtool duplicates <file>` without repair options (and use `sketchtool export frames` when exporting top-level frames from CLI), then reopen the exact saved candidate through native tools. Verify Library references, public overrides, layout, required interactions, and screenshots of affected content after reopening. Close only task-owned documents when safe, preserving unrelated unsaved work. For read-only review, report the observed candidate and any limits without save, repair, or host changes.

Final review must cover:

- Required Library identity, actual native consumption, and affected consumer synchronization.
- Unique master ownership, editable Frame/Graphic structure, native styles, valid overrides, reflow, complete text, visible focus, and no unintended overlaps or broken references.
- Project-required themes, widths, states, organization, scale limits, and business combinations.
- Intended prototype entries, reachability, legitimate endings, real interaction targets, context continuity, and audience-appropriate copy.
- Candidate-bound screenshots, saved/reopened results for edits, and applicable project acceptance gates.

Report gaps and unverified behavior explicitly. Skill-format checks, document lint, and static scenarios do not establish real model behavior or native Sketch acceptance. Distinguish a validated target graph, actual prototype interaction, saved-file verification, and Human visual acceptance rather than claiming one proves the others.
