---
name: sketch-native
description: MUST load before any .sketch inspection, diagnosis, creation, editing, or review on macOS. Routes all .sketch work through Sketch 2026.3+ MCP tools and sketchtool CLI; strictly forbids offline Python/ZIP archive synthesis.
metadata:
  short-description: Native Sketch 2026.3+ MCP workflow with libraries, Stacks, symbols, and visual verification
---

# Sketch Native Workflow (`sketch-native`)

Shared macOS skill routing `.sketch` work through Sketch 2026.3+ MCP and `sketchtool` across Codex, DeepSeek Harness, and Antigravity CLI (skipped off macOS; never writes MCP registration or Sketch preferences).

In Codex routing, use `gpt-6.1-sol` at `medium` (`high` only for complex multi-state layout constraints) for page/component/Stack composition, `gpt-6.1-sol` or `gpt-6-luna` (`low`) for incremental `run_code` refinements, and `gpt-6.1-terra` (`low`) for screenshot inspection.

## 0. Required Official and Project Library Preflight

Before `.sketch` design or review work, check `get_libraries` or `sketch.Library.getLibraries()` and verify `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` installs and enables:

1. **Project Design-System Library** (such as `bencao.sketch`).
2. **`Apple iOS 27 UI Kit`** (iOS and Mini Program status bars, Home Indicator safe areas, system controls).
3. **Sketch Official `Default Templates` and `Inspire UI Kit`** (when present locally).

In read-only mode, report missing, unregistered, or disabled Libraries without modifying host state. When host Library updates are authorized, enable via `const lib = sketch.Library.getLibraryForDocumentAtPath('/abs/path/to/library.sketch'); lib.enabled = true;` and verify `lib.enabled === true`. Report any remaining disk or authorization gap before dependent work.

## 1. Sketch MCP 8 Tools and Standard Invocation Sequence

