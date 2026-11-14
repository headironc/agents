# Native Tools and File Boundaries

Use this reference for native MCP inspection, bounded document operations, and bundled `sketchtool` commands. Before saving or reopening, closing conflicting copies, importing Library assets, changing shared styles, auditing overrides, or cleaning native resources, also read [identity and mutation handling](identity-and-mutations.md). Reading a procedure does not authorize a write; read-only review preserves documents and host state.

## Native MCP Workflow

### Load the Built-In Guides

Load `get_guide({ topic: "mcp" })` before other MCP tools and `get_guide({ topic: "use" })` before reading, creating, laying out, styling, exporting, or wiring documents. Load relevant subtopics on demand: `layout`, `styling`, `symbols`, `assets`, `prototyping`, and `troubleshooting`. Use the installed application's guides to verify current API support, parameter semantics, and limitations before relying on them.

The native MCP tools are `get_guide`, `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, `run_code`, and `get_screenshot`.

### Resolve the Document and Inspect Before Editing

- Bind the full source path and document ID using `sketch.Document.getDocuments()`, or open the exact file with `sketch.Document.open('/absolute/path/to/design.sketch', (err, doc) => { ... })` in `run_code`. Inspection, asset, override, and screenshot tools take `targetDocumentID`, but two open copies can share that ID. Resolve the path ambiguity before using those tools; a missing layer may mean the tool selected the other copy. Never substitute offline archive parsing when no document is open.
- Before closing a conflicting copy, establish ownership, authorization, and preservation of unsaved work. Missing dirty state does not prove a clean document; follow the [copy and closure procedure](identity-and-mutations.md#document-identity-and-safe-closure).
- Use `get_document_info({ targetDocumentID })` for Pages, counts, and frame bounds, then `get_layer_tree_summary({ targetDocumentID, layerID, depth })` for the relevant subtree (`depth`: `1..10`).
- Reserve `sketch.find(predicate, root)` for targeted type, UUID, or property queries. For multi-frame scans, recurse cached `node.layers` in JavaScript rather than repeatedly invoking `sketch.find('*', frame)` over large trees.
- Check `layer.isGraphicFrame` before `layer.isFrame`: Frames, Graphics, and plain Groups all report `type === 'Group'`, and Graphics report both flags as true.

### Discover Assets and Overrides

- Use `get_libraries({ targetDocumentID })` and `get_design_assets({ targetDocumentID, kind, nameContains, sourceLibraryID })`. Supported asset kinds include `symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, and `graphicTemplate`. Bind filters to discovered Library and asset identities.
- Import from the verified Library, cache the returned object, and use its actual identity and consumer assignment. Source IDs can change during import; follow [Library import identity](identity-and-mutations.md#library-import-identity).
- Before overriding an instance, call `get_symbol_overrides({ targetDocumentID, symbolInstanceID, kind })` and obtain `commonOverrideIDPrefix`. Here `kind` is `'text' | 'color' | 'image' | 'all'`; do not pass `layerID` in place of `symbolInstanceID`.

### `run_code` Safety and Performance

- Start with `const sketch = require('sketch')` and use public JavaScript APIs only, without `sketchObject`, Objective-C selectors, or Node `fs`. Follow the MCP execution format: no comments, no one-line minification, no redeclaring a function in scope, and one final `console.log(JSON.stringify({ ok: true, ... }))` result rather than top-level `return` or `sketch.UI.message`.
- Keep each call bounded to one coherent action, re-resolve document and layer IDs, and verify the result. A failed call is not proof that all preceding mutations rolled back; inspect before retrying.
- Compare layer wrappers by `.id`, never object identity. Parent access can allocate fresh wrappers. Bound a parent walk, for example with `cur && cur.id !== rootFrame.id && cur.type === 'Group'`, so it cannot pass its intended root.
- Cache `.layers` and `.frame` before indexed or pairwise loops: `const arr = page.layers; const rects = arr.map(x => x.frame)`. Repeated `page.layers[i]` or `group.layers[i]` access re-bridges native arrays and can exhaust memory.
- Filter relevant instances by discovered master IDs or names before reading `.overrides`; batch by Page or a bounded instance set. Large composite trees can make unfiltered override expansion stall Sketch. Batch size follows observed cost, not a universal frame-count threshold.

## Bundled `sketchtool` and File Boundaries

Use `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` for native inventory and exports. Check the installed subcommand's help before invoking repair or migration.

| Operation | Effect and authorization |
| --- | --- |
| `metadata <file>`; `list pages\|artboards\|layers <file>` | Read document structure without editing the source. |
| `duplicates <file>` | Inspect duplicate IDs with the default repair-disabled behavior. Require zero duplicates for a completed edited candidate; report findings in read-only review. |
| `duplicates <file> --fix` | Attempts to modify the document to repair duplicate IDs; not a read-only check and not all duplicate types are repairable. |
| `migrate <file> --output=<path>` | Opens and saves a migrated document and discards cached collaboration patches. Bind the exact source, output, recovery needs, and edit authorization first. |
| `export preview\|artboards\|layers\|pages <file> --output=<directory>` | Writes preview artifacts to the task's authorized output directory without treating them as source edits. |

For read-only audits, omit repair options: `--no-fix` may be rejected, while `-E NO`, `--fix=NO`, or other Boolean aliases may enable repair. Check stderr and the reported operation, not just exit zero. Compare file digests before and after when nonmutation evidence is required.

Deliver documents at project-defined paths. Bind temporary artifacts to actual task-owned locations and the existing [temporary-directory contract](../../../policy/tool-contracts.md#task-temp). Do not recursively clean a presumed project directory or delete files or layers by broad name matching. Read-only review performs no cleanup. Preserve unrelated files, documents, and open unsaved work.
