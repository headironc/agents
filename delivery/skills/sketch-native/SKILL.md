---
name: sketch-native
description: MUST load before any .sketch inspection, diagnosis, creation, editing, or review on macOS. Routes all .sketch work through Sketch 2026.3+ MCP tools and sketchtool CLI; strictly forbids offline Python/ZIP archive synthesis.
metadata:
  short-description: Native Sketch 2026.3+ MCP workflow with libraries, Stacks, symbols, and visual verification
---

# Sketch Native Workflow (`sketch-native`)

This shared macOS skill routes `.sketch` design work through Sketch 2026.3+ and its built-in MCP server. The same skill directory is delivered to Codex, DeepSeek Harness, and Antigravity CLI on macOS; other platforms skip installation. Installing this skill does not register MCP servers or modify Sketch preferences.

When the task runs under Codex model routing, use `gpt-6.1-sol` at `medium` effort (`high` only for complex multi-state layout constraints) for initial page, component, and Stack hierarchy composition, `gpt-6.1-sol` or `gpt-6-luna` at `low` effort for incremental `run_code` property or override refinements, and `gpt-6.1-terra` at `low` effort for pixel-based screenshot inspection.

## 0. Required Official and Project Library Preflight

Before starting any `.sketch` design or review work, inspect installed and enabled Libraries through `get_libraries` or `run_code` (`sketch.Library.getLibraries()`) and verify that local Sketch (`~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/`) has the following Libraries installed and enabled:

1. **Project Design-System Library** (such as `bencao.sketch`): If the library is not registered or is disabled, call `const lib = sketch.Library.getLibraryForDocumentAtPath('/abs/path/to/bencao.sketch'); lib.enabled = true;` in `run_code` and verify `lib.enabled === true`.
2. **`Apple iOS 27 UI Kit`**: Required for iOS and Mini Program status bars, Home Indicator safe areas, and native system controls (if registered but disabled, set `lib.enabled = true` and verify `lib.enabled === true`).
3. **Sketch Official `Default Templates` and `Inspire UI Kit`**: If present under `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` but not registered or enabled, mount and enable them through `const lib = sketch.Library.getLibraryForDocumentAtPath(...); lib.enabled = true;` and verify `lib.enabled === true`.

If any required Library is missing from the host machine, report the environment gap immediately before proceeding with dependent design work.

## 1. Sketch MCP 8 Tools and Standard Invocation Sequence

