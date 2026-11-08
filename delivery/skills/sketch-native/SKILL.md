---
name: sketch-native
description: Generate, mutate, export, and verify macOS native .sketch documents for Sketch 2026.3 and later with CoreText measurement, offline structural and prototype flow auditing, and single-slot non-activating Sketch MCP roundtrips with save receipts. Trigger when creating, editing, assembling, exporting, auditing, or roundtrip-validating .sketch files or Sketch MCP workflows.
metadata:
  short-description: High-throughput native .sketch generation, CoreText layout parity, offline audit, and Sketch MCP roundtrip verification
---

# Sketch Native Workflow (`sketch-native`)

## Overview

`sketch-native` generates, mutates, exports, and verifies `.sketch` documents for Sketch 2026.3+. It combines offline archives, CoreText measurement, and serialized native MCP checks. Execution is macOS-only: other platforms skip installation, and measurement fails closed without CoreText. The workflow incorporates Sketch's official `sketch-hq/agents` skills and built-in `MCPGuides`.

The same skill directory is delivered to Codex, Claude Code, and Antigravity CLI on macOS. Resolve script and reference paths from this installed directory. Antigravity CLI discovers it under `~/.gemini/antigravity-cli/skills/sketch-native/`; installation does not register MCP servers or configure Sketch. Native MCP operations require the local Sketch endpoint to be available.

For detailed `.sketch` archive JSON structures (`MSImmutableFlexGroupLayout`, `textBehaviour`, `CTFontRegularUsage`, `overrideValues`, `flow`, and `swatchID` bindings), read [`references/sketch-json-schema.md`](references/sketch-json-schema.md).

## Trigger Scenarios

Activate this skill whenever a task involves any of the following:

- Creating, modifying, composing, or refactoring `.sketch` documents (`document.json`, `pages/*.json`, `meta.json`, `user.json`).
- Measuring or re-baking fixed-width auto-height text layers (`textBehaviour == 1`), `SymbolInstance` text overrides, or `MSImmutableFlexGroupLayout` (Flex Stack) containers.
- Auditing `.sketch` files for object ID uniqueness, reference integrity (`symbolID`, `sharedStyleID`, `swatchID`, `MSImageData`, `overrideValues`), font hygiene, Flex Stack closure, 2px Focus Ring clipping, or prototype flow graph completeness.
- Driving Sketch's built-in MCP server (`http://localhost:31126/mcp`) to inspect, mutate, screenshot, save, and verify `.sketch` documents without stealing desktop focus or crashing JavaScriptCore into Safe Mode.
- Exporting artboards, pages, or layers via `sketchtool` (`1x`/`2x` PNG, lossless WebP, and layer PDFs for embedded font verification) and synchronizing `manifest.json` or `renders.json`.

## Architecture and Concurrency Model

The measurement and font-audit commands share [text-style resolution](scripts/sketch_text.py). This module owns local and imported text-style indexing, supported descriptor forms, and inheritance from shared styles through inline attributes, attributed runs, and explicit style overrides. Font hygiene inspects stored descriptors even when another value overrides them. Clock validation consumes the resolved font used by measurement.

The auditor, export manifest, and text measurement share [archive container identity](scripts/sketch_layers.py). Legacy `artboard` layers and page-level `group` layers with `groupBehavior: 1` (Frame) or `2` (Graphic) are screen roots. Nested Frames and Graphics retain their offsets within the enclosing screen. Symbol masters keep their separate identity. Frame recognition does not raise export or native-work limits, and reading an archive does not constitute native rendering or persistence acceptance.

The CoreText wrapper owns the measurement workload budget. It checks expanded text and rich-text work before constructing per-instance runs, then bounds JSON storage before serialization or native execution. A batch allows at most 8,192 specs, 131,072 UTF-16 text units, 16,384 runs, 8,388,608 text-unit/run comparisons, and a conservative 16 MiB JSON-size estimate. Swift independently checks its input and limits the batch to 32,768 generated lines, including empty paragraphs and wrapped lines. These independent bounds limit line records, rich-text comparisons, and memory even when many instances share one small master. Over-budget inputs fail before archive writeback; deduplication does not waive the budget. Native results must cover every unique measurement exactly once. Swift omits line details by default; pass `--include-lines` directly to the Swift helper when bounded per-line diagnostics are needed.

