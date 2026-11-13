---
name: sketch-native
description: MUST load before any .sketch inspection, diagnosis, creation, editing, or review on macOS. Routes all .sketch work through Sketch 2026.3+ MCP tools and sketchtool CLI; strictly forbids offline Python/ZIP archive synthesis.
metadata:
  short-description: Native Sketch 2026.3+ MCP workflow with libraries, Stacks, symbols, and visual verification
---

# Sketch Native Workflow (`sketch-native`)

Shared macOS skill routing `.sketch` work through Sketch 2026.3+ MCP and `sketchtool` across Codex, DeepSeek Harness, and Antigravity CLI (skipped off macOS; never writes MCP registration or Sketch preferences).

In Codex routing, use `gpt-6.1-sol` (`medium`; `high` only for complex multi-state layouts) for page/component/Stack composition, `gpt-6.1-sol` or `gpt-6-luna` (`low`) for incremental `run_code` edits, and `gpt-6.1-terra` (`low`) for screenshot checks.

## 0. Required Official and Project Library Preflight

Before `.sketch` work, check `get_libraries` or `sketch.Library.getLibraries()` and verify `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` installs and enables:

1. **Project Design-System Library** (such as `bencao.sketch`).
2. **`Apple iOS 27 UI Kit`** (iOS and Mini Program status bars, Home Indicator safe areas, system controls).
3. **Sketch Official `Default Templates` and `Inspire UI Kit`** (when present locally).

In read-only mode, report missing, unregistered, or disabled Libraries without modifying host state. When authorized, enable via `const lib = sketch.Library.getLibraryForDocumentAtPath('/abs/path/to/library.sketch'); lib.enabled = true;` and verify `lib.enabled === true`, reporting any disk or authorization gap first.

## 1. Sketch MCP 8 Tools and Invocation Sequence

Sketch 2026.3+ ships built-in guides and eight MCP tools (`get_guide`, `get_document_info`, `get_layer_tree_summary`, `get_libraries`, `get_design_assets`, `get_symbol_overrides`, `run_code`, `get_screenshot`):

### Preload Built-In MCP Guides (`get_guide`)

1. Call `get_guide({ topic: "mcp" })` before the first MCP call, and `get_guide({ topic: "use" })` before reading, creating, laying out, styling, exporting, or wiring prototypes.
2. Load subtopics on demand: `layout` (`StackLayout`, `FlexSizing`, Pin), `styling` (`Swatch`, `SharedStyle`, per-side borders, concentric corners, blurs, `Tint`), `symbols` (`SymbolMaster`, `SymbolInstance`, nested/image overrides), `assets` (`sketch.export`, `sketch.createLayerFromData`), `prototyping` (`flow`, `flowStartPoint`, `HotSpot`), and `troubleshooting` (`run_code` diagnosis before retries).

### Document Lifecycle (`No current Sketch document`)

- Inspection, asset, override, and screenshot tools require an open document's `targetDocumentID`; when closed, never parse `.sketch` ZIPs offline—resolve `doc.id` in `run_code` via `sketch.Document.getDocuments()` or `sketch.Document.open('/abs/path/to/file.sketch', (err, doc) => { ... })`.
- After edits and screenshot acceptance, save via `doc.save()` (`doc.close()` on inactive files), confirm `0` duplicate IDs with `sketchtool duplicates <file>`, and run `find design -name '.DS_Store' -delete` before directory-walking preview or MIME tests.

### Read-Only Inspection First

- Call `get_document_info({ targetDocumentID })` for document ID, Pages, layer counts, and frame bounds, and `get_layer_tree_summary({ targetDocumentID, layerID, depth: 1..10 })` for subtree hierarchy, text, Stack hints, and override counts.
- Reserve `sketch.find(predicate, root)` (`#uuid`, `Frame`, `SymbolMaster`, `SymbolInstance`, `Text`, `[name~*="keyword"]`, `[frame.x>=24]`, `:not-hidden`) for single-root/UUID lookups; across many Frames in `run_code`, recurse `node.layers` in plain JS (`< 50ms`) instead of `sketch.find('*', frame)` (`60`–`90s` Cocoa predicates).
- Check `layer.isGraphicFrame` first and `layer.isFrame` second: nested Frames, Graphics, and plain Groups all report `layer.type === 'Group'`, while Graphics report both flags `true`.

