---
name: sketch-native
description: MUST load before any .sketch inspection, diagnosis, creation, editing, or review on macOS. Routes all .sketch work through Sketch 2026.3+ MCP tools and sketchtool CLI; strictly forbids offline Python/ZIP archive synthesis.
metadata:
  short-description: Native Sketch 2026.3+ MCP workflow with libraries, Stacks, symbols, and visual verification
---

# Sketch Native Workflow (`sketch-native`)

This shared macOS skill routes `.sketch` work through Sketch 2026.3+ and its built-in MCP server. The skill directory is delivered to Codex, DeepSeek Harness, and Antigravity CLI on macOS (skipped on other platforms) without registering MCP servers or modifying Sketch preferences.

Under Codex model routing, use `gpt-6.1-sol` at `medium` effort (`high` only for complex multi-state layout constraints) for page, component, and Stack composition, `gpt-6.1-sol` or `gpt-6-luna` at `low` effort for incremental `run_code` property or override refinements, and `gpt-6.1-terra` at `low` effort for pixel screenshot inspection.

## 0. Required Official and Project Library Preflight

Before `.sketch` design or review work, inspect Libraries via `get_libraries` or `run_code` (`sketch.Library.getLibraries()`) and verify that `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` installs and enables:

1. **Project Design-System Library** (such as `bencao.sketch`).
2. **`Apple iOS 27 UI Kit`**: Required for iOS and Mini Program status bars, Home Indicator safe areas, and system controls.
3. **Sketch Official `Default Templates` and `Inspire UI Kit`** (when present locally).

In read-only mode, report missing, unregistered, or disabled Libraries without modifying host configuration. When host Library changes are authorized, mount or enable libraries in `run_code` via `const lib = sketch.Library.getLibraryForDocumentAtPath('/abs/path/to/library.sketch'); lib.enabled = true;` and verify `lib.enabled === true`. Report any remaining disk or authorization gap before dependent work.

## 1. Sketch MCP 8 Tools and Standard Invocation Sequence