The commands share [bounded JSON parsing](scripts/sketch_json.py). Direct measurement input (files or stdin) and audit/export baseline files (`--manifest` and `--renders`) retain a 16 MiB byte limit, 30,000 objects, 120,000 container items, and 2,097,152 string characters. Bytes are bounded before decoding or parsing; metadata and strings in root or nested lists also count.

All four archive readers use a separate [archive JSON policy](scripts/sketch_archive.py): at most 32 MiB per JSON member, 128 MiB aggregate JSON, 1,000,000 objects, 8,000,000 container items, and 67,108,864 string characters across the retained document and pages. Structural-token preflight also accumulates across members before parsing. The archive envelope admits multi-page design documents beyond the standalone-input limits while bounding encoded storage and decoded complexity separately; it is not a process-memory guarantee. ZIP member counts, total uncompressed bytes, compression ratios, page counts, and derived measurement/export/flow work retain their independent limits. A completed read does not guarantee that later work fits those budgets. An input rejected by a budget has not completed content auditing; do not classify it as a business-design defect or increase limits just to obtain a passing report.

Offline re-baking computes a layout candidate. Native save/readback and the offline archive comparison establish whether that candidate has zero unexpected drift. Offline tests use synthetic archives and simulated MCP/export services; they do not establish fidelity for an arbitrary live Sketch document.

Whole-document offline auditing permits at most 1,000,000 symbol-expansion visits and 8,192 flow records. These bound repeated reference and prototype inspection without creating native measurement or render jobs. Exceeding either returns `AUDIT-WORK-BUDGET-EXCEEDED`; archive input rejection remains `ARCHIVE-ZIP-BUDGET-EXCEEDED`. CoreText and export retain their smaller operation-specific budgets.

Layout simulation and writeback share the Freeform overlap-band calculation. Writeback applies all measured target heights against one geometry snapshot, reflows affected groups from children to parents once, and synchronizes HotSpots against the final geometry. Explicit audit baselines (`--manifest` and `--source-sketch`) must be available; a missing baseline blocks acceptance.

Separate all `.sketch` work into two strictly decoupled execution tiers:

### Tier 1: Offline High-Concurrency Pipeline (Multi-Agent Parallel)

All operations that do not touch the live Sketch application window or MCP socket may run concurrently across multiple workers or subagents:

1. **Archive Synthesis and Mutation**: Read and write `.sketch` ZIP archives (`document.json`, `pages/*.json`, `meta.json`) directly in Python or Swift.
2. **Native CoreText Line-Break Measurement and Re-Baking**: Run [`scripts/coretext_measure.py`](scripts/coretext_measure.py) (backed by [`scripts/measure-coretext.swift`](scripts/measure-coretext.swift)) to compute exact macOS `CoreText` line breaks (`CTTypesetterSuggestLineBreak` / `CTFramesetter`) and re-bake `MSImmutableFlexGroupLayout` vertical coordinates with `0 px` drift.
3. **Sub-Second Offline Structural and Invariant Audit**: Run [`scripts/sketch_offline_audit.py`](scripts/sketch_offline_audit.py) to validate archive integrity, reference closure, font hygiene, Flex Stack bounds, 2px Focus Ring clipping, and prototype `flow` graphs in under `1s`.
4. **Sandbox-Free Batch Export and Manifest Verification**: Run [`scripts/sketch_export_manifest.py`](scripts/sketch_export_manifest.py) wrapping `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` with full system font access (`/System/Library/AssetsV2/.../PingFang.ttc`) to export `1x`/`2x` PNGs, lossless WebP files, and layer PDFs.

### Tier 2: Single-Slot Batch Native Sketch MCP Verification (Serialized)