### Library and Asset Discovery

- Call `get_libraries({ targetDocumentID })` for enabled Libraries (`bencao`, `Apple iOS 27 UI Kit`) and `get_design_assets({ targetDocumentID, kind, nameContains, sourceLibraryID })` for `symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, and `graphicTemplate` assets.
- Import and assign cross-library references inline (`var inst = ref.import().createNewInstance()` or `override.swatchValue = swatchRef.import()`) so references persist.
- Before overriding an instance, call `get_symbol_overrides({ targetDocumentID, symbolInstanceID, kind })` (`kind`: `'text' | 'color' | 'image' | 'all'`, never `layerID`) to get `commonOverrideIDPrefix`.

### `run_code` Execution Rules

- Start scripts with `const sketch = require('sketch')` using public JS APIs only (no `sketchObject`, Obj-C selectors, or Node `fs`); never write comments (`//` or `/* */`), minify to one line, or redeclare a `function` in scope.
- Never compare layer wrappers with `===` or `!==`: `layer.parent` allocates a fresh wrapper per access (`cur !== rootFrame` stays `true`), walking past `Artboard` into `Page`/`Document`. Compare `.id` and bound walks with `cur && cur.id !== rootFrame.id && cur.type === 'Group'`.
- Snapshot `.layers` and `.frame` once before indexed loops or `O(N^2)` checks (`const arr = page.layers; const rects = arr.map(x => x.frame);`, `< 5ms`): reading `page.layers[i]` or `group.layers[i]` in loops re-bridges `MSLayerArray -> JSWrapperMap` without draining the autorelease pool, spiking RAM past `50GB+` and freezing Sketch.
- Never scan `instance.overrides` across `200+`-Frame files: reading `.overrides` on thousands of composite instances (`Shell/Header`, `Navigation/Item`) expands Cocoa trees (`95%+` CPU, `3m0s` timeout). Filter `instance.master && instance.master.name` prefix first (`/Feedback/`, `/Data/`, `/Button/`) or run one `Page` per call.
- Run one atomic action per call, re-resolve `doc` and IDs, and emit one final `console.log(JSON.stringify({ ok: true, ... }))` line (never `return` or `sketch.UI.message`).

### Visual Acceptance and Export (`get_screenshot` vs `sketch.export`)

- After every visual or layout edit, call `get_screenshot({ targetDocumentID, layerID })` to verify hierarchy, alignment, spacing, unclipped text, and bounds.
- Export slices via `sketch.export(layer, { output: '/abs/dir', filename: 'name.png', formats: ['png'], scales: ['2.0'], overwriting: true })` (`output`: absolute directory, never `false`).

## 2. Bundled `sketchtool` CLI Toolchain

Prefer `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` before GUI open for multi-file inventory, large-archive triage, duplicate-ID repair, migration, and batch export, then use Sketch MCP for edits, Library bindings, Stack layout, overrides, `get_screenshot`, and `doc.save()`:

- `sketchtool metadata <file>` and `sketchtool list pages|artboards|layers <file>`: headless structure inspection.
- `sketchtool duplicates <file>`: repair duplicate IDs before open and verify `0` duplicates post-save.
- `sketchtool migrate <file>`: native migration and collaboration-patch cleanup.
- `sketchtool export preview|artboards|layers|pages <file> --output=/abs/dir`: headless batch export.

Never synthesize or mutate `.sketch` ZIP/JSON archives via Python, Node, or shell scripts.

## 3. Native Component Architecture, Overrides, and Modern Layout

### Single Symbol Master Home and Cross-Library Sync

- Place every `SymbolMaster` at the top level of `Symbols` (`sketch.Page.getSymbolsPage(doc)`), never on a regular page or nested inside an `Artboard` or `Group`.
- Bind shared components (`foreignSymbols`), color variables (`foreignSwatches`), and styles (`sharedTextStyles`, `sharedLayerStyles`) via Sketch Libraries rather than local copies.
- Saving an in-repo Library (`bencao.sketch`) neither updates `~/Library/Application Support/com.bohemiancoding.sketch3/Libraries/` nor refreshes consumer `foreignSymbols`. After saving a shared Library, sync the registered `Libraries/` copy when authorized, then in open consumers call `syncWithLibrary()` on affected imported `SymbolMaster` (`instance.master`), `Swatch`, and `SharedStyle` entries plus `instance.resizeWithSmartLayout()` before `get_screenshot` and `doc.save()`.