Sketch 2026.3+ ships authoritative operational and API documentation inside the application bundle and exposes eight MCP tools (`get_guide`, `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, `run_code`, and `get_screenshot`). Follow the invocation sequence below rather than copying API handbooks into the repository.

### Preload Built-In MCP Guides (`get_guide`)

1. Before calling any Sketch MCP tool for the first time, call `get_guide({ topic: "mcp" })`.
2. Before reading, creating, laying out, styling, exporting, or modifying prototypes in a document, call `get_guide({ topic: "use" })`.
3. Load specialized guides on demand through `get_guide`:
   - `layout`: `StackLayout`, `FlexSizing`, and Pin constraints.
   - `styling`: `Swatch` Color Variables, `SharedStyle`, per-side borders, concentric corners, blurs, and `Tint`.
   - `symbols`: `SymbolMaster`, `SymbolInstance`, and nested or image overrides.
   - `assets`: `sketch.export` and SVG import (`sketch.createLayerFromData`).
   - `prototyping`: `flow`, `flowStartPoint`, and `HotSpot`.
   - `troubleshooting`: `run_code` error diagnosis before retrying any failed script or bridge call.

### Document Open, Resolve, and Save Lifecycle (`No current Sketch document`)

- `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, and `get_screenshot` all require the `targetDocumentID` of an open Sketch document.
- When Sketch does not currently have the target document open, do not call `get_document_info` directly and never fall back to Python or other offline scripts to parse the `.sketch` ZIP archive. First call `run_code` to inspect open documents with `sketch.Document.getDocuments()` or open the target file with `sketch.Document.open('/abs/path/to/file.sketch', (err, doc) => { ... })` and output `doc.id`.
- After completing edits and visual acceptance, save the document natively with `doc.save()` (and call `doc.close()` on non-active working documents when needed to release memory).

### Read-Only Inspection First

- Call `get_document_info({ targetDocumentID })` to retrieve the document ID, Page list, layer counts, and frame coordinates and dimensions.
- Call `get_layer_tree_summary({ targetDocumentID, layerID, depth: 1..10 })` to inspect subtree hierarchy, text summaries, Stack hints, and override counts instead of writing custom recursive traversal scripts.
- When conditional lookup is needed inside `run_code`, use the built-in predicate engine `sketch.find(predicate, root)` (supporting combined queries such as `#uuid`, `Frame`, `SymbolMaster`, `SymbolInstance`, `Text`, `[name~*="keyword"]`, `[frame.x>=24]`, and `:not-hidden`).

### Library and Asset Discovery (`get_libraries` + `get_design_assets` + `get_symbol_overrides`)

- Call `get_libraries({ targetDocumentID })` to list enabled Libraries (such as a design-system library like `bencao` or a platform library like `Apple iOS 27 UI Kit`).
- Call `get_design_assets({ targetDocumentID, kind, nameContains, sourceLibraryID })` to search for `symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, and `graphicTemplate` assets.
- Complete cross-library import and assignment within the same statement (such as `var inst = ref.import().createNewInstance()` or `override.swatchValue = swatchRef.import()`); splitting import and assignment across statements can drop the reference.
- Before modifying a component instance, call `get_symbol_overrides({ targetDocumentID, layerID })` to retrieve `commonOverrideIDPrefix`.

### `run_code` Execution Rules (Preventing `llm-script.js` Parser Error)

- Start every `run_code` script with `const sketch = require('sketch')` and use only the public JavaScript API. Never call `sketchObject`, Objective-C selectors, or Node `fs`.
- Never write comments (`//` or `/* */`) inside the submitted `script`, never minify code into a single line, and never redeclare a `function` with the same name in the same scope.
- Perform one atomic action per `run_code` call, re-resolve `doc` and target layer IDs in each call, and return results exclusively through a single final `console.log(JSON.stringify({ ok: true, ... }))` line (do not rely on `return` or `sketch.UI.message`).

### Pixel-Level Visual Acceptance and Asset Export (`get_screenshot` vs `sketch.export`)

- After every appearance or layout change, call `get_screenshot({ targetDocumentID, layerID })` to inspect the rendered pixels for hierarchy, alignment, spacing rhythm, unclipped typography, and enclosed container boundaries.
- When exporting disk slices or temporary preview images, call `sketch.export(layer, { output: '/abs/dir', filename: 'name.png', formats: ['png'], scales: ['2.0'], overwriting: true })` inside `run_code`. The `output` option must be an absolute directory path; never pass `output: false` in `run_code` to return a binary buffer.

## 2. Bundled `sketchtool` CLI Toolchain (Prefer First for Large-File Triage and Batch Export)

Sketch 2026.3+ bundles the native headless command-line binary at `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool`. Prefer `sketchtool` first for bulk multi-file inventory, pre-open triage of oversized or abnormal archives, duplicate object ID repair, native migration, and batch exports before opening large documents in the Sketch GUI (avoiding Cocoa window and GPU texture overhead). Once a document is open for interactive authoring, use Sketch's built-in MCP server for all layer creation, library binding, Stack layout, Symbol overrides, frame-level `get_screenshot` verification, and `doc.save()`:

- `sketchtool metadata <file>` and `sketchtool list pages|artboards|layers <file>`: inspect page and artboard structure headlessly without opening the document in the GUI.
- `sketchtool duplicates <file>`: detect and repair duplicate object IDs before opening.
- `sketchtool migrate <file>`: migrate and save documents with the native Sketch engine and clean up redundant collaboration patches.
- `sketchtool export preview|artboards|layers|pages <file> --output=/abs/dir`: run headless batch preview exports.

Never use offline Python, Node, or shell scripts to hand-craft, synthesize, or mutate `.sketch` ZIP/JSON archives.

## 3. Native Component Architecture, Full Overrides, and Modern Layout and Styling

### Single Symbol Master Home and Cross-Library Binding

- Place every `SymbolMaster` exclusively at the top level of the dedicated `Symbols` page (`sketch.Page.getSymbolsPage(doc)`). Never leave a `SymbolMaster` on a regular page or nest it inside an `Artboard` or `Group`.
- Reference shared design-system components (`foreignSymbols`), color variables (`foreignSwatches`), and shared styles (`sharedTextStyles` and `sharedLayerStyles`) through Sketch Libraries in business module documents instead of duplicating foundational components locally.

### Full Override-Driven States (Do Not Arbitrarily `detach()` Instances)

Drive component instance variations through `commonOverrideIDPrefix + '_' + property` rather than calling `detach()`:

- `stringValue`: override text copy.
- `symbolID`: swap nested state child symbols.
- `isVisible` and `preservesSpaceWhenHidden`: control visibility and layout reservation for optional buttons, error messages, or badges.
- `swatchValue`, `color:fill-N`, `color:border-N`, `textColor`, and `fillColor`: apply semantic color overrides.
- `textStyle` and `layerStyle`: switch shared typography and layer styles.
- `horizontalSizing` and `verticalSizing`: adjust instance flex sizing behavior.
- `image` and `imageResizeBehavior`: override image fills with `2` (Fit) or `3` (Fill).
- `flowDestination`: bind prototype navigation target Frame IDs or `'back'` (`sketch.Flow.BackTarget`) directly on component instances, and verify prototype links with `flow.isValidConnection()` and `flowStartPoint = true` on entry frames.

### Modern Containers, Stack Layout, and Native Styling

- Use `sketch.Group.Frame` (passing `background: { enabled: false }` for transparent layout containers) and `sketch.Group.Graphic` (proportionally scaled icon or illustration containers; check `isGraphicFrame` before `isFrame`).
- Compose layouts with `stackLayout` (`Direction.Row` / `Direction.Column`, `gap`, `padding`, `wraps`, `bordersAffectLayout`). In `parent.layers`, the highest index renders at the leftmost or topmost position; reorder children by setting `layer.index = n` followed by `stackLayout.apply()`, and never assign `parent.layers = [...]` directly. Pair `stackLayout` with `FlexSizing` (`Fixed`, `Fit`, `Fill`, `Relative`, `minSize`, `maxSize`) and `instance.resizeWithSmartLayout()`.
- Render dividers using per-side container borders `border.sides = { top: 0, right: 0, bottom: 1, left: 0 }`; never draw standalone `1px`-high rectangle layers.
- Apply `CornerStyle.Smooth` or `corners.concentric = true` for nested rounded corners, and use `style.tint = { swatch }` for unified icon or container tinting. Call `doc.processPendingChanges()` after modifying color variables, shared styles, or concentric corners.

## 4. Orthogonal Organization of Pages, Business States, and Responsive Breakpoints

Keep `.sketch` deliverables organized by cohesive functional module (`design/current/<domain>/<module>.sketch`) and enforce strict document-scale guardrails:

- **Consolidated Design-System Library**: Keep the design-system master library (such as `bencao.sketch`) consolidated into showcase and specification pages (containing only `SymbolInstance` layers) plus the `Symbols` master page. Do not maintain triplicate `Core/Light/Dark` cloned `SymbolMaster` sets.
- **Sub-Flow Page Partitioning**: Partition each business module document by core business sub-flow into `2` to `8` business Pages plus `1` `Symbols` Page. Never split pages by `viewport width × theme` into dozens or hundreds of Pages.
- **Full States on Primary Viewports, Layout Reflow Only on Secondary Breakpoints**:
  - Cover complete business state branches in both Light and Dark themes at the primary viewports (desktop `1440`, mobile `390`).
  - At secondary responsive breakpoints (`834`, `768`, `320`, and grid-switching boundaries), retain only representative primary-state frames where layout reflow actually occurs. Never clone micro-states (such as inline field errors or modal dialogs) across the full `state × width × theme` Cartesian product.
  - Keep each business module document within `<= 12` Pages, `<= 250` top-level Frames, and `<= 50,000` total layers.