Sketch's built-in MCP server (`http://localhost:31126/mcp`) runs inside the single macOS `Sketch.app` process. Only **1 process at a time** may operate a working document in the MCP slot:

- **Prepared execution**: Prepare all edits and assertions before acquiring the MCP slot, then execute [`scripts/sketch_mcp_roundtrip.py`](scripts/sketch_mcp_roundtrip.py) as one batch. Completion depends on native callbacks and verified closure; a timeout or elapsed slot target does not release ownership.
- **Disposable copy isolation**: Always run MCP roundtrip checks against a disposable copy (`<disposable-copy.sketch>`) when verifying persistence and layout stability.
- **Unknown outcome retention**: The tool records the operation ID, exact working-copy path, stage, and confirmed save receipt in a private `operation.json`. A failed report's `recovery` field names retained materials. After an edit, save, open, or close has an unknown outcome, preserve that operation and document; do not rerun the command, close it speculatively, or remove its directory. Resolve the original callback/result and exact document identity before continuing recovery. A changed file or an absent waiting process alone is insufficient. Successful verified roundtrips remove their private working copies; failed verification retains them for diagnosis.
  A failed report keeps the original MCP `failureResponse` even when safe pre-edit cleanup removes the private copies. A cleanup MCP failure is recorded separately as `closeFailureResponse`. On macOS, screenshot file paths are bounded by the platform's user temporary directory, independently of a caller's custom `TMPDIR`; ownership, no-link reads, and byte limits still apply.

## Five Non-Negotiable Iron Rules

### Rule 1: Background Non-Activating Launch and Persistent Anchor Document

- **Never steal desktop focus**: Never invoke `open -a Sketch <path>`, which activates the Sketch window and interrupts the user's foreground workspace. Always launch or open documents in the background without activation:

  ```bash
  open -g -a /Applications/Sketch.app <path-to-file.sketch>
  ```

- **Keep the persistent anchor `.sketch` alive**: When Sketch closes its last open document window, the built-in MCP HTTP endpoint (`http://localhost:31126/mcp`) may stop responding. Maintain a lightweight persistent background anchor document (`--anchor-id <UUID>`).
- **Slot hygiene**: Any script calling `doc.close()` must never close the anchor document. Before acquiring the MCP slot and immediately after releasing it, verify that open documents excluding the anchor match `matching: []`.

### Rule 2: JSC Bridge Memory Safety (Zero Recursive `layer.layers` Traversal)

- **Why Sketch crashes into Safe Mode**: In large `.sketch` documents (dozens of pages, thousands of artboards, tens of thousands of layers), recursively walking `layer.layers` inside MCP `run_code` JavaScript instantiates tens of thousands of Objective-C to JavaScriptCore wrapper objects in a single turn, freezing Sketch for `30–60s` or crashing it into **Safe Mode**.
- **Forbidden in JS `run_code`**: Never recursively traverse `layer.layers` across a document or page in `run_code`.
- **Permitted in JS `run_code`**:
  1. Read top-level document and page counts only: `doc.id`, `doc.pages.length`, per-page top-level `page.layers.length`, `doc.swatches.length`, `doc.sharedTextStyles.length`, and `doc.sharedLayerStyles.length`.
  2. Locate `1–3` target layers by known UUID on a known page (or via `sketch.find('#<uuid>', targetPage)`), apply targeted property/override/focus-border mutations, and call `doc.processPendingChanges()`. Submit one save for the bound working-copy path and wait for its matching completion receipt.
  3. After confirmed successful saving, rebind the live document through the exact copy path, capture targeted screenshots via `get_screenshot` with `targetDocumentID` and `layerID`, and close that document once. Verify closure before offline diffing or reopening.
- **Offline Full-Document Diffing**: Compare `frame` coordinates, `MSImmutableFlexGroupLayout` stacks, `HotSpot` layers, prototype `flow` links, and font descriptors in Python via `zipfile` after saving and closure are confirmed. A successful save callback alone does not prove persisted mutation, screenshot equality, or absence of unexpected drift; verify those on the saved archive and after reopening.
  The native save can assign a new document ID. The roundtrip binds that ID through the successful receipt, the exact-path live probe, and the saved archive before aligning only the document root identity for comparison. The report retains both IDs. Other document facts, including color space and layer attributes, remain strict drift checks; standalone archive comparisons do not assume a save identity transition.

