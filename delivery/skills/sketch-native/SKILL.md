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

1. **Project Design-System Library** (such as `bencao.sketch`): During read-only inspection or review, report if the library is unregistered or disabled without modifying host configuration. When the task authorizes registering or enabling host Sketch Libraries, call `const lib = sketch.Library.getLibraryForDocumentAtPath('/abs/path/to/bencao.sketch'); lib.enabled = true;` in `run_code` and verify `lib.enabled === true`.
2. **`Apple iOS 27 UI Kit`**: Required for iOS and Mini Program status bars, Home Indicator safe areas, and native system controls (when host Library changes are authorized and the library is registered but disabled, set `lib.enabled = true` and verify `lib.enabled === true`).
3. **Sketch Official `Default Templates` and `Inspire UI Kit`**: If present under `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` but not registered or enabled, report the status during read-only inspection; when host Library changes are authorized, mount and enable them through `const lib = sketch.Library.getLibraryForDocumentAtPath(...); lib.enabled = true;` and verify `lib.enabled === true`.

If any required Library is missing from the host machine, or remains unregistered or disabled when host configuration changes are not authorized, report the environment gap immediately before proceeding with dependent work.

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
- Distinguish nested container traits by checking `layer.isGraphicFrame` first and `layer.isFrame` second. Nested Frames, nested Graphics, and legacy plain Groups all report `layer.type === 'Group'`, and Graphics report both flags as `true`.

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
- `flowDestination`: bind target Frame IDs for prototype navigation or `'back'` (`sketch.Flow.BackTarget`) directly on component instances within the same viewport and theme track (see Section 5).

### Modern Containers, Stack Layout, and Native Styling

- Build every UI visual or layout container (screens, sections, cards, lists, rows, form groups, toolbars, dialogs, and transparent wrappers with `background: { enabled: false }`) as `sketch.Group.Frame`, and build every proportionally scaled icon or illustration container as `sketch.Group.Graphic`. Never call `new sketch.Group(...)` or `group.convertToGroup()` (overriding permissive plain-Group examples in `get_guide`). Never place standalone `Rectangle` or `ShapePath` layers inside a container to simulate background fills, borders, shadows, or rounded corners.
- Audit `sketch.find('Group', doc)` for legacy plain groups (`!layer.isFrame && !layer.isGraphicFrame`) so edited documents trigger no `could be upgraded to Frames` banner:
  - During read-only inspection or review, report legacy plain groups without mutating the document.
  - During authorized editing or repair, leave existing `Graphic` containers (`isGraphicFrame === true`) intact, and convert legacy proportional icon or vector roots in place with `group.convertToGraphic()`.
  - Convert legacy UI or layout groups in place with `group.convertToFrame()`. Set `group.background.enabled = false` on transparent wrappers, or migrate a full-bounds backdrop rectangle's `sharedStyle` and `Swatch`-linked `fills`, `borders`, `shadows`, and `corners` onto the Frame before removing the backdrop layer. Reconcile `clipsContents` with any former mask layer, and verify child geometry via `get_screenshot`.
- Compose layouts with `stackLayout` (`Direction.Row` / `Direction.Column`, `gap`, `padding`, `wraps`, `bordersAffectLayout`). In `parent.layers`, the highest index renders at the leftmost or topmost position; reorder children by setting `layer.index = n` followed by `stackLayout.apply()`, and never assign `parent.layers = [...]` directly. Pair `stackLayout` with `FlexSizing` (`Fixed`, `Fit`, `Fill`, `Relative`, `minSize`, `maxSize`) and `instance.resizeWithSmartLayout()`.
- Render dividers using per-side container borders `border.sides = { top: 0, right: 0, bottom: 1, left: 0 }`; never draw standalone `1px`-high rectangle layers.
- Apply `CornerStyle.Smooth` or `corners.concentric = true` for nested rounded corners, and use `style.tint = { swatch }` for unified icon or container tinting. Call `doc.processPendingChanges()` after modifying color variables, shared styles, or concentric corners.

## 4. Orthogonal Organization, Spatial Zoning, and Responsive Breakpoints

Keep `.sketch` deliverables organized by cohesive functional module (`design/current/<domain>/<module>.sketch`) and enforce strict document-scale and canvas-layout guardrails:

- **Consolidated Design-System Library**: Keep the design-system master library (such as `bencao.sketch`) consolidated into showcase and specification pages (containing only `SymbolInstance` layers) plus the `Symbols` master page. Do not maintain triplicate `Core/Light/Dark` cloned `SymbolMaster` sets.
- **Sub-Flow Page Partitioning and Document Scale**: Partition the document for each business module by core sub-flow into `2` to `8` business Pages plus `1` `Symbols` Page, and never split pages by `viewport width × theme` into dozens or hundreds of Pages. Target `<= 250` top-level Frames and `<= 50,000` total layers for new or deduplicated standard modules (keeping each individual Page within `<= 250` top-level Frames), while enforcing a hard whole-document ceiling of `<= 12` Pages, `<= 1,200` top-level Frames, and `<= 200,000` total layers (honoring the consuming project's explicit thresholds during read-only audits so large multi-flow modules with full contract coverage are not falsely flagged when free of Cartesian-product duplication).
- **Primary Viewports vs. On-Demand Secondary Breakpoints**:
  - Cover complete business state branches in both Light and Dark themes at the primary viewports (desktop `1440`, mobile `390`).
  - Select secondary responsive breakpoints on demand from `{1200, 834, 768, 320}` only where structural layout reflow occurs (such as sidebar collapse, table-to-card conversion, or toolbar wrapping). Omit secondary breakpoints when no structural reflow occurs, and never clone micro-states (such as inline field errors or modal dialogs) across the full `state × width × theme` Cartesian product.
- **Three-Band Canvas Zoning, Sidebar Order, and Hierarchical Frame Naming**:
  - Arrange top-level Frames on each business Page with step progression along the horizontal `X` axis (`120` to `160px` column and row gutters) and three vertical `Y` bands separated by `360` to `480px` inter-band gaps:
    1. **Band 1 (Top — Happy Path on Primary Viewports)**: Place core step-by-step user flows first (`1440 · Light` on row 1, aligned `1440 · Dark` on row 2, followed by `390 · Light` and `390 · Dark` rows when an interactive mobile flow exists). Prefix main-flow Frame names with primary step numbers (such as `01 · Column List · 1440 · Light`, `02 · Create Column · 1440 · Light`).
    2. **Band 2 (Middle — Edge and Contract States on Primary Viewports)**: Place non-happy-path states (empty states, permission denials, validation or concurrency conflicts, API failure and unknown-outcome recovery, and `64`-character overflow checks) in Light and Dark pairs aligned under the corresponding Band 1 step or grouped by state category. Anchor Frame names to the parent step (such as `02a · Create Column - Duplicate Name · 1440 · Light`) instead of continuing flat top-level numbering.
    3. **Band 3 (Bottom — Secondary Responsive Reflows)**: Place static reflow Frames at the bottom with a breakpoint prefix (such as `R1 · Column List · 768 · Light`).
  - Synchronize the layer-list order of each Page (via `frame.index`, where the highest index sits at the top of the left sidebar Layer List and index `0` sits at the bottom) with the `Band 1 -> Band 2 -> Band 3` reading order so sidebar navigation matches the canvas layout.

## 5. Prototype Entry Convergence, Same-Track Wiring, and Production UI Purity

Keep interactive prototypes focused on genuine user navigation while reviewing backend and responsive contract states statically on the canvas:

- **Converged Prototype Start Points (`flowStartPoint`)**:
  - Set `frame.flowStartPoint = true` exclusively on the step `01` entry Frame of each primary `viewport × theme` track in Band 1 (`2` start points per desktop-only Page for `1440 Light` and `1440 Dark`, or up to `4` when `390 Light` and `390 Dark` primary mobile flows exist).
  - Explicitly set `frame.flowStartPoint = false` on all subsequent Happy Path steps, all Band 2 edge and contract Frames, and all Band 3 secondary breakpoint Frames so the Sketch Prototypes panel lists only true sub-flow entry points.
- **Same-Track Navigation and Zero Orphan Flows**:
  - Restrict full-screen `layer.flow` and `flowDestination` navigation to top-level Frames with the same `frame.width` and `Light` or `Dark` theme, or to `sketch.Flow.BackTarget` (`'back'`); permit Sketch Overlay targets (such as confirmation modals, drawers, or popovers) to use intrinsic Overlay dimensions when bound to the same primary viewport track and theme. Never wire cross-viewport jumps (such as `390` to `1440`) or cross-theme jumps.
  - Keep Band 3 responsive reflow Frames and non-interactive Band 2 contract Frames free of outgoing prototype links: set `layer.flow = undefined` and clear every `SymbolInstance` override where `property === 'flowDestination'` to `""` so Sketch never promotes isolated Frames into implicit prototype roots.
  - Probe the prototype graph of each Page in `run_code`: verify `layer.flow` with `layer.flow.isValidConnection()` together with same-track target resolution via `layer.flow.target` or `layer.flow.targetId` (or `layer.flow.isBackAction()`), and verify `SymbolInstance` `flowDestination` overrides (whose `value` is a string ID or `'back'` rather than a `Flow` instance) by resolving `override.value` against an existing same-track top-level Frame or `'back'`.
- **Production UI Purity and Single-Source Navigation Controls**:
  - Keep every Frame faithful to production UI. Never render prototype-only debug triggers (such as `"Prototype Demo: ..."` buttons or bars for switching states) or stack hidden `sketch.HotSpot` overlays onto business screens to reach backend error states. Wire genuine user-triggered dialogs (such as confirmation modals for deactivation) on the same track, and review backend, empty, and boundary contract states statically in Band 2.
  - Place at most one page-level back or breadcrumb control in the top header region; never duplicate back links in both the header and footer (form footers retain only `Cancel` and the primary submit action).
  - Omit standalone manual `Refresh` buttons on ordinary CRUD lists and detail screens unless asynchronous polling or manual synchronization is an explicit product requirement. Maintain a single primary CTA per action bar with secondary or destructive actions visually subordinated.
- **Read-Only Audit Parity**: During read-only inspection or review, report excess `flowStartPoint` flags, cross-track or broken `flow` links, unzoned canvases, or prototype-only debug controls without mutating the document.