### Full Override-Driven States (No Arbitrary `detach()`)

Drive variations via `commonOverrideIDPrefix + '_' + property` rather than `detach()`: `stringValue`, `symbolID`, `isVisible`, `preservesSpaceWhenHidden`, `swatchValue` / `color:fill-N` / `color:border-N` / `textColor` / `fillColor`, `textStyle`, `layerStyle`, `horizontalSizing`, `verticalSizing`, `image` / `imageResizeBehavior` (`2` Fit, `3` Fill), and `flowDestination` (same-track Frame ID or `'back'`, `sketch.Flow.BackTarget`). When swapping a nested `<prefix>_symbolID` (e.g., `AccountTrigger/Default` to `AccountTrigger/Focus` in `Shell/Header`), clear stale child overrides under `<prefix>/` keyed to the former master's inner UUIDs—or `duplicate()` a clean template instance—so archives retain zero dangling `unresolvedOverrides`.

### Modern Containers, Stack Layout, and Native Styling

- Build UI containers (screens, sections, cards, lists, rows, form groups, toolbars, dialogs, and transparent wrappers with `background: { enabled: false }`) as `sketch.Group.Frame`, and proportional icons/illustrations as `sketch.Group.Graphic`. Never call `new sketch.Group(...)` or `group.convertToGroup()` (overriding plain-Group `get_guide` examples), or add child `Rectangle`/`ShapePath` layers to fake fills, borders, dividers, shadows, focus rings, or corners.
- Audit plain groups (`!layer.isFrame && !layer.isGraphicFrame`) and existing Frames (`layer.isFrame && !layer.isGraphicFrame`) so files neither trigger `could be upgraded to Frames` nor keep fake-upgraded child chrome:
  - In read-only mode, report plain groups, leftover backdrop/divider shapes, external `*-focus` rectangles, ancestor `clipsContents === true` clipping `Focus` instances, `Direction.Row` icons using `FlexSizing.Fill` or wrapped/clipped button and pill labels, dangling `unresolvedOverrides`, single-char `Text` pseudo-icons, sibling AABB overlaps, child bounds overflow, clipped multi-line `Text`, light surfaces in `Dark` Frames, or broken tree connectors without mutating the file.
  - When editing is authorized, keep `Graphic` containers (`isGraphicFrame === true`), upgrade proportional icon roots via `group.convertToGraphic()`, and upgrade UI groups via `group.convertToFrame()` (`group.background.enabled = false` on transparent wrappers).
  - Migrate child backdrops (`surface`, `disclosure-surface`, `bg`, `backdrop`, `*底板`, `*底面`) and dividers (`separator`, `rule`, `divider`, `*分隔线`, `*分割线`, including `1px` cross-axis rules) onto parent `sharedStyle` and `Swatch`-linked `style.fills`, `style.borders`, `border.sides = { top: 0, right: 0, bottom: 1, left: 0 }`, `shadows`, and `corners`, reconcile `clipsContents`, delete redundant shapes, and verify via `get_screenshot`.
  - Never stack external `*-focus` rectangles; use `Focus` variants (`*/Focus/*`) or native `borders`/`shadows`. Because `*/Focus/*` rings extend `-5px` outside bounds (`3px` offset + `2px` outline), set `clipsContents = false` on parent/ancestor `Group.Frame` layers wrapping `Focus` instances (except scroll viewports with `>= 6px` inner padding) so rings are never clipped.