### Rule 3: CoreText Line-Height Parity (`0 px` `NATIVE-LAYOUT-HOTSPOT-DESYNC`)

- **Root cause of `NATIVE-LAYOUT-HOTSPOT-DESYNC`**: When offline generators estimate multi-line text height from character counts, Sketch's native `doc.processPendingChanges()` + `doc.save()` recalculates every `textBehaviour == 1` (fixed-width, auto-height) text layer and enclosing `MSImmutableFlexGroupLayout` (Flex Stack) container using macOS `CoreText`. A 1-line discrepancy (for example `28px`) shifts subsequent Flex Stack children vertically while leaving top-level Freeform `HotSpot` layers at their old `y` coordinates, desynchronizing hit targets from visible buttons.
- **Mandatory CoreText measurement**: Every fixed-width text layer (`textBehaviour == 1`) and auto-height `SymbolInstance` text override must be measured or verified with [`scripts/coretext_measure.py`](scripts/coretext_measure.py) (which invokes native macOS `CoreText` `CTTypesetterSuggestLineBreak` / `CTFramesetter` in [`scripts/measure-coretext.swift`](scripts/measure-coretext.swift)) so offline `frame.height` and Flex Stack coordinates have **`0 px` error** against native `doc.save()`.

### Rule 4: Font Hygiene and Native System UI Clock Font (`CTFontRegularUsage`)

- **Zero cross-platform sample residue**: `.sketch` shared styles, symbol masters, layers, and overrides must contain **`0` `Noto*` fonts**, **`0` hardcoded `SFPro*` font names**, and **`0` `Type/Platform sample/*` styles**.
- **Status bar clock font descriptor**: iOS and Mini Program status bar time layers (such as `"9:41"`) must never hardcode `"name": "SFProText-Regular"` (which triggers missing-font warnings or fallback). Always write Sketch's native system UI font descriptor inside `MSFontDescriptor.attributes`:

  ```json
  {
    "NSCTFontUIUsageAttribute": "CTFontRegularUsage",
    "size": 14
  }
  ```

- **PDF font subset verification**: Verify system clock layers with `sketchtool export layers --formats=pdf` (automated by [`scripts/sketch_export_manifest.py`](scripts/sketch_export_manifest.py) `--verify-clock-pdf`) and confirm the embedded font subset is `.SFNS-Regular` with `/Subtype /TrueType`.

### Rule 5: Unsandboxed System Font Access for `sketchtool` (`PingFang SC` Integrity)

- When `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` runs inside a sandbox that blocks read access to `/System/Library/AssetsV2/com_apple_MobileAsset_Font7/` (or `/System/Library/AssetsV2/.../PingFang.ttc`), macOS silently falls back from `PingFang SC` to `Heiti SC`, causing exported PNGs to diverge pixel-for-pixel from live Sketch MCP `get_screenshot`.
- Always run `sketchtool` and [`scripts/sketch_export_manifest.py`](scripts/sketch_export_manifest.py) in an environment with read access to `/System/Library/AssetsV2`, and verify alignment against MCP `get_screenshot`.

## Sketch 2026.3 MCP Protocol and Absorbed Official Best Practices

### MCP HTTP Transport Quick Reference

- **Endpoint**: `http://localhost:31126/mcp`
- **Protocol**: JSON-RPC 2.0 over HTTP POST (`initialize` -> `notifications/initialized` -> `tools/call`).
- **Required HTTP Headers**:
  - `Content-Type: application/json`
  - `Accept: application/json, text/event-stream`
  - Pass back `Mcp-Session-Id` when returned by the server on `initialize`.
