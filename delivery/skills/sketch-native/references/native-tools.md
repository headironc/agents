# Native Tools and File Boundaries

Use this reference for native MCP inspection, bounded document operations, and bundled `sketchtool` commands. Before saving or reopening, closing conflicting copies, importing Library assets, changing shared styles, auditing overrides, or cleaning native resources, also read [identity and mutation handling](identity-and-mutations.md). Reading a procedure does not authorize a write; read-only review preserves documents and host state.

## Native MCP Workflow

### Load the Built-In Guides

Load `get_guide({ topic: "mcp" })` before other MCP tools and `get_guide({ topic: "use" })` before reading, creating, laying out, styling, exporting, or wiring documents. Load relevant subtopics on demand: `layout`, `organization`, `styling`, `symbols`, `assets`, `prototyping`, and `troubleshooting`. Use the installed application's guides to verify current API support, parameter semantics, and limitations before relying on them.

The native MCP tools in Sketch 2026.4 fall into three boundary groups:

- Read, guide, inspection, and canvas-check tools: `get_guide`, `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, `get_screenshot`, and (for signed-in Workspace documents) `list_comments` and `list_notifications`.
- Script execution: `run_code`.
- External Workspace collaboration writes: `save_comment` (starts, replies to, edits, resolves, or reopens annotations, visible to collaborators and triggering notifications) and `delete_comment` (permanently deletes a reply or an entire annotation thread including other people's replies, with no Undo). Require explicit authorization before calling `save_comment` or `delete_comment`; never call these two write tools during read-only review or ordinary design edits.

If the `sketch` MCP server is absent in the current session, do not fall back to offline `.sketch` archive access or write client MCP configs yourself; direct the user to enable Sketch 2026.4+'s built-in MCP Server (`http://localhost:31126/mcp`, non-App-Store build) and merge [sketch.mcp.json](../../../capability/sketch.mcp.json) or uncomment `[mcp_servers.sketch]` in `capability/codex.toml`.

### Resolve the Document and Inspect Before Editing