Sketch 2026.3+ ships built-in API guides and eight MCP tools (`get_guide`, `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, `run_code`, `get_screenshot`). Follow this sequence:

### Preload Built-In MCP Guides (`get_guide`)

1. Call `get_guide({ topic: "mcp" })` before the first Sketch MCP call.
2. Call `get_guide({ topic: "use" })` before reading, creating, laying out, styling, exporting, or wiring prototypes.
3. Load subtopics on demand: `layout` (`StackLayout`, `FlexSizing`, Pin), `styling` (`Swatch`, `SharedStyle`, per-side borders, concentric corners, blurs, `Tint`), `symbols` (`SymbolMaster`, `SymbolInstance`, nested/image overrides), `assets` (`sketch.export`, `sketch.createLayerFromData`), `prototyping` (`flow`, `flowStartPoint`, `HotSpot`), and `troubleshooting` (`run_code` diagnosis before retrying any failed call).

### Document Open, Resolve, and Save Lifecycle (`No current Sketch document`)

- `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, and `get_screenshot` require the `targetDocumentID` of an open document.
- When the target document is not open, do not call `get_document_info` directly and never fall back to Python or offline scripts to parse the `.sketch` ZIP archive. Call `run_code` with `sketch.Document.getDocuments()` or `sketch.Document.open('/abs/path/to/file.sketch', (err, doc) => { ... })` to resolve `doc.id`.
- After edits and visual acceptance, save natively with `doc.save()` (and `doc.close()` on non-active documents when releasing memory).

### Read-Only Inspection First

- Call `get_document_info({ targetDocumentID })` to retrieve the document ID, Page list, layer counts, and frame coordinates and dimensions.
- Call `get_layer_tree_summary({ targetDocumentID, layerID, depth: 1..10 })` to inspect subtree hierarchy, text summaries, Stack hints, and override counts.
- Use `sketch.find(predicate, root)` (`#uuid`, `Frame`, `SymbolMaster`, `SymbolInstance`, `Text`, `[name~*="keyword"]`, `[frame.x>=24]`, `:not-hidden`) only for targeted single-root or UUID lookups. When scanning across dozens or hundreds of Frames in `run_code`, walk `node.layers` with plain JavaScript recursion (`< 50ms`) instead of calling `sketch.find('*', frame)` (`60` to `90s` in the Cocoa predicate engine).
- Distinguish nested container traits by checking `layer.isGraphicFrame` first and `layer.isFrame` second. Nested Frames, nested Graphics, and legacy plain Groups all report `layer.type === 'Group'`, and Graphics report both flags as `true`.

### Library and Asset Discovery (`get_libraries` + `get_design_assets` + `get_symbol_overrides`)

- Call `get_libraries({ targetDocumentID })` to list enabled Libraries (such as `bencao` or `Apple iOS 27 UI Kit`).
- Call `get_design_assets({ targetDocumentID, kind, nameContains, sourceLibraryID })` to search `symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, and `graphicTemplate` assets.
- Complete cross-library import and assignment in one statement (`var inst = ref.import().createNewInstance()` or `override.swatchValue = swatchRef.import()`); splitting statements may drop the reference.
- Before modifying a component instance, call `get_symbol_overrides({ targetDocumentID, symbolInstanceID, kind })` (`kind`: `'text' | 'color' | 'image' | 'all'`, never passing `layerID`) to retrieve `commonOverrideIDPrefix`.

### `run_code` Execution Rules (Preventing Parser Errors and `3m0s` Timeouts)

- Start every `run_code` script with `const sketch = require('sketch')` and use only the public JavaScript API. Never call `sketchObject`, Objective-C selectors, or Node `fs`.
- Never write comments (`//` or `/* */`) inside `script`, never minify into one line, and never redeclare a `function` name in the same scope.
- Never iterate `instance.overrides` indiscriminately across an entire `200+`-Frame document: reading `.overrides` on thousands of composite `SymbolInstance` layers (such as `Shell/Header` or `Navigation/Item`) expands full Cocoa nested trees, spikes CPU above `95%`, and triggers `3m0s` MCP timeouts. Filter by `instance.master && instance.master.name` prefix first (such as `/Feedback/`, `/Data/`, or `/Button/`) or process one `Page` per `run_code` call.
- Perform one atomic action per `run_code` call, re-resolve `doc` and target IDs in each call, and return results via a single final `console.log(JSON.stringify({ ok: true, ... }))` line (never rely on `return` or `sketch.UI.message`).

### Pixel-Level Visual Acceptance and Asset Export (`get_screenshot` vs `sketch.export`)

- After every appearance or layout change, call `get_screenshot({ targetDocumentID, layerID })` to verify hierarchy, alignment, spacing, unclipped typography, and container bounds.
- For disk slices or preview exports, call `sketch.export(layer, { output: '/abs/dir', filename: 'name.png', formats: ['png'], scales: ['2.0'], overwriting: true })` in `run_code` (`output` must be an absolute directory; never pass `output: false`).

## 2. Bundled `sketchtool` CLI Toolchain (Prefer First for Large-File Triage and Batch Export)

Sketch 2026.3+ bundles `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool`. Prefer `sketchtool` first for multi-file inventory, oversized-archive triage, duplicate ID repair, native migration, and batch exports before opening large files in the GUI (avoiding Cocoa window and GPU texture overhead). Once open, use Sketch MCP for all layer edits, Library bindings, Stack layout, overrides, `get_screenshot` checks, and `doc.save()`:

- `sketchtool metadata <file>` and `sketchtool list pages|artboards|layers <file>`: inspect structure headlessly.
- `sketchtool duplicates <file>`: detect and repair duplicate object IDs before opening.
- `sketchtool migrate <file>`: migrate documents natively and strip redundant collaboration patches.
- `sketchtool export preview|artboards|layers|pages <file> --output=/abs/dir`: batch-export previews headlessly.

Never use Python, Node, or shell scripts to synthesize or mutate `.sketch` ZIP/JSON archives.

## 3. Native Component Architecture, Full Overrides, and Modern Layout and Styling

### Single Symbol Master Home and Cross-Library Binding

- Place every `SymbolMaster` at the top level of the dedicated `Symbols` page (`sketch.Page.getSymbolsPage(doc)`), never on a regular page or nested inside an `Artboard` or `Group`.
- Bind shared design-system components (`foreignSymbols`), color variables (`foreignSwatches`), and styles (`sharedTextStyles`, `sharedLayerStyles`) via Sketch Libraries rather than duplicating foundational components locally.

### Full Override-Driven States (Do Not Arbitrarily `detach()` Instances)

Drive component variations via `commonOverrideIDPrefix + '_' + property` instead of `detach()`: `stringValue` (copy), `symbolID` (nested state symbols), `isVisible` and `preservesSpaceWhenHidden` (optional slots), `swatchValue` / `color:fill-N` / `color:border-N` / `textColor` / `fillColor` (semantic colors), `textStyle` and `layerStyle`, `horizontalSizing` and `verticalSizing`, `image` and `imageResizeBehavior` (`2` Fit, `3` Fill), and `flowDestination` (same-track target Frame ID or `'back'`, `sketch.Flow.BackTarget`).

### Modern Containers, Stack Layout, and Native Styling

- Build every UI container (screens, sections, cards, lists, rows, form groups, toolbars, dialogs, and transparent wrappers with `background: { enabled: false }`) as `sketch.Group.Frame`, and every proportionally scaled icon or illustration container as `sketch.Group.Graphic`. Never call `new sketch.Group(...)` or `group.convertToGroup()` (overriding plain-Group examples in `get_guide`), and never place standalone `Rectangle` or `ShapePath` layers inside a container to simulate fills, borders, dividers, shadows, focus rings, or rounded corners.
- Audit legacy plain groups (`!layer.isFrame && !layer.isGraphicFrame`) and existing `Frame` containers (`layer.isFrame && !layer.isGraphicFrame`) so documents neither trigger the `could be upgraded to Frames` banner nor retain fake-upgraded Frames with leftover child chrome:
  - In read-only mode, report plain groups, leftover backdrop or divider shapes inside Frames, external focus-ring rectangles, ancestor Frames with `clipsContents === true` clipping `Focus` instances, single-character `Text` pseudo-icons, sibling AABB overlaps, child bounds overflow, clipped multi-line `Text`, light surfaces in `Dark` Frames, or broken tree-connector geometry without mutating the document.
  - When editing is authorized, preserve `Graphic` containers (`isGraphicFrame === true`), upgrade proportional icon roots via `group.convertToGraphic()`, and upgrade legacy UI groups via `group.convertToFrame()` (`group.background.enabled = false` on transparent wrappers).
  - Across upgraded and existing `Frame` containers, migrate any child backdrop shape (`surface`, `disclosure-surface`, `bg`, `backdrop`, `*底板`, `*底面`) and standalone divider (`separator`, `rule`, `divider`, `*分隔线`, `*分割线`, including `1px` rules stretched along a `StackLayout` cross axis) onto the parent Frame's `sharedStyle` and `Swatch`-linked `style.fills`, `style.borders`, per-side `border.sides = { top: 0, right: 0, bottom: 1, left: 0 }`, `shadows`, and `corners`, reconcile `clipsContents` with former masks, delete the redundant shapes, and verify via `get_screenshot`.
  - Never stack standalone rectangles (`*-focus`) outside or over an instance or container to simulate a focus ring; express focus exclusively via the `Focus` variant override (`*/Focus/*`) or native `borders` and `shadows`. Because `*/Focus/*` masters extend outer focus rings `-5px` beyond control bounds (`3px` offset + `2px` outline), set `clipsContents = false` on every parent and ancestor `Group.Frame` wrapping a `Focus` instance (unless it is an explicit scroll viewport with `>= 6px` inner padding) so focus rings are never sliced into corner arcs.
- Build UI icons (`chevron-down`, `chevron-right`, `chevron-left`, `check`, `close`, `search`, `alert`, `info`) by reusing Library icon `SymbolInstance` assets or `ShapePath.fromSVGPath` (`1.5px` stroke, round caps and joins, centered inside a fixed-size `Group.Graphic` or `Group.Frame`). Never use single-character `Text` layers (`⌄`, `›`, `‹`, `✓`, `✕`, `×`) or assembled rectangles as icons.
- Compose layouts with `stackLayout` (`Direction.Row` / `Direction.Column`, `gap`, `padding`, `wraps`, `bordersAffectLayout`). In `parent.layers`, the highest index renders leftmost or topmost; reorder children via `layer.index = n` then `stackLayout.apply()`, never assigning `parent.layers = [...]`. Pair `stackLayout` with `FlexSizing` (`Fixed`, `Fit`, `Fill`, `Relative`, `minSize`, `maxSize`) and call `instance.resizeWithSmartLayout()` (or `Fit` horizontal sizing) after longer `_stringValue` overrides so pills, tags, and buttons never clip labels.
- Maintain zero unintended axis-aligned bounding-box (AABB) overlap among visible sibling layers (`layer.isVisible === true`) inside non-overlay containers. When rendering hierarchical tree connectors (vertical `branch`, horizontal `branch-joint`, and `expand`/`collapse` disclosure buttons), enforce four geometry invariants:
  1. **Aligned Indentation and Zero Button Intrusion**: Align parent disclosure button center `X` with child vertical `branch` `X`, and end horizontal `branch-joint` `>= 4px` before the child disclosure button's left edge without piercing the button surface.
  2. **Continuous Ancestor Trunk Lines**: Render an ancestor's outer vertical trunk line continuously across `y: 0..rowHeight` of every expanded descendant row whenever that ancestor has following visible siblings.
  3. **`L`-Shaped Termination on Final Visible Child**: Stop the last visible child's current-level vertical `branch` at `height = rowCenterY` where `branch-joint` meets, never leaving a dangling tail to `rowHeight`.
  4. **Unbroken Connector Gutter Across Row Dividers**: Inset or omit row dividers across the left connector gutter so horizontal borders never slice between the parent button and child `branch`.
- Keep every visible child layer inside every nested `Frame` strictly within parent bounds without overflow (allowing only intentional `-5px` `Focus` rings under `clipsContents = false`), and size every multi-line `Text` container height to fit the full wrapped line count for its font size, line height, and column width without bottom clipping.
- In `Dark` theme Frames, bind both the top-level Frame background and every nested card, panel, drawer, and row fill to `Dark` semantic surface `Swatch` variables; never leave light or white inner surfaces.
- Apply `CornerStyle.Smooth` or `corners.concentric = true` for nested rounded corners, and `style.tint = { swatch }` for unified tinting. Call `doc.processPendingChanges()` after modifying color variables, shared styles, or concentric corners.

## 4. Orthogonal Organization, Spatial Zoning, and Responsive Breakpoints

Keep `.sketch` deliverables organized by cohesive module (`design/current/<domain>/<module>.sketch`) under strict scale, zoning, and anti-bloat guardrails:

- **Consolidated Design-System Library**: Keep the master library (`bencao.sketch`) consolidated into showcase/specification pages (`SymbolInstance` layers only) plus `Symbols`; do not maintain triplicate `Core/Light/Dark` cloned `SymbolMaster` sets.
- **Sub-Flow Page Partitioning and Document Scale**: Partition each module by core sub-flow into `2` to `8` business Pages plus `1` `Symbols` Page; never split pages by `viewport width × theme`. Target `<= 250` top-level Frames and `<= 50,000` layers for new or deduplicated standard modules (`<= 250` Frames per Page), with a whole-document ceiling of `<= 12` Pages, `<= 1,200` Frames, and `<= 200,000` layers (honoring the consuming project's explicit thresholds during read-only audits when free of Cartesian-product duplication).
- **Primary Viewports vs. On-Demand Secondary Breakpoints**: Cover Light and Dark branches on primary viewports (desktop `1440`, mobile `390`). Select secondary breakpoints on demand from `{1200, 834, 768, 320}` only where structural reflow occurs (sidebar collapse, table-to-card switch, toolbar wrap); omit unchanged breakpoints and never clone micro-states across `state × width × theme`.
- **Three-Band Canvas Zoning, Anti-Bloat Pruning, and Sidebar Order**:
  - Arrange top-level Frames along `X` (`120` to `160px` gutters) across three vertical `Y` bands (`360` to `480px` band gaps):
    1. **Band 1 (Top — Control-Reachable Interactive Graph)**: Primary-viewport Light/Dark rows (`1440 · Light`/`Dark`, plus `390 · Light`/`Dark` when mobile flows exist) covering both core step progression and every normal branch reachable via genuine visible UI controls (top-bar account/avatar menu expand and collapse, list status filter pills, pagination switches, row drill-downs across business statuses into detail views, and unsaved-form `Cancel` confirmation dialogs), named with step prefixes (`01 · Invitation List · 1440 · Light`).
    2. **Band 2 (Middle — Server and Boundary Contract States)**: Primary-viewport Light/Dark pairs aligned under their parent Band 1 step (`02a · ...`), strictly restricted to states unreachable via normal frontend clicks alone: initial loading skeletons, API read failures, empty states, `401`/`403` auth or eligibility blocks, field validation errors, `409` concurrency conflicts, `429` rate-limit cooldowns, unknown-outcome recovery, and `64`-character overflow contract states.
    3. **Band 3 (Bottom — Secondary Responsive Reflows)**: Real-data layout-reflow Frames named with a breakpoint prefix (`R1 · Invitation List · 768 · Light`).
  - Enforce three anti-bloat pruning bans: (1) never clone a whole Frame solely to show keyboard focus returning to a button after closing a dialog; (2) never duplicate conflicting same-view primary list Frames in sub-flow Pages or invent cross-slice placeholder Frames (`衔接目标`, `关联切片`, `片外入口`); and (3) never clone loading-skeleton states (`正在读取`, `初始读取中`, `加载中`) into Band 3 secondary breakpoints.
  - Synchronize Page layer-list order (`frame.index`, highest index at top of Layer List) with the `Band 1 -> Band 2 -> Band 3` reading order.

## 5. Prototype Entry Convergence, Same-Track Wiring, and Production UI Purity

Keep prototypes focused on complete, authentic user navigation while reviewing server and reflow contract states statically:

- **Converged Start Points and 100% Band 1 Reachability**: Set `frame.flowStartPoint = true` exclusively on the step `01` entry Frame of each Band 1 primary `viewport × theme` track (`2` per desktop Page, or up to `4` with mobile tracks), and `false` on all other Frames. Every Band 1 Frame must be `100%` BFS-reachable from its track's `flowStartPoint` and have `outgoingFlows > 0` (zero dead-end Band 1 screens).
- **Same-Track Navigation, Zero Orphan Flows, and Zero Semantic Self-Loops**:
  - Restrict full-screen `layer.flow` and `flowDestination` links to top-level Frames with the same `frame.width` and `Light`/`Dark` theme, or `sketch.Flow.BackTarget` (`'back'`); permit Sketch Overlays (modals, drawers, popovers) to retain intrinsic dimensions when bound to the same primary viewport track and theme. Never wire cross-viewport (`390` to `1440`) or cross-theme jumps.
  - Keep Band 3 reflow Frames and Band 2 contract Frames free of outgoing links (`layer.flow = undefined` and every `SymbolInstance` `flowDestination` override set to `""`) so Sketch creates zero implicit prototype roots.
  - Eliminate direct self-loops (`targetId === currentFrame.id`) and same-view semantic self-loops on active navigation: whenever a Frame shows the primary list or directory view of an item (including expanded, filtered, paginated, empty, cancel-return, and post-submit list states), clear `layer.flow = undefined` and `_flowDestination = ""` on the active item (`Current`, `Active`, `Selected`). Allow clicking the module's sidebar item to return to the primary list entry only from drill-down detail or standalone create/edit views. Keep authorized sibling-module navigation items visible in shared `Shell` chrome with cleared `flow`/`_flowDestination` rather than hijacking them to fake local placeholder Frames.
  - Probe each Page's prototype graph in `run_code`: verify `layer.flow` via `layer.flow.isValidConnection()` plus same-track target resolution (`layer.flow.target`, `targetId`, or `isBackAction()`), verify string `flowDestination` overrides against an existing same-track top-level Frame or `'back'`, and verify `100%` BFS reachability across Band 1.
- **Production UI Purity, Copy Hygiene, and Single-Source Controls**:
  - Across `layer.name`, `Text` content, and `SymbolInstance` `_stringValue` overrides, never expose: (a) prototype helper controls, branch switchers, or banners (`Prototype Demo: ...`, `*示例`, `原型核对`, `原型分支核对栏`, `原型快捷入口`, `原型分支入口`, `原型过渡说明`, `演示分支`, `模拟读取失败`, `查看…异常/故障/拦截态`, `返回原型页面`) or hijacked business button labels (`返回修改`, `关闭`); (b) engineering spec IDs or internal slugs (`（D3）`, `PATH-xx`, `save-refresh-failed`, `DemoOnly_...`); (c) interaction or accessibility spec self-narration (`初始焦点位于…`, `默认聚焦…`, `按 Escape 关闭`, `确认弹窗不显示明文…`, `零截断`, `示例名称完整展示`, `测试专用`); (d) API write or state-machine internals (`仅提交已修改的字段`, `不重复写入旧值`, `刚刚重读`, `读回`, `终态`, `单事务`, `共有底座`, `权限子集铁律`); or (e) raw integer/type boundaries and backend storage jargon (`2147483647`, `int32`/`int64`, `原码` for `raw code`, `受权`, or doubled replacement tokens).
  - Never place hidden, off-control, or corner-anchored synthetic `sketch.HotSpot` layers (such as `__cross_page_flow__` at `(0, 0, 48×48)`) or hidden error-jump overlays; bind transitions to genuine visible UI controls (`Navigation/Item`, header back controls, filter/pagination controls, row actions, or primary CTAs), allowing an exact-bounds `sketch.HotSpot` (`1:1` aligned over a visible sub-control) only when a composite `Shell` `SymbolMaster` (such as a header account trigger) exposes no independent nested `flowDestination` slot.
  - Never place standalone manual refresh buttons (`刷新`, `刷新列表`, `刷新资料`, `刷新记录`, `刷新最新状态`, `Refresh`, `refresh`) on normally loaded Band 1 list, detail, overview, or directory-tree views (including normal business-status views such as `暂不可用` records, which must not be misclassified as `服务暂不可用` API failures) unless polling/sync is an explicit product requirement. On Band 2 unknown-outcome recovery (`提交结果未明`) Frames, place at most one neutral recovery button (`刷新当前状态` or `刷新列表`), never multiple outcome-spoiling refresh buttons (`刷新见已生效`, `刷新见仍为原顺序`, `刷新读取失败`, `刷新列表（已删除）`, `刷新列表（仍存在）`).
  - Retain at most `1` page-level `返回` or breadcrumb-back entry per Frame, placed exclusively in the top bar or page header; never duplicate `返回` buttons across the page header, body card header, and bottom action bar (form footers retain only `Cancel` and primary submit, with a single primary CTA per action bar).
- **Read-Only Audit Parity**: In read-only mode, report excess `flowStartPoint` flags, unreachable or dead-end Band 1 Frames, Band 1/2/3 misclassifications or skeleton/focus/handoff Frame bloat, cross-track or broken `flow` links, active-navigation self-loops, synthetic bypass `HotSpot` layers, prototype or engineering/spec/jargon copy leaks across `layer.name`/`Text`/`_stringValue`, unauthorized Band 1 `Refresh` or multi-button spoiler recovery actions, or duplicate `返回` controls without mutating the document.