- Build UI icons (`chevron-down`, `chevron-right`, `chevron-left`, `check`, `close`, `search`, `alert`, `info`) with Library icon instances or `ShapePath.fromSVGPath` (`1.5px` stroke, round caps/joins, centered in a fixed-size `Group.Graphic` or `Group.Frame`), never single-char `Text` (`⌄`, `›`, `‹`, `✓`, `✕`, `×`) or assembled rectangles.
- Default page body wrappers, content cards, form sections, and action bars to `stackLayout` (`Direction.Row` / `Direction.Column`, `gap`, `padding`, `wraps`, `bordersAffectLayout`) so content growth automatically reflows siblings without overlapping controls below. Highest `parent.layers` index renders leftmost/topmost; reorder via `layer.index = n` then `stackLayout.apply()`, never `parent.layers = [...]`. Pair `stackLayout` with `FlexSizing` (`Fixed`, `Fit`, `Fill`, `Relative`, `minSize`, `maxSize`): in `Direction.Row` stacks (buttons, badges, filter pills, menu/nav items), lock fixed-size icons, avatars, spinners, and dots to `FlexSizing.Fixed` on both axes (never `Fill`, which splits width and wraps `48px` buttons to `68px`–`70px`), set single-line button/pill labels to `FlexSizing.Fit` (`Text` `Fill` wrapping allowed only in multi-line narrow columns `>= 220px` wide), and call `instance.resizeWithSmartLayout()` after longer `_stringValue` overrides.
- After deleting shapes or changing card/text heights in legacy non-Stack outer `Group.Frame` containers, recompute bounds bottom-up (`inner card -> section Frame -> body wrapper -> footer Y -> top-level Artboard height`) to prevent footer overlap or dead gaps.
- Maintain zero unintended AABB overlap among visible siblings (`layer.isVisible === true`) in non-overlay containers. For tree connectors (`branch`, `branch-joint`, `expand`/`collapse` buttons), enforce four invariants: (1) align parent button center `X` with child vertical `branch` `X`, ending `branch-joint` `>= 4px` before child button left edge; (2) span an ancestor's vertical trunk across `y: 0..rowHeight` of expanded descendants while following visible siblings exist; (3) end the last visible child's vertical `branch` in an `L` at `height = rowCenterY` with zero tail; and (4) inset or omit row dividers across the left connector gutter.
- Keep visible children in nested `Frame` layers within parent bounds (except `-5px` `Focus` rings under `clipsContents = false`), size multi-line `Text` for full wrapped lines without bottom clipping, bind `Dark` Frame backgrounds and nested card/panel/drawer/row fills to `Dark` semantic surface `Swatch` variables (no light inner surfaces), and use `CornerStyle.Smooth` / `corners.concentric = true` and `style.tint = { swatch }`, calling `doc.processPendingChanges()` after swatch, shared-style, or concentric-corner updates.

## 4. Orthogonal Organization, Spatial Zoning, and Breakpoints

Organize deliverables by cohesive module (`design/current/<domain>/<module>.sketch`):

