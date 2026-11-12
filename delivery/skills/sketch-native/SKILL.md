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

Before starting any `.sketch` design or review work, inspect Libraries via `get_libraries` or `run_code` (`sketch.Library.getLibraries()`) and verify that `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` has these Libraries installed and enabled:

1. **Project Design-System Library** (such as `bencao.sketch`).
2. **`Apple iOS 27 UI Kit`**: Required for iOS and Mini Program status bars, Home Indicator safe areas, and native system controls.
3. **Sketch Official `Default Templates` and `Inspire UI Kit`** (when present in the local `Libraries/` directory).

During read-only inspection or review, report any missing, unregistered, or disabled Library without modifying host configuration. When host Library changes are authorized, mount or enable registered libraries in `run_code` via `const lib = sketch.Library.getLibraryForDocumentAtPath('/abs/path/to/library.sketch'); lib.enabled = true;` and verify `lib.enabled === true`. If a required Library is missing from disk or remains disabled without host authorization, report the environment gap before dependent work.

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

- Build every UI visual or layout container (screens, sections, cards, lists, rows, form groups, toolbars, dialogs, and transparent wrappers with `background: { enabled: false }`) as `sketch.Group.Frame`, and every proportionally scaled icon or illustration container as `sketch.Group.Graphic`. Never call `new sketch.Group(...)` or `group.convertToGroup()` (overriding plain-Group examples in `get_guide`), and never place standalone `Rectangle` or `ShapePath` layers inside a container to simulate fills, borders, dividers, shadows, focus rings, or rounded corners.
- Audit `sketch.find('Group', doc)` across both legacy plain groups (`!layer.isFrame && !layer.isGraphicFrame`) and all existing `Frame` containers (`layer.isFrame && !layer.isGraphicFrame`) so documents neither trigger the `could be upgraded to Frames` banner nor retain fake-upgraded Frames with leftover child chrome:
  - During read-only inspection or review, report legacy plain groups, leftover backdrop or `1px` divider shapes inside existing Frames, external focus-ring rectangles, single-character `Text` pseudo-icons, sibling AABB overlaps, or broken tree-connector geometry without mutating the document.
  - During authorized editing or repair, keep `Graphic` containers (`isGraphicFrame === true`) intact, upgrade proportional icon or vector roots via `group.convertToGraphic()`, and upgrade legacy UI groups via `group.convertToFrame()` (`group.background.enabled = false` on transparent wrappers).
  - Across all upgraded and existing `Frame` containers, inspect child `Rectangle` and `ShapePath` layers: migrate any backdrop shape (`surface`, `disclosure-surface`, `bg`, `backdrop`) and any standalone `1px`-wide or `1px`-high divider (`separator`, `rule`, `divider`) onto the parent Frame's `sharedStyle` and `Swatch`-linked `style.fills`, `style.borders`, per-side `border.sides = { top: 0, right: 0, bottom: 1, left: 0 }`, `shadows`, and `corners`, reconcile `clipsContents` with any former mask layer, delete the redundant child shapes, and verify geometry via `get_screenshot`.
  - Never stack standalone rectangles (such as `*-focus`) outside or over a component instance or container to simulate a focus ring; express focus exclusively through the component's `Focus` variant override or the target Frame's native `borders` and `shadows`.
