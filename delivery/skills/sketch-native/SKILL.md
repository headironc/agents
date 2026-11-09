---
name: sketch-native
description: Create, edit, inspect, prototype, and visually verify macOS native .sketch documents in Sketch 2026.3 and later through Sketch's built-in MCP server, library components, Stacks, Color Variables, and screenshot-verified critique. Use when designing, updating, or reviewing .sketch files or Sketch MCP workflows.
metadata:
  short-description: Native Sketch 2026.3+ MCP workflow with libraries, Stacks, symbols, and visual verification
---

# Sketch Native Workflow (`sketch-native`)

This shared macOS skill routes `.sketch` design work through Sketch 2026.3+ and its built-in MCP server. The same skill directory is delivered to Codex, DeepSeek Harness, and Antigravity CLI on macOS; other platforms skip installation. Installing this skill does not register MCP servers or modify Sketch preferences.

## Load Sketch's Built-In MCP Guides First

Sketch 2026.3+ ships authoritative operational and API documentation inside the application bundle and exposes it through the `get_guide` MCP tool. Do not copy API handbooks into the repository or synthesize `.sketch` ZIP/JSON archives offline by hand.

1. Before calling any Sketch MCP tool, call `get_guide` with `topic: "mcp"`.
2. Before inspecting, creating, styling, laying out, exporting, or wiring prototypes in a document, call `get_guide` with `topic: "use"`.
3. Load specialized subtopics on demand through `get_guide`:
   - `topic: "layout"` for `Group.Frame`, `StackLayout` (`Direction`, `JustifyContent`, `AlignItems`, `gap`, `padding`, reversed child-index packing), `FlexSizing` (`Fixed`, `Fit`, `Fill`, `Relative`), `preservesSpaceWhenHidden`, and constraints.
   - `topic: "styling"` for `document.processPendingChanges()`, Color Variables (`Swatch`), Shared Layer/Text Styles, `Oklab`/`Oklch` gradients, per-side borders (`border.sides`), smooth and concentric corners (`CornerStyle.Smooth`, `corners.concentric`), `Glass` and progressive blurs, `Fade` (`progressiveAlpha`), and container `tint`.
   - `topic: "symbols"` for `SymbolMaster`, `SymbolInstance`, `get_symbol_overrides`, `commonOverrideIDPrefix`, `overridesForExpandedLayer`, `swatchValue`, image resize behavior, and `flowDestination`.
   - `topic: "prototyping"` for `layer.flow`, `sketch.Flow.BackTarget` (`targetId: 'back'`), `flow.isValidConnection()`, `flowStartPoint`, and `sketch.HotSpot`.
   - `topic: "assets"` for `sketch.export`, SVG import (`sketch.createLayerFromData`), and `sketch.Image`.
   - `topic: "troubleshooting"` before retrying any failed `run_code`, bridge call, or screenshot capture.

## Bind the Task and Module File Organization

Read project instructions, authoritative requirements, approved references, and the target `.sketch` document before editing. Organize `.sketch` deliverables by cohesive functional module (`design/current/<domain>/<module>.sketch`) rather than splitting individual actions or dialogs into micro-files. Inside each module document, organize related sub-flows across Sketch Pages and keep all reusable Symbol Sources on the dedicated `Symbols` page (`sketch.Page.getSymbolsPage(document)`).

When the task runs under Codex model routing, use `gpt-6.1-sol` at `medium` effort (`high` only for complex multi-state layout constraints) for initial page, component, and Stack hierarchy composition, `gpt-6.1-sol` or `gpt-6-luna` at `low` effort for incremental `run_code` property or override refinements, and `gpt-6.1-terra` at `low` effort for pixel-based screenshot inspection.

## Reuse Libraries, Components, Tokens, and Stacks

Follow Sketch's native design-system hierarchy rather than drawing ad hoc rectangles and manual coordinates:

1. **Discover Libraries and Assets First**: Call `get_libraries` and `get_design_assets` (`symbol`, `swatch`, `textStyle`, `layerStyle`, `frameTemplate`, `graphicTemplate`) before creating new UI structures. Import and assign library references on the same statement as instructed by `get_guide`.
2. **Use `Group.Frame` and `StackLayout`**: Model screens, cards, lists, form groups, toolbars, and dialogs as `sketch.Group.Frame` containers with `stackLayout` (`Column` or `Row`) and `FlexSizing` (`Fill` / `Fit` / `Fixed`). Remember Sketch's stack packing order (`parent.layers` highest index is placed first at the top or left) and call `stackLayout.apply()` after structural edits.
3. **Use Native Borders, Corners, and Color Variables**: Use `border.sides` (such as `{ top: 0, right: 0, bottom: 1, left: 0 }`) instead of 1 px divider rectangles. Use `CornerStyle.Smooth` or `corners.concentric = true` for nested containers. Link fills, borders, text (`textSwatch`), and container `tint` to `Swatch` Color Variables and Shared Styles, then call `document.processPendingChanges()`.
4. **Factor Repeated UI into Symbols**: When a structure repeats across two or more states or screens (navigation bars, tab bars, list rows, key-value rows, buttons, session cards, dialogs), create or reuse a `SymbolMaster` (`sketch.SymbolMaster.fromFrame(frame)`) on the `Symbols` page, place `SymbolInstance` layers on working pages, and populate values via `get_symbol_overrides` and `commonOverrideIDPrefix`.
5. **Wire Clean Prototypes**: Set `flowStartPoint = true` on primary entry frames, connect interactive components or `HotSpot` layers with `layer.flow` (`44x44` pt minimum hit target), use `sketch.Flow.BackTarget` (`'back'`) for back buttons and dialog cancellation, and verify links with `flow.isValidConnection()`.

## Execute Incremental Edits and Visual Acceptance

Follow the `mcp` guide's Golden Rule: one `run_code` call performs one small, observable action using only the public `require('sketch')` JavaScript API, ending with a single-line `console.log(JSON.stringify({ ok: true, ... }))`. Never call Objective-C internals, `sketchObject`, undocumented bridges, or offline ZIP/JSON archive mutators.

After every appearance-changing batch, capture the affected frame or layer with `get_screenshot` and inspect the actual pixels at reading scale:

- Verify visual hierarchy, alignment, spacing rhythm, unclipped typography, and enclosed dialog/card boundaries.
- Confirm that Light and Dark variants and required device widths share the same structural shell, persona data, and component tokens.
- If a screenshot reveals a visual or layout defect, apply a targeted `run_code` fix and re-capture `get_screenshot` before reporting completion.