- **Exemplar-First Gate**: When a shared Library change or cross-module layout/prototype refactor affects `>= 3` business `.sketch` files, converge the Library plus `1` exemplar module through `get_screenshot` and Human visual sign-off before batch rollout or parallel PRs (unless batch execution is authorized upfront).
- **Consolidated Library & Module Scale**: Keep `bencao.sketch` consolidated into showcase/spec pages (`SymbolInstance` layers only) plus `Symbols` (never triplicate `Core/Light/Dark` masters). Partition each module by core sub-flow into `2`–`8` business Pages plus `1` `Symbols` Page (never `viewport width × theme`), targeting `<= 250` Frames and `<= 50,000` layers per module (`<= 250` Frames/Page) under a ceiling of `<= 12` Pages, `<= 1,200` Frames, and `<= 200,000` layers (honoring explicit project thresholds in read-only audits free of Cartesian duplication).
- **Viewports & Three-Band Zoning**: Cover Light/Dark on primary viewports (`1440`, `390`), adding secondary widths from `{1200, 834, 768, 320}` only on real structural reflow (sidebar collapse, table-to-card, toolbar wrap) without cloning micro-states across `state × width × theme`. Arrange Frames along `X` (`120`–`160px` gutters) across three `Y` bands (`360`–`480px` gaps) synced to `frame.index` (`Band 1 -> Band 2 -> Band 3`):
  1. **Band 1 (Top — Representative Golden-Path Interactive Graph)**: Primary Light/Dark rows covering the core progression and representative single-step UI branches—entry-screen top-bar account menu toggle (`01 <-> 02`), single-dimension filter/role options, explicit pagination switches on Console tables and multi-page web directories, row drill-downs across distinct business statuses into detail/edit/confirm views, and unsaved-form `Cancel` dialogs—named with step prefixes (`01 · Invitation List · 1440 · Light`). Wire representative primary journeys (Golden Path) returning via `'back'` (`sketch.Flow.BackTarget`) or a single post-action list state rather than $2^N$ multi-step state subset lattices; for mobile/Mini Program feeds and personal self-service record streams using scroll-bottom auto-loading, show the loaded stream with a muted bottom status line (`已显示全部 N 条记录`) and zero `加载更多` buttons or cloned `更多记录` Frames.
  2. **Band 2 (Middle — Server & Boundary Contracts)**: Primary Light/Dark pairs aligned under parent Band 1 steps (`02a · ...`), limited to states unreachable via normal clicks alone: loading skeletons, scroll-bottom loading (`正在加载更多…`) and retryable scroll-load failure (`加载更多失败，点击重试`), API read failures, empty states, `401`/`403` blocks, validation errors, `409` conflicts, `429` cooldowns, unknown-outcome recovery, and `64`-char overflow contracts (never stranding enabled selectable options here).
  3. **Band 3 (Bottom — Responsive Reflows)**: Real-data layout-reflow Frames (`R1 · Invitation List · 768 · Light`).
  - Enforce four anti-bloat bans: (1) no Frame clones solely for post-dialog focus return; (2) no conflicting duplicate primary lists in sub-flow Pages or fake cross-slice Frames (`衔接目标`, `关联切片`, `片外入口`); (3) no loading skeletons (`正在读取`, `初始读取中`, `加载中`) in Band 3; and (4) no $2^N$ multi-step subset lattices (such as sequential combinations of cancelled/deleted records) or multi-field Cartesian screen permutations (`field A × field B × crop ratio`).

## 5. Prototype Convergence, Context-Preserving Flows, and UI Purity

- **Converged Start Points & 100% Band 1 Reachability**: Set `frame.flowStartPoint = true` only on the step `01` entry Frame of each Band 1 primary `viewport × theme` track (`2` per desktop Page, or up to `4` with mobile tracks), and `false` elsewhere. Every Band 1 Frame must be `100%` BFS-reachable from its track's `flowStartPoint` with `outgoingFlows > 0` (zero dead ends).
- **Same-Track Flows, Context-Preserving Menus, and Record Continuity**:
  - Restrict full-screen `layer.flow` and `flowDestination` links to top-level Frames with matching `frame.width` and `Light`/`Dark` theme, or `sketch.Flow.BackTarget` (`'back'`); allow pre-existing GUI Overlays to keep intrinsic sizes on the same track/theme, and never wire cross-viewport (`390` to `1440`) or cross-theme jumps.
  - Because Sketch's public JS API does not expose Prototype Overlay settings, never route top-bar menus/popovers from filtered, detail, or form Frames to a shared entry menu Frame (`02`) that loses active context: default to demonstrating shared top-bar menus (such as `AccountMenu`) at most once per desktop Page on the step `01` entry Frame (`01 <-> 02` via `sketch.Flow.AnimationType.none` instant cut), keeping the visual header shell on inner filtered, detail, form, and modal-scrim Frames without top-bar menu `HotSpot` layers or `1:1` menu-open clones (while honoring existing modules that already pair `1:1` context-preserving `S <-> M(S)` non-modal Frames with scrim Frames stripped of background `HotSpot` triggers).
  - Preserve end-to-end business record identity (entity name, role, quota, status, and timestamps) and a single consistent logged-in persona across connected Pages, list drill-downs, detail views, edit forms, and confirmation modals—never funneling distinct records into one generic sample modal/detail Frame or mixing conflicting user personas across linked sub-flows. Post-action receipt views return via `'back'` or to a single-action updated list without requiring $2^N$ sequential multi-record combinations.
  - Clear outgoing links on Band 2 and Band 3 Frames (`layer.flow = undefined` and every `SymbolInstance` `flowDestination` override set to `""`) so Sketch creates zero implicit prototype roots.
  - Eliminate direct (`targetId === currentFrame.id`) and semantic active-nav self-loops: on any Frame showing an item's primary list/directory view (expanded, filtered, paginated, empty, cancel-return, or post-submit list), clear `layer.flow = undefined` and `_flowDestination = ""` on the active item (`Current`, `Active`, `Selected`), allowing sidebar return only from drill-down detail or standalone create/edit views. Keep sibling-module nav items visible in shared `Shell` chrome with cleared `flow`/`_flowDestination` rather than hijacking them to placeholder Frames.
  - Probe each Page's prototype graph in `run_code`: verify `layer.flow.isValidConnection()` plus same-track target resolution (`target`, `targetId`, or `isBackAction()`), verify string `flowDestination` overrides against an existing same-track Frame or `'back'`, and verify `100%` Band 1 BFS reachability.