- Build UI icons (`chevron-down`, `chevron-right`, `chevron-left`, `check`, `close`, `search`, `alert`, `info`) by reusing Library icon `SymbolInstance` assets or placing `ShapePath` vector paths (`ShapePath.fromSVGPath` with `1.5px` stroke, round caps, and round joins, centered inside a fixed-size `Group.Graphic` or `Group.Frame`). Never use single-character `Text` layers (`⌄`, `›`, `‹`, `✓`, `✕`, `×`) or assembled rectangles as icons.
- Compose layouts with `stackLayout` (`Direction.Row` / `Direction.Column`, `gap`, `padding`, `wraps`, `bordersAffectLayout`). In `parent.layers`, the highest index renders leftmost or topmost; reorder children via `layer.index = n` followed by `stackLayout.apply()`, never assigning `parent.layers = [...]`. Pair `stackLayout` with `FlexSizing` (`Fixed`, `Fit`, `Fill`, `Relative`, `minSize`, `maxSize`) and `instance.resizeWithSmartLayout()`.
- Maintain zero unintended axis-aligned bounding-box (AABB) overlap among visible sibling layers (`layer.isVisible === true`) inside every non-overlay container (such as page headers vs. top-right buttons, or row labels vs. trailing disclosure icons). When rendering hierarchical tree connectors (vertical `branch` lines, horizontal `branch-joint` segments, and `expand`/`collapse` disclosure buttons), enforce four geometry invariants:
  1. **Aligned Indentation and Zero Button Intrusion**: Align the horizontal center `X` of the parent disclosure button with the `X` coordinate of the child vertical `branch`, and stop the right end of every horizontal `branch-joint` outside the child disclosure button's left edge with `>= 4px` clearance; never let connector lines pierce a disclosure button Frame or surface.
  2. **Continuous Ancestor Trunk Lines**: When an ancestor node has following visible siblings below the expanded subtree, render that ancestor's outer vertical trunk line continuously across the full height (`y: 0..rowHeight`) of every expanded descendant row without gaps.
  3. **`L`-Shaped Termination on Final Visible Child**: Stop the current-level vertical `branch` of the last visible child under each parent at the vertical midpoint where `branch-joint` meets (`height = rowCenterY`), never extending to `rowHeight` as a dangling tail.
  4. **Unbroken Connector Gutter Across Row Dividers**: Inset or omit row dividers across the left connector gutter between an expanded parent row and child rows so horizontal borders never slice through the channel between the parent disclosure button and child vertical `branch`.
- Apply `CornerStyle.Smooth` or `corners.concentric = true` for nested rounded corners, and `style.tint = { swatch }` for unified tinting. Call `doc.processPendingChanges()` after modifying color variables, shared styles, or concentric corners.

## 4. Orthogonal Organization, Spatial Zoning, and Responsive Breakpoints

Keep `.sketch` deliverables organized by cohesive module (`design/current/<domain>/<module>.sketch`) under strict scale and layout guardrails:

- **Consolidated Design-System Library**: Keep the master library (such as `bencao.sketch`) consolidated into showcase/specification pages (`SymbolInstance` layers only) plus the `Symbols` page; do not maintain triplicate `Core/Light/Dark` cloned `SymbolMaster` sets.
- **Sub-Flow Page Partitioning and Document Scale**: Partition each module document by core sub-flow into `2` to `8` business Pages plus `1` `Symbols` Page; never split pages by `viewport width × theme`. Target `<= 250` top-level Frames and `<= 50,000` layers for new or deduplicated standard modules (`<= 250` Frames per Page), with a whole-document ceiling of `<= 12` Pages, `<= 1,200` Frames, and `<= 200,000` layers (honoring the consuming project's explicit thresholds during read-only audits when free of Cartesian-product duplication).
- **Primary Viewports vs. On-Demand Secondary Breakpoints**: Cover complete Light and Dark state branches on primary viewports (desktop `1440`, mobile `390`). Select secondary breakpoints on demand from `{1200, 834, 768, 320}` only where structural reflow occurs (sidebar collapse, table-to-card switch, toolbar wrap); omit unchanged breakpoints and never clone micro-states across `state × width × theme`.
- **Three-Band Canvas Zoning, Sidebar Order, and Hierarchical Naming**:
  - Arrange top-level Frames with step progression along `X` (`120` to `160px` gutters) and three vertical `Y` bands separated by `360` to `480px` gaps:
    1. **Band 1 (Top — Happy Path)**: Core primary-viewport flows (`1440 · Light` row 1, `1440 · Dark` row 2, plus `390 · Light`/`Dark` rows when mobile flows exist), named with primary step numbers (`01 · Column List · 1440 · Light`, `02 · Create Column · 1440 · Light`).
    2. **Band 2 (Middle — Edge and Contract States)**: Primary-viewport Light/Dark pairs for empty, permission, validation/conflict, API failure/recovery, and `64`-character overflow states aligned under the parent Band 1 step and anchored to that step prefix (`02a · Create Column - Duplicate Name · 1440 · Light`).
    3. **Band 3 (Bottom — Secondary Responsive Reflows)**: Static reflow Frames named with a breakpoint prefix (`R1 · Column List · 768 · Light`).
  - Synchronize Page layer-list order (`frame.index`, where the highest index sits at the top of the left sidebar Layer List and `0` sits at the bottom) with the `Band 1 -> Band 2 -> Band 3` reading order.

## 5. Prototype Entry Convergence, Same-Track Wiring, and Production UI Purity

Keep prototypes focused on authentic user navigation while reviewing backend and reflow contract states statically on the canvas:

- **Converged Prototype Start Points (`flowStartPoint`)**: Set `frame.flowStartPoint = true` exclusively on the step `01` entry Frame of each Band 1 primary `viewport × theme` track (`2` start points per desktop Page, or up to `4` with mobile tracks). Set `frame.flowStartPoint = false` on all subsequent steps and all Band 2 and Band 3 Frames.
- **Same-Track Navigation, Zero Orphan Flows, and Zero Semantic Self-Loops**:
  - Restrict full-screen `layer.flow` and `flowDestination` links to top-level Frames with the same `frame.width` and `Light`/`Dark` theme, or `sketch.Flow.BackTarget` (`'back'`); permit Sketch Overlays (modals, drawers, popovers) to retain intrinsic dimensions when bound to the same primary viewport track and theme. Never wire cross-viewport (`390` to `1440`) or cross-theme jumps.
  - Keep Band 3 reflow Frames and non-interactive Band 2 contract Frames free of outgoing links by setting `layer.flow = undefined` and clearing every `SymbolInstance` `flowDestination` override to `""` so Sketch creates zero implicit prototype roots.
  - Eliminate direct self-loops (`targetId === currentFrame.id`) and same-view semantic self-loops on active navigation: whenever a Frame already shows the primary list or directory view of a navigation item (including expanded, filtered, empty, cancel-return, and post-submit list states), set `layer.flow = undefined` and clear `_flowDestination` overrides to `""` on the active/selected item (`Current`, `Active`, or `Selected`). Allow clicking the module's sidebar navigation item to return to the primary list entry Frame only from drill-down detail views or standalone create/edit form views.
  - Probe each Page's prototype graph in `run_code`: verify `layer.flow` via `layer.flow.isValidConnection()` plus same-track target resolution (`layer.flow.target`, `targetId`, or `isBackAction()`), and verify string-valued `flowDestination` overrides by resolving `override.value` against an existing same-track top-level Frame or `'back'`.
- **Production UI Purity, Authentic Cross-Page Triggers, and Single-Source Controls**:
  - Never render prototype-only debug chrome (`"Prototype Demo: ..."` buttons or state bars) or stack hidden `sketch.HotSpot` overlays onto screens to reach backend error states; wire genuine user-triggered dialogs on the same track and review backend/boundary states statically in Band 2.
  - Never place hidden, off-control, or corner-anchored synthetic `sketch.HotSpot` layers (such as `__cross_page_flow__` at `(0, 0, 48×48)`) to satisfy cross-page link checks; bind all intra-page and cross-page transitions to genuine visible UI controls (sidebar `Navigation/Item` instances, header back controls, row actions, or primary CTA buttons).
  - Place at most one page-level back or breadcrumb control in the top header (form footers retain only `Cancel` and primary submit), omit arbitrary manual `Refresh` buttons on routine CRUD views unless polling/sync is required, and maintain a single primary CTA per action bar.
- **Read-Only Audit Parity**: During read-only inspection or review, report excess `flowStartPoint` flags, cross-track or broken `flow` links, active-navigation semantic self-loops, synthetic bypass `HotSpot` layers, unzoned canvases, or debug chrome without mutating the document.