Sketch 2026.3+ ships built-in guides and eight MCP tools (`get_guide`, `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, `run_code`, `get_screenshot`):

### Preload Built-In MCP Guides (`get_guide`)

1. Call `get_guide({ topic: "mcp" })` before the first Sketch MCP call.
2. Call `get_guide({ topic: "use" })` before reading, creating, laying out, styling, exporting, or wiring prototypes.
3. Load subtopics on demand: `layout` (`StackLayout`, `FlexSizing`, Pin), `styling` (`Swatch`, `SharedStyle`, per-side borders, concentric corners, blurs, `Tint`), `symbols` (`SymbolMaster`, `SymbolInstance`, nested/image overrides), `assets` (`sketch.export`, `sketch.createLayerFromData`), `prototyping` (`flow`, `flowStartPoint`, `HotSpot`), and `troubleshooting` (`run_code` diagnosis before retrying failed calls).

### Document Open, Resolve, and Save Lifecycle (`No current Sketch document`)

- `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, and `get_screenshot` require an open document's `targetDocumentID`.
- When closed, never parse `.sketch` ZIP archives offline; resolve `doc.id` in `run_code` via `sketch.Document.getDocuments()` or `sketch.Document.open('/abs/path/to/file.sketch', (err, doc) => { ... })`.
- After edits and visual acceptance, save with `doc.save()` (`doc.close()` on inactive files) and run `sketchtool duplicates <file>` to confirm `0` duplicate object IDs.

### Read-Only Inspection First

- Call `get_document_info({ targetDocumentID })` for document ID, Pages, layer counts, and frame bounds.
- Call `get_layer_tree_summary({ targetDocumentID, layerID, depth: 1..10 })` for hierarchy, text summaries, Stack hints, and override counts.
- Reserve `sketch.find(predicate, root)` (`#uuid`, `Frame`, `SymbolMaster`, `SymbolInstance`, `Text`, `[name~*="keyword"]`, `[frame.x>=24]`, `:not-hidden`) for single-root or UUID lookups. Across dozens or hundreds of Frames in `run_code`, recurse `node.layers` in plain JS (`< 50ms`) instead of `sketch.find('*', frame)` (`60`–`90s` in Cocoa predicates).
- Check `layer.isGraphicFrame` first and `layer.isFrame` second: nested Frames, Graphics, and plain Groups all report `layer.type === 'Group'`, while Graphics report both flags `true`.

### Library and Asset Discovery (`get_libraries` + `get_design_assets` + `get_symbol_overrides`)

- Call `get_libraries({ targetDocumentID })` to list enabled Libraries (`bencao`, `Apple iOS 27 UI Kit`).
- Call `get_design_assets({ targetDocumentID, kind, nameContains, sourceLibraryID })` to query `symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, and `graphicTemplate` assets.
- Import and assign cross-library references on one line (`var inst = ref.import().createNewInstance()` or `override.swatchValue = swatchRef.import()`) so references are not dropped.
- Before overriding an instance, call `get_symbol_overrides({ targetDocumentID, symbolInstanceID, kind })` (`kind`: `'text' | 'color' | 'image' | 'all'`, never `layerID`) to get `commonOverrideIDPrefix`.

### `run_code` Execution Rules (Preventing Parser Errors, Wrapper Traps, and `3m0s` Timeouts)

- Start every script with `const sketch = require('sketch')` and use only public JS APIs (no `sketchObject`, Obj-C selectors, or Node `fs`).
- Never include comments (`//` or `/* */`), minify to one line, or redeclare a `function` name in the same scope.
- Never compare Sketch layer wrappers with `===` or `!==`: `layer.parent` allocates a fresh JS wrapper each access (`cur !== rootFrame` is always `true`), walking past `Artboard` into `Page`/`Document`. Compare `.id` and bound ancestor walks with `cur && cur.id !== rootFrame.id && cur.type === 'Group'`.
- Never scan `instance.overrides` across an entire `200+`-Frame file: reading `.overrides` on thousands of composite instances (`Shell/Header`, `Navigation/Item`) expands full Cocoa trees (`95%+` CPU, `3m0s` timeout). Filter by `instance.master && instance.master.name` prefix first (`/Feedback/`, `/Data/`, `/Button/`) or process one `Page` per call.
- Run one atomic action per call, re-resolve `doc` and IDs, and output one final `console.log(JSON.stringify({ ok: true, ... }))` line (never `return` or `sketch.UI.message`).

### Pixel-Level Visual Acceptance and Asset Export (`get_screenshot` vs `sketch.export`)

- After every visual or layout edit, call `get_screenshot({ targetDocumentID, layerID })` to verify hierarchy, alignment, spacing, unclipped text, and bounds.
- Export slices via `sketch.export(layer, { output: '/abs/dir', filename: 'name.png', formats: ['png'], scales: ['2.0'], overwriting: true })` (`output`: absolute directory, never `false`).

## 2. Bundled `sketchtool` CLI Toolchain (Prefer First for Large-File Triage and Batch Export)

Use `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` before GUI open for multi-file inventory, oversized-archive triage, duplicate-ID checks, migration, and batch exports (avoiding Cocoa/GPU overhead), then use Sketch MCP for all edits, Library bindings, Stack layout, overrides, `get_screenshot` checks, and `doc.save()`:

- `sketchtool metadata <file>` and `sketchtool list pages|artboards|layers <file>`: headless structure inspection.
- `sketchtool duplicates <file>`: repair duplicate IDs before open and verify `0` duplicates after `doc.save()`.
- `sketchtool migrate <file>`: native migration and collaboration-patch cleanup.
- `sketchtool export preview|artboards|layers|pages <file> --output=/abs/dir`: headless batch export.

Never synthesize or mutate `.sketch` ZIP/JSON archives via Python, Node, or shell scripts.

## 3. Native Component Architecture, Full Overrides, and Modern Layout and Styling

### Single Symbol Master Home and Cross-Library Binding

- Place every `SymbolMaster` at the top level of `Symbols` (`sketch.Page.getSymbolsPage(doc)`), never on a regular page or nested inside an `Artboard` or `Group`.
- Bind shared components (`foreignSymbols`), color variables (`foreignSwatches`), and styles (`sharedTextStyles`, `sharedLayerStyles`) via Sketch Libraries rather than local copies.
- `doc.save()` on an in-repo Library (`bencao.sketch`) neither updates a separate copy in `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` nor refreshes imported `foreignSymbols` in consumers. After saving a shared Library, sync the registered `Libraries/` copy when authorized, then in each open consumer call `syncWithLibrary()` on affected imported `SymbolMaster` (`instance.master`), `Swatch`, and `SharedStyle` entries plus `instance.resizeWithSmartLayout()` on affected instances before `get_screenshot` and `doc.save()`.

### Full Override-Driven States (Do Not Arbitrarily `detach()` Instances)

Drive variations via `commonOverrideIDPrefix + '_' + property` rather than `detach()`: `stringValue` (copy), `symbolID` (nested state symbols), `isVisible` and `preservesSpaceWhenHidden` (optional slots), `swatchValue` / `color:fill-N` / `color:border-N` / `textColor` / `fillColor` (semantic colors), `textStyle` and `layerStyle`, `horizontalSizing` and `verticalSizing`, `image` and `imageResizeBehavior` (`2` Fit, `3` Fill), and `flowDestination` (same-track target Frame ID or `'back'`, `sketch.Flow.BackTarget`).

### Modern Containers, Stack Layout, and Native Styling

- Build UI containers (screens, sections, cards, lists, rows, form groups, toolbars, dialogs, and transparent wrappers with `background: { enabled: false }`) as `sketch.Group.Frame`, and proportional icons/illustrations as `sketch.Group.Graphic`. Never call `new sketch.Group(...)` or `group.convertToGroup()` (overriding plain-Group examples in `get_guide`), or add standalone `Rectangle`/`ShapePath` layers inside containers to fake fills, borders, dividers, shadows, focus rings, or corners.
- Audit plain groups (`!layer.isFrame && !layer.isGraphicFrame`) and existing Frames (`layer.isFrame && !layer.isGraphicFrame`) so files neither trigger `could be upgraded to Frames` nor keep fake-upgraded child chrome:
  - In read-only mode, report plain groups, leftover backdrop/divider shapes, external `*-focus` rectangles, ancestor `clipsContents === true` clipping `Focus` instances, `Direction.Row` icons using `FlexSizing.Fill` or wrapped/clipped button and pill labels, single-char `Text` pseudo-icons, sibling AABB overlaps, child bounds overflow, clipped multi-line `Text`, light surfaces in `Dark` Frames, or broken tree connectors without mutating the file.
  - When editing is authorized, keep `Graphic` containers (`isGraphicFrame === true`), upgrade proportional icon roots via `group.convertToGraphic()`, and upgrade UI groups via `group.convertToFrame()` (`group.background.enabled = false` on transparent wrappers).
  - Across upgraded and existing Frames, migrate child backdrops (`surface`, `disclosure-surface`, `bg`, `backdrop`, `*底板`, `*底面`) and dividers (`separator`, `rule`, `divider`, `*分隔线`, `*分割线`, including `1px` cross-axis stretched rules) onto parent `sharedStyle` and `Swatch`-linked `style.fills`, `style.borders`, `border.sides = { top: 0, right: 0, bottom: 1, left: 0 }`, `shadows`, and `corners`, reconcile `clipsContents`, delete the redundant shapes, and verify via `get_screenshot`.
  - Never stack external rectangles (`*-focus`) to fake focus rings; use `Focus` variants (`*/Focus/*`) or native `borders`/`shadows`. Because `*/Focus/*` rings extend `-5px` outside control bounds (`3px` offset + `2px` outline), set `clipsContents = false` on every parent and ancestor `Group.Frame` wrapping a `Focus` instance (unless it is a scroll viewport with `>= 6px` inner padding) so rings are never sliced into corner arcs.
- Build UI icons (`chevron-down`, `chevron-right`, `chevron-left`, `check`, `close`, `search`, `alert`, `info`) with Library icon instances or `ShapePath.fromSVGPath` (`1.5px` stroke, round caps/joins, centered in a fixed-size `Group.Graphic` or `Group.Frame`), never single-character `Text` (`⌄`, `›`, `‹`, `✓`, `✕`, `×`) or assembled rectangles.
- Compose layouts with `stackLayout` (`Direction.Row` / `Direction.Column`, `gap`, `padding`, `wraps`, `bordersAffectLayout`). Highest `parent.layers` index renders leftmost/topmost; reorder via `layer.index = n` then `stackLayout.apply()`, never `parent.layers = [...]`. Pair `stackLayout` with `FlexSizing` (`Fixed`, `Fit`, `Fill`, `Relative`, `minSize`, `maxSize`): inside `Direction.Row` stacks (buttons, badges, filter pills, menu/nav items), lock fixed-size icons, avatars, spinners, and status dots to `FlexSizing.Fixed` on both axes (never `Fill`, which splits width with labels and wraps `48px` buttons to `68px`–`70px`), set single-line button/pill labels to `FlexSizing.Fit` (`Text` `Fill` wrapping allowed only in explicit multi-line narrow columns `>= 220px` wide), and call `instance.resizeWithSmartLayout()` after longer `_stringValue` overrides so labels never clip or wrap.
- After deleting redundant shapes or changing card/text heights inside non-Stack outer `Group.Frame` containers, recompute bounds bottom-up (`inner card -> section Frame -> body wrapper -> footer Y -> top-level Artboard height`) so content never overlaps footers or leaves dead gaps.
- Maintain zero unintended AABB overlap among visible siblings (`layer.isVisible === true`) inside non-overlay containers. For hierarchical tree connectors (vertical `branch`, horizontal `branch-joint`, and `expand`/`collapse` buttons), enforce four geometry invariants:
  1. **Aligned Indentation and Zero Button Intrusion**: Align parent disclosure button center `X` with child vertical `branch` `X`, ending `branch-joint` `>= 4px` before the child button's left edge without piercing it.
  2. **Continuous Ancestor Trunk Lines**: Render an ancestor's outer vertical trunk continuously across `y: 0..rowHeight` of every expanded descendant row while that ancestor has following visible siblings.
  3. **`L`-Shaped Termination on Final Visible Child**: Stop the last visible child's vertical `branch` at `height = rowCenterY` where `branch-joint` meets, leaving zero dangling tail to `rowHeight`.
  4. **Unbroken Connector Gutter Across Row Dividers**: Inset or omit row dividers across the left connector gutter so borders never slice between parent button and child `branch`.
- Keep visible children inside every nested `Frame` within parent bounds (allowing only intentional `-5px` `Focus` rings under `clipsContents = false`), and size multi-line `Text` height for its full wrapped line count without bottom clipping.
- In `Dark` Frames, bind both top-level background and every nested card, panel, drawer, and row fill to `Dark` semantic surface `Swatch` variables; never leave light or white inner surfaces.
- Use `CornerStyle.Smooth` or `corners.concentric = true` for nested corners and `style.tint = { swatch }` for unified tinting; call `doc.processPendingChanges()` after updating swatches, shared styles, or concentric corners.

## 4. Orthogonal Organization, Spatial Zoning, and Responsive Breakpoints

Organize deliverables by cohesive module (`design/current/<domain>/<module>.sketch`) under strict rollout, scale, zoning, and anti-bloat guardrails:

- **Exemplar-First Gate for Multi-Module Refactors**: When a shared Library change or cross-module layout/prototype refactor affects `>= 3` business `.sketch` files, converge and deliver the Library plus `1` representative exemplar module through `get_screenshot` checks and Human visual sign-off first before batch-propagating to remaining modules or opening parallel PRs (unless batch rollout is explicitly authorized upfront).
- **Consolidated Design-System Library**: Keep `bencao.sketch` consolidated into showcase/spec pages (`SymbolInstance` layers only) plus `Symbols`, never triplicate `Core/Light/Dark` `SymbolMaster` clones.
- **Sub-Flow Page Partitioning and Document Scale**: Partition each module by core sub-flow into `2`–`8` business Pages plus `1` `Symbols` Page (never by `viewport width × theme`). Target `<= 250` top-level Frames and `<= 50,000` layers for new/deduplicated standard modules (`<= 250` Frames/Page), with a document ceiling of `<= 12` Pages, `<= 1,200` Frames, and `<= 200,000` layers (honoring explicit project thresholds in read-only audits when free of Cartesian duplication).
- **Primary Viewports vs. On-Demand Secondary Breakpoints**: Cover Light/Dark on primary viewports (`1440`, `390`). Add secondary breakpoints from `{1200, 834, 768, 320}` only on real structural reflow (sidebar collapse, table-to-card switch, toolbar wrap); omit unchanged widths and never clone micro-states across `state × width × theme`.
- **Three-Band Canvas Zoning, Anti-Bloat Pruning, and Sidebar Order**:
  - Arrange top-level Frames along `X` (`120`–`160px` gutters) across three vertical `Y` bands (`360`–`480px` gaps):
    1. **Band 1 (Top — Control-Reachable Interactive Graph)**: Primary-viewport Light/Dark rows (`1440 · Light`/`Dark`, plus `390 · Light`/`Dark` when mobile flows exist) covering core progression and every normal branch reachable via visible UI controls (top-bar account/avatar menu expand/collapse, status filter pills, pagination switches, row drill-downs across business statuses into detail views, and unsaved-form `Cancel` confirmation dialogs), named with step prefixes (`01 · Invitation List · 1440 · Light`).
    2. **Band 2 (Middle — Server and Boundary Contract States)**: Primary-viewport Light/Dark pairs aligned under their parent Band 1 step (`02a · ...`), limited to states unreachable via normal clicks alone: initial loading skeletons, API read failures, empty states, `401`/`403` blocks, field validation errors, `409` conflicts, `429` cooldowns, unknown-outcome recovery, and `64`-char overflow contract states.
    3. **Band 3 (Bottom — Secondary Responsive Reflows)**: Real-data layout-reflow Frames with breakpoint prefixes (`R1 · Invitation List · 768 · Light`).
  - Enforce three anti-bloat bans: (1) never clone a whole Frame solely to show focus returning after closing a dialog; (2) never duplicate conflicting same-view primary lists in sub-flow Pages or invent cross-slice placeholder Frames (`衔接目标`, `关联切片`, `片外入口`); and (3) never clone loading skeletons (`正在读取`, `初始读取中`, `加载中`) into Band 3.
  - Sync Page layer-list order (`frame.index`, highest index at top) with `Band 1 -> Band 2 -> Band 3`.

## 5. Prototype Entry Convergence, Same-Track Wiring, and Production UI Purity

Keep prototypes focused on authentic user navigation while reviewing server and reflow states statically:

- **Converged Start Points and 100% Band 1 Reachability**: Set `frame.flowStartPoint = true` only on the step `01` entry Frame of each Band 1 primary `viewport × theme` track (`2` per desktop Page, or up to `4` with mobile tracks), and `false` elsewhere. Every Band 1 Frame must be `100%` BFS-reachable from its track's `flowStartPoint` with `outgoingFlows > 0` (zero dead ends).
- **Same-Track Navigation, Zero Orphan Flows, and Zero Semantic Self-Loops**:
  - Restrict full-screen `layer.flow` and `flowDestination` links to top-level Frames with matching `frame.width` and `Light`/`Dark` theme, or `sketch.Flow.BackTarget` (`'back'`); allow Sketch Overlays (modals, drawers, popovers) to keep intrinsic sizes on the same primary viewport track and theme. Never wire cross-viewport (`390` to `1440`) or cross-theme jumps.
  - Clear outgoing links on Band 2 and Band 3 Frames (`layer.flow = undefined` and every `SymbolInstance` `flowDestination` override set to `""`) so Sketch creates zero implicit prototype roots.
  - Eliminate direct (`targetId === currentFrame.id`) and same-view semantic self-loops on active navigation: on any Frame showing the primary list/directory view of an item (including expanded, filtered, paginated, empty, cancel-return, and post-submit list states), set `layer.flow = undefined` and `_flowDestination = ""` on the active item (`Current`, `Active`, `Selected`), allowing sidebar return to the primary list only from drill-down detail or standalone create/edit views. Keep authorized sibling-module nav items visible in shared `Shell` chrome with cleared `flow`/`_flowDestination` instead of hijacking them to fake local placeholder Frames.
  - Probe each Page's prototype graph in `run_code`: verify `layer.flow` via `layer.flow.isValidConnection()` plus same-track target resolution (`layer.flow.target`, `targetId`, or `isBackAction()`), verify string `flowDestination` overrides against an existing same-track top-level Frame or `'back'`, and verify `100%` Band 1 BFS reachability.
- **Production UI Purity, Copy Hygiene, and Single-Source Controls**:
  - Across `layer.name`, `Text` content, and `SymbolInstance` `_stringValue` overrides, never expose: (a) prototype helpers, branch switchers, or banners (`Prototype Demo: ...`, `*示例`, `原型核对`, `原型分支核对栏`, `原型快捷入口`, `原型分支入口`, `原型过渡说明`, `演示分支`, `模拟读取失败`, `查看…异常/故障/拦截态`, `返回原型页面`) or hijacked business buttons (`返回修改`, `关闭`); (b) engineering IDs or slugs (`（D3）`, `PATH-xx`, `save-refresh-failed`, `DemoOnly_...`); (c) interaction/a11y spec notes (`初始焦点位于…`, `默认聚焦…`, `按 Escape 关闭`, `确认弹窗不显示明文…`, `零截断`, `示例名称完整展示`, `测试专用`); (d) API write or state-machine internals (`仅提交已修改的字段`, `不重复写入旧值`, `刚刚重读`, `读回`, `终态`, `单事务`, `共有底座`, `权限子集铁律`); or (e) raw integer/type boundaries and storage jargon (`2147483647`, `int32`/`int64`, `原码` for `raw code`, `受权`, or doubled replacement tokens).
  - Never add hidden, off-control, or corner-anchored synthetic `sketch.HotSpot` layers (`__cross_page_flow__` at `(0, 0, 48×48)`) or hidden error-jump overlays; wire transitions to visible UI controls (`Navigation/Item`, header back controls, filter/pagination controls, row actions, primary CTAs), allowing a `1:1` exact-bounds `sketch.HotSpot` over a visible sub-control only when a composite `Shell` `SymbolMaster` (such as a header account trigger) exposes no nested `flowDestination` slot.
  - Never place manual refresh buttons (`刷新`, `刷新列表`, `刷新资料`, `刷新记录`, `刷新最新状态`, `Refresh`, `refresh`) on normally loaded Band 1 list, detail, overview, or tree views (including normal business-status views like `暂不可用` records, never misclassified as `服务暂不可用` API failures) unless polling/sync is an explicit product requirement. On Band 2 unknown-outcome recovery (`提交结果未明`) Frames, place at most one neutral recovery button (`刷新当前状态` or `刷新列表`), never multiple outcome-spoiling buttons (`刷新见已生效`, `刷新见仍为原顺序`, `刷新读取失败`, `刷新列表（已删除）`, `刷新列表（仍存在）`).
  - Retain at most `1` page-level `返回` or breadcrumb-back entry per Frame, placed only in the top bar or page header; never duplicate `返回` across page header, card header, and bottom bar (form footers keep only `Cancel` and one primary submit CTA).
- **Read-Only Audit Parity**: In read-only mode, report excess `flowStartPoint` flags, unreachable or dead-end Band 1 Frames, Band 1/2/3 misclassifications or skeleton/focus/handoff bloat, cross-track or broken flows, active-nav self-loops, synthetic `HotSpot` layers, copy leaks across `layer.name`/`Text`/`_stringValue`, unauthorized `Refresh` or spoiler recovery buttons, or duplicate `返回` controls without mutating the file.