- **Production UI Purity, Copy Hygiene, and Single-Source Controls**:
  - Across `layer.name`, `Text` content, and `SymbolInstance` `_stringValue` overrides, never expose: (a) prototype helpers, branch switchers, or banners (`Prototype Demo: ...`, `*示例`, `原型核对`, `原型分支核对栏`, `原型快捷入口`, `原型分支入口`, `原型过渡说明`, `演示分支`, `模拟读取失败`, `查看…异常/故障/拦截态`, `返回原型页面`) or hijacked business buttons (`返回修改`, `关闭`); (b) engineering IDs or slugs (`（D3）`, `PATH-xx`, `save-refresh-failed`, `DemoOnly_...`); (c) interaction/a11y spec notes (`初始焦点位于…`, `默认聚焦…`, `按 Escape 关闭`, `确认弹窗不显示明文…`, `零截断`, `示例名称完整展示`, `测试专用`); (d) API write or state-machine internals (`仅提交已修改的字段`, `不重复写入旧值`, `刚刚重读`, `读回`, `终态`, `单事务`, `共有底座`, `权限子集铁律`); or (e) raw integer/type boundaries and storage jargon (`2147483647`, `int32`/`int64`, `原码` for `raw code`, `受权`, or doubled replacement tokens).
  - Never add hidden, off-control, or corner-anchored synthetic `sketch.HotSpot` layers (`__cross_page_flow__` at `(0, 0, 48×48)`) or hidden error-jump overlays; wire transitions to visible UI controls (`Navigation/Item`, header back controls, filter/pagination controls, row actions, primary CTAs), allowing a `1:1` exact-bounds `sketch.HotSpot` over a visible sub-control only on non-modal Frames when a composite `Shell` `SymbolMaster` (such as a header account trigger) exposes no nested `flowDestination` slot.
  - Never place manual refresh buttons (`刷新`, `刷新列表`, `刷新资料`, `刷新记录`, `刷新最新状态`, `Refresh`, `refresh`) on normal Band 1 list, detail, overview, or tree views (including normal `暂不可用` business-status views, never confused with `服务暂不可用` API failures) unless polling/sync is an explicit requirement. On Band 2 unknown-outcome (`提交结果未明`) Frames, place at most one neutral recovery button (`刷新当前状态` or `刷新列表`), never outcome-spoiling buttons (`刷新见已生效`, `刷新见仍为原顺序`, `刷新读取失败`, `刷新列表（已删除）`, `刷新列表（仍存在）`).
  - Retain at most `1` page-level `返回` or breadcrumb-back entry per Frame, placed only in the top bar or page header; never duplicate `返回` across page header, card header, and bottom bar (form footers keep only `Cancel` and one primary submit CTA).
- **Read-Only Audit Parity**: In read-only mode, report excess `flowStartPoint` flags, unreachable or dead-end Band 1 Frames, unwired single-step selectable options, cross-screen context loss or record/persona mismatches, Band 1/2/3 misclassifications or bloat, modal-scrim `HotSpot` leaks, cross-track/broken flows, active-nav self-loops, synthetic `HotSpot` layers, copy leaks, unauthorized `Refresh` or spoiler buttons, or duplicate `返回` controls without mutating the file—accepting entry-only (`01 <-> 02`) top-bar menu demonstration (without requiring inner-Frame menu `HotSpot` or `1:1` menu clones) and representative Golden-Path transitions (without demanding $2^N$ multi-step state lattices).