- **Response Framing**: The endpoint may respond with `application/json` or `text/event-stream` (`data: {...}` SSE lines). Always parse both content types.
- **Complete tool results**: The roundtrip client accepts one JSON object log, including Sketch's single-quoted console representation, or a structured object result. It rejects mixed, duplicate, or conflicting result blocks rather than extracting a success fragment. Screenshots may be inline PNG data or the documented temporary-file message; the client validates the complete response and reads only bounded, regular, current-user-owned PNG files under the system temporary directory without following links. PNG framing checks do not replace visual inspection of the captured image.

### Built-In Sketch 2026.3 MCP Tools

| Tool Name | Key Arguments | Purpose and Safety Rules |
| :-- | :-- | :-- |
| `get_document_info` | `document_id` (optional) | Read pages, library metadata, and document structure without custom JS. |
| `get_layer_tree_summary` | `page_id` or `artboard_id`, `depth` (`1..10`, default `3`) | Inspect bounded layer hierarchy natively without creating JSC wrapper storms. |
| `get_design_assets` | `asset_types` (`colorVariables`, `textStyles`, `layerStyles`, `symbols`) | Inspect local and library tokens/styles before creating duplicates. |
| `get_symbol_overrides` | `layer_id` | Inspect override slots and `commonOverrideIDPrefix` on a `SymbolInstance`. |
| `get_screenshot` | `targetDocumentID`, `layerID` | Render live canvas PNG for the explicitly bound document and layer. |
| `run_code` | `{"title": "...", "script": "..."}` | Execute JS in Sketch context. Parameter key is **`script`** (never `code`). Return JSON via `console.log(JSON.stringify(...))`. |

### `run_code` Parser and Execution Rules (from Sketch 2026.3 `MCPGuides` & `sketch-hq/agents`)