- On first contact with a Sketch session, probe and cache `sketch.version` via `run_code`.
- Bind the full source path and document ID using `sketch.Document.getDocuments()`, or open the exact file with `sketch.Document.open('/absolute/path/to/design.sketch', (err, doc) => { ... })` in `run_code`. Resolve explicit prompt layer references (`layer:<ID>` links, embedded `selection=true` layer resources, or `https://sketch.com/s/<doc>/f/<frame>` share links) against the bound document. Inspection, asset, override, comment, and screenshot tools take `targetDocumentID`, but two open copies can share that ID. Resolve the path ambiguity before using those tools; a missing layer may mean the tool selected the other copy. Never substitute offline archive parsing when no document is open.
- Before closing a conflicting copy, establish ownership, authorization, and preservation of unsaved work. Missing dirty state does not prove a clean document; follow the [copy and closure procedure](identity-and-mutations.md#document-identity-and-safe-closure).
- Use `get_document_info({ targetDocumentID })` for Pages, counts, page-coordinate top-level Frames/Graphics (with `section` and `sectionID` when held by a Section or VariantSet), and page `sections` (including `parentSectionID`). Then use `get_layer_tree_summary({ targetDocumentID, layerID, depth })` for the relevant subtree (`depth`: `1..10`). That summary uses compact type names (`Component`, `VariantSet`, `Variant`, `Instance` with variant configuration and override count, `Section`, `Hotspot`) and does not expand `Graphic` subtrees, so a `Graphic` shown without children is not necessarily empty.
- Reserve `sketch.find(predicate, root)` for targeted type, UUID, or property queries. For multi-frame scans, recurse cached `node.layers` in JavaScript rather than repeatedly invoking `sketch.find('*', frame)` over large trees.
- Canvas-level Frames and Graphics report `type === 'Artboard'`, whereas nested Frames, nested Graphics, plain Groups, Sections, and VariantSets all report `type === 'Group'`. Because a `VariantSet` also reports `isSection === true` and a `Graphic` also reports `isFrame === true`, check traits in this order: `layer.isVariantSet`, then `layer.isSection`, then `layer.isGraphicFrame`, then `layer.isFrame`.

### Discover Assets and Overrides

- Use `get_libraries({ targetDocumentID })` and `get_design_assets({ targetDocumentID, kind, nameContains, sourceLibraryID })`. Supported asset kinds include `symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, and `graphicTemplate`; `kind: 'symbol'` lists each `VariantSet` once with its variant count and properties. Bind filters to discovered Library and asset identities, and strip any comments from suggested usage snippets before submitting them to `run_code`.
- Import from the verified Library, cache the returned object, and use its actual identity and consumer assignment. Source IDs can change during import; follow [Library import identity](identity-and-mutations.md#library-import-identity).
- Before overriding an instance, call `get_symbol_overrides({ targetDocumentID, symbolInstanceID, kind })` and obtain `commonOverrideIDPrefix`. Here `kind` is `'text' | 'color' | 'image' | 'all'`; do not pass `layerID` in place of `symbolInstanceID`. When changing multiple overrides on one `SymbolInstance`, batch them in `instance.updateOverrides((overrides) => { ... })` and mutate the callback's `overrides` parameter rather than assigning `override.value` repeatedly in a loop. Use `instance.overridesForExpandedLayer(nestedLayer)` to map `expandedLayers` nodes without colliding on duplicate inner IDs.

### `run_code` Safety and Performance

- Start with `const sketch = require('sketch')` and use public JavaScript APIs only, without `sketchObject`, Objective-C selectors, or Node `fs`. Follow the MCP execution format: no comments, no one-line minification, no redeclaring a function in scope, and one final `console.log(JSON.stringify({ ok: true, ... }))` result rather than top-level `return` or `sketch.UI.message`.
- Keep each call bounded to one coherent action, re-resolve document and layer IDs, and verify the result. A failed call is not proof that all preceding mutations rolled back; inspect before retrying.
- Compare layer wrappers by `.id`, never object identity. Parent access can allocate fresh wrappers. Bound a parent walk, for example with `cur && cur.id !== rootFrame.id && cur.type === 'Group'`, so it cannot pass its intended root.
- Cache `.layers` and `.frame` before indexed or pairwise loops: `const arr = page.layers; const rects = arr.map(x => x.frame)`. Repeated `page.layers[i]` or `group.layers[i]` access re-bridges native arrays and can exhaust memory.
- Filter relevant instances by discovered master IDs or names before reading `.overrides`; batch by Page or a bounded instance set. Large composite trees can make unfiltered override expansion stall Sketch. Batch size follows observed cost, not a universal frame-count threshold.

## Bundled `sketchtool` and File Boundaries

Use `/Applications/Sketch.app/Contents/MacOS/sketchtool` (the legacy `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` path remains a compatibility wrapper) for native metadata, duplicate checks, and exports. `sketchtool list` was removed in Sketch 2026.4 and exits with `Unknown command 'list'`; inspect pages, sections, frames, and layer trees via MCP `get_document_info` and `get_layer_tree_summary` instead. Check the installed subcommand's help before invoking repair or migration.

| Operation | Effect and authorization |
| --- | --- |
| `metadata <file>` | Read document metadata without editing the source. |
| `duplicates <file>` | Inspect duplicate IDs with the default repair-disabled behavior. Require zero duplicates for a completed edited candidate; report findings in read-only review. |
| `duplicates <file> --fix` | Attempts to modify the document to repair duplicate IDs; not a read-only check and not all duplicate types are repairable. |
| `migrate <file> --output=<path>` | Opens and saves a migrated 2026.4 document (incompatible with pre-2026.4 Sketch) and discards cached collaboration patches. Bind the exact source, output, recovery needs, version compatibility, and edit authorization first. |
| `detach <file>`; `patch <file>` | Detaches symbols or applies document patches; requires explicit edit authorization and must not run in read-only review. |
| `export preview\|frames\|layers\|pages\|slices <file> --output=<directory>` | Writes preview artifacts to the task's authorized output directory without treating them as source edits (`export artboards` and `--include-symbols` remain compatibility aliases for `export frames` and `--include-components`). |

For read-only audits, omit repair options: `--no-fix` may be rejected, while `-E NO`, `--fix=NO`, or other Boolean aliases may enable repair. Check stderr and the reported operation, not just exit zero. Compare file digests before and after when nonmutation evidence is required.

Deliver documents at project-defined paths. Bind temporary artifacts to actual task-owned locations and the existing [temporary-directory contract](../../../policy/tool-contracts.md#task-temp). Do not recursively clean a presumed project directory or delete files or layers by broad name matching. Read-only review performs no cleanup. Preserve unrelated files, documents, and open unsaved work.