1. **Use `"script"`, never `"code"`**: The `run_code` tool schema requires `{"title": "...", "script": "..."}`.
2. **Multiline JS only (`llm-script.js` parser constraint)**: Never submit minified single-line scripts; Sketch's `llm-script.js` wrapper throws `SyntaxError: Parser error` on dense one-liners. Format scripts across multiple lines with no comments (`//` or `/* */`) and no duplicate `function` declarations in the same scope.
3. **Deferred propagation (`doc.processPendingChanges()`)**: In Sketch 2026.2+, changes to Color Variables (`Swatch`), Shared Styles, Symbol overrides, Flex Stacks, and concentric corners (`layer.style.corners.concentric = true`) propagate lazily. Always call `doc.processPendingChanges()` before reading post-mutation frames, calling `get_screenshot`, or calling `doc.save()`.
4. **Confirmed asynchronous saving**: Call the [official save API](https://developer.sketch.com/reference/api/#save-the-document) once with the explicit working-copy path, intended `Document.SaveMode`, and callback. Only the callback emits the operation ID, observed path, document ID, and success/error receipt; returning from `save()` is not completion. The SDK manages its asynchronous lifetime. Do not add unconditional `fiber.cleanup()`. For a separately owned fiber, verify a usable handle and release it at most once. Preserve callback, transport, script, and cleanup errors separately; none authorizes another save.
5. **Reversed Stack (`MSImmutableFlexGroupLayout` / `stackLayout`) child index order**:
   - In Sketch Stacks, main-axis visual order is the **reverse** of the `parent.layers` array index: the highest index (`layers.length - 1`) is packed **first** (Leftmost in Horizontal/Row stacks, Topmost in Vertical/Column stacks), and index `0` is packed **last** (Rightmost in Row, Bottommost in Column).
   - Never assign `parent.layers = [...]` to reorder or reparent children (which deletes layers or crashes with duplicate IDs). Reorder with `layer.index = targetIndex` followed by `parent.stackLayout.apply()`, and reparent with `child.parent = newParent`.
6. **Symbol Overrides via `commonOverrideIDPrefix`**:
   - Override IDs follow `<nested-instance-id>/.../<affected-layer-id>_<property>` (`stringValue`, `symbolID`, `layerStyle`, `textStyle`, `image`, `color:fill-0`). Resolve via `commonOverrideIDPrefix + '_' + property`, and set `imageResizeBehavior = 2` (Fit) on image overrides.
7. **Fidelity Spec and Region Gate (absorbed from `sketch-hq/agents`)**:
   - Build and verify complex artboards outside-in by region (`status-bar -> nav-header -> hero/cards -> form/list -> bottom-bar/tab-bar -> overlays/hotspots`).
   - Evaluate visual diffs in strict priority order: `missing region -> wrong structure/order -> missing/wrong copy -> spacing/sizing -> typography/color -> assets`.

## Companion Script Toolkit

All scripts support `--help`, emit structured JSON output, and exit `0` on pass or non-`0` when blocking findings or errors occur.

### 1. Native CoreText Measurement & Flex Stack Re-Baker

- **Swift CLI**: [`scripts/measure-coretext.swift`](scripts/measure-coretext.swift)
- **Python CLI & `.sketch` Re-Baker**: [`scripts/coretext_measure.py`](scripts/coretext_measure.py)

Measure a batch of text specs directly:

```bash
python3 delivery/skills/sketch-native/scripts/coretext_measure.py \
  --input specs.json \
  --output measured.json
```

Audit all `textBehaviour == 1` text layers and auto-height `SymbolInstance` text overrides in a `.sketch` file and re-bake enclosing `MSImmutableFlexGroupLayout` containers and top-level Freeform `HotSpot` coordinates in place:

```bash
python3 delivery/skills/sketch-native/scripts/coretext_measure.py \
  --sketch design.sketch \
  --rebake \
  --output coretext-report.json
```

### 2. Sub-Second Offline Structural & Invariant Auditor

- **Script**: [`scripts/sketch_offline_audit.py`](scripts/sketch_offline_audit.py)

Audit ZIP integrity, `do_objectID` uniqueness, reference integrity (`symbolID`, `sharedStyleID`, `swatchID`, `MSImageData`, `overrideValues`), font hygiene (`0` `Noto*`, `0` hardcoded `SFPro*`, `0` `Type/Platform sample/*`, `CTFontRegularUsage` on status bar clocks), `MSImmutableFlexGroupLayout` closure, `2px` Focus Ring `clippingBehavior == 0` and bounds, and prototype `flow` graph rules (including `isFlowHome: true` or in-degree `0` start artboard `"back"` dead-button detection, `>= 44x44` hit targets, and Freeform `HotSpot` alignment):

```bash
python3 delivery/skills/sketch-native/scripts/sketch_offline_audit.py \
  --sketch design.sketch \
  --output audit-report.json
```

### 3. 5-Second Non-Activating Sketch MCP Roundtrip Verifier

- **Script**: [`scripts/sketch_mcp_roundtrip.py`](scripts/sketch_mcp_roundtrip.py)

Execute the 6-step non-activating roundtrip against a disposable `.sketch` copy while protecting the persistent anchor document:

```bash
python3 delivery/skills/sketch-native/scripts/sketch_mcp_roundtrip.py \
  --sketch "$TASK_TEMP_DIR/disposable-copy.sketch" \
  --anchor-id 00000000-0000-0000-0000-000000000001 \
  --edit-spec edit-spec.json \
  --screenshots-dir "$TASK_TEMP_DIR/roundtrip-screenshots" \
  --output "$TASK_TEMP_DIR/roundtrip-report.json"
```

### 4. Unsandboxed Batch Export & Manifest / PDF Font Verifier

- **Script**: [`scripts/sketch_export_manifest.py`](scripts/sketch_export_manifest.py)

Export `1x`/`2x` PNGs, lossless WebP files, and status-bar clock layer PDFs (verifying `.SFNS-Regular` `/Subtype /TrueType`), compute dimensions and SHA-256 digests, and synchronize or verify `manifest.json` / `renders.json`:

```bash
python3 delivery/skills/sketch-native/scripts/sketch_export_manifest.py \
  --sketch design.sketch \
  --output-dir exports/ \
  --manifest exports/manifest.json \
  --renders exports/renders.json \
  --scales 1,2 \
  --webp \
  --verify-clock-pdf \
  --output export-report.json
```
