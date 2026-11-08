# `.sketch` Archive JSON & Sketch 2026.3 Native Schema Reference

This reference documents the exact JSON schema structures inside macOS native `.sketch` ZIP archives (`Sketch 2026.3+`) alongside their live JavaScript API counterparts in Sketch's built-in MCP server (`http://localhost:31126/mcp`).

---

## 1. Archive Topology

A `.sketch` file is a standard ZIP archive containing:

- `document.json`: Root `MSImmutableDocumentData` (`do_objectID`, `assets`, `layerStyles`, `layerTextStyles`, `sharedSwatches`, `foreignSymbols`, `foreignLayerStyles`, `foreignTextStyles`, `foreignSwatches`, `pages` references).
- `meta.json`: `commit`, `version` (Sketch 2026.3 uses document version `164+`), `app` (`com.bohemiancoding.sketch3`), `appVersion` (`2026.3.1`), `build` (`234013`), `pagesAndArtboards` index.
- `user.json`: Viewport scroll/zoom states per page and UI metadata.
- `pages/<page-uuid>.json`: `page` root containing legacy `artboard` layers, modern Frame/Graphic `group` layers, symbol masters, and ordinary layers.
- `images/<sha1-or-id>.<ext>`: Embedded bitmap assets referenced by `MSImageData`.
- `previews/preview.png`: QuickLook preview image.

Every serialized model object carries:

- `"_class"`: Sketch immutable/archive class name (`"page"`, `"artboard"`, `"symbolMaster"`, `"symbolInstance"`, `"group"`, `"text"`, `"rectangle"`, `"shapePath"`, `"oval"`, `"slice"`, `"MSImmutableHotspotLayer"`).
- `"do_objectID"`: Globally unique UUID string across the entire `.sketch` archive.

### Frame and Graphic Identity

Modern Frames and Graphics serialize as `_class: "group"` with `groupBehavior: 1` (Frame) or `2` (Graphic); `0` is a regular group. The numeric mapping is defined by `GroupBehavior` in Sketch's bundled `SketchAPI_dom.js`. A Frame or Graphic directly under a `page` is an artboard-equivalent screen root. A nested Frame or Graphic remains part of its enclosing screen and retains its local coordinate offset. `symbolMaster` remains a separate reusable definition.

The [Sketch 2025.1 migration guide](https://developer.sketch.com/plugins/updates/new-in-sketch-20251) explains this distinction: the live API reports top-level Frames and Graphics as `Artboard` for compatibility, while nested containers report `Group`. Do not infer archive class names from live API type names or treat every `groupBehavior` container as a new screen. The offline tools share this rule through [`sketch_layers.py`](../scripts/sketch_layers.py).

---

## 2. Flex Stack Layout (`MSImmutableFlexGroupLayout` & `MSImmutableFlexItem`)

### 2.1 Group / Frame `groupLayout` (`MSImmutableFlexGroupLayout`)

When a `group`, `artboard`, or `symbolMaster` uses Sketch Stack (Flex) layout, its `groupLayout` field has `"_class": "MSImmutableFlexGroupLayout"`:

```json
{
  "_class": "group",
  "do_objectID": "2A7F8A10-1111-4222-8333-444455556666",
  "name": "CardStack",
  "clippingBehavior": 0,
  "frame": {
    "_class": "rect",
    "constrainProportions": false,
    "height": 184,
    "width": 343,
    "x": 16,
    "y": 112
  },
  "groupLayout": {
    "_class": "MSImmutableFlexGroupLayout",
    "do_objectID": "2A7F8A10-1111-4222-8333-444455556667",
    "flexDirection": 1,
    "justifyContent": 0,
    "alignItems": 0,
    "alignContent": 0,
    "flexWrap": 0,
    "allGuttersGap": 12,
    "crossAxisGutterGap": 0,
    "hasIndividualPadding": false,
    "padding": 16,
    "topPadding": 16,
    "rightPadding": 16,
    "bottomPadding": 16,
    "leftPadding": 16,
    "horizontalSizing": 0,
    "verticalSizing": 1,
    "stackingOrder": 0
  },
  "layers": []
}
```

### 2.2 Key Enumerations for `MSImmutableFlexGroupLayout`

| Property | Archive Integer / Value | Live JS API (`Group.StackLayout`) | Meaning |
| :-- | :-- | :-- | :-- |
| `flexDirection` | `0` | `Direction.Row` | Horizontal stack (left-to-right visual flow). |
| `flexDirection` | `1` | `Direction.Column` | Vertical stack (top-to-bottom visual flow). |
| `justifyContent` | `0` | `JustifyContent.Start` | Pack children toward start of main axis. |
| `justifyContent` | `1` | `JustifyContent.Center` | Pack children around center of main axis. |
| `justifyContent` | `2` | `JustifyContent.End` | Pack children toward end of main axis. |
| `justifyContent` | `3` | `JustifyContent.SpaceBetween` | Distribute remaining space evenly between children (`gap` ignored). |
| `justifyContent` | `4` | `JustifyContent.SpaceAround` | Distribute space around children. |
| `justifyContent` | `5` | `JustifyContent.SpaceEvenly` | Distribute equal space before, between, and after children. |
| `alignItems` | `0` | `AlignItems.Start` | Cross-axis start alignment. |
| `alignItems` | `1` | `AlignItems.Center` | Cross-axis center alignment. |
| `alignItems` | `2` | `AlignItems.End` | Cross-axis end alignment. |
| `alignItems` | `3` | `AlignItems.Stretch` | Stretch cross-axis to fill container inner width/height. |
| `horizontalSizing` / `verticalSizing` | `0` | `FlexSizing.Fixed` | Fixed pixel width/height. |
| `horizontalSizing` / `verticalSizing` | `1` | `FlexSizing.Fit` | Shrink-wrap (`Fit`) to children + padding + gaps. |
| `horizontalSizing` / `verticalSizing` | `2` | `FlexSizing.Fill` | Fill available parent Stack space (`100%`). |
| `horizontalSizing` / `verticalSizing` | `3` | `FlexSizing.Relative` | Percentage of parent (`percentageSize`). |
| `stackingOrder` | `0` / `1` | `StackingOrder.FirstOnTop` / `LastOnTop` | Z-order overlap painting only; does **not** change main-axis position. |

### 2.3 Reversed `layers` Index Packing Order (Critical Invariant)

In Sketch's `layers` array (where index `0` is backmost in the layer list and `layers.length - 1` is frontmost at the top of the layer list):

- **Main-axis packing order is the reverse of array index**:
  - `layers[layers.length - 1]` (highest index, top of layer list) is placed **first** along the main axis (`x = leftPadding` in Row, `y = topPadding` in Column).
  - `layers[0]` (lowest index, bottom of layer list) is placed **last** along the main axis.
- **Child `flexItem` (`MSImmutableFlexItem`)**:
  - `ignoresStackLayout: true` (or `layer.ignoresStackLayout = true` in JS) pins the child as an absolute overlay inside the stack so it does not consume main-axis flow or gaps.
  - `preserveSpaceWhenHidden: true` reserves layout space when `isVisible == false`.

### 2.4 Focus Ring Clipping Invariant (`clippingBehavior`)

- `clippingBehavior: 0` (and `hasClippingMask: false` on children) means the container does **not** clip overflowing strokes or shadows.
- `clippingBehavior: 1` clips children to the container bounds.
- Any interactive control carrying a `2px` outset Focus Ring (`borderOptions` or focus border with `position: 2` Outside / `thickness: 2`) must have `clippingBehavior == 0` on all ancestor groups up to the artboard, and its outset box (`x - 2`, `y - 2`, `width + 4`, `height + 4` in artboard coordinates) must stay within `[0, 0, artboard.width, artboard.height]`.

---

## 3. Text Layers (`textBehaviour`) & Native CoreText Attributes

### 3.1 `textBehaviour` Modes

```json
{
  "_class": "text",
  "do_objectID": "3B8E9B20-1111-4222-8333-444455556666",
  "name": "BodyCopy",
  "textBehaviour": 1,
  "dontSynchroniseWithSymbol": false,
  "frame": {
    "_class": "rect",
    "constrainProportions": false,
    "height": 44,
    "width": 311,
    "x": 16,
    "y": 52
  },
  "attributedString": {
    "_class": "attributedString",
    "string": "账户安全验证已开启，请在 5 分钟内完成确认。",
    "attributes": [
      {
        "_class": "stringAttribute",
        "location": 0,
        "length": 23,
        "attributes": {
          "MSAttributedStringFontAttribute": {
            "_class": "fontDescriptor",
            "attributes": {
              "name": "PingFangSC-Regular",
              "size": 15
            }
          },
          "MSAttributedStringColorAttribute": {
            "_class": "color",
            "alpha": 1,
            "blue": 0.16,
            "green": 0.12,
            "red": 0.1,
            "swatchID": "9C112233-4444-4555-8666-777788889999"
          },
          "paragraphStyle": {
            "_class": "paragraphStyle",
            "alignment": 0,
            "maximumLineHeight": 22,
            "minimumLineHeight": 22,
            "paragraphSpacing": 0
          },
          "kerning": 0
        }
      }
    ]
  }
}
```

| `textBehaviour` | Mode Name | Layout Behavior on `doc.processPendingChanges()` + `doc.save()` |
| :-- | :-- | :-- |
| `0` | Auto Width (`FlexibleWidth`) | Single-line / explicit-newline width & height both expand to fit glyphs. |
| `1` | Auto Height (`FixedWidth`) | `frame.width` stays fixed; `frame.height` is recomputed by macOS `CoreText` line wrapping (`sum(lineHeights) + paragraphSpacing`). |
| `2` | Fixed Size (`FixedWidthAndHeight`) | Both `frame.width` and `frame.height` remain fixed as authored. |

---

## 4. Font Hygiene & Native System Clock Font (`CTFontRegularUsage`)

### 4.1 Forbidden Font Patterns

- **Cross-platform sample fonts**: `NotoSans*`, `NotoSerif*`, `Noto*`.
- **Sample shared styles**: `Type/Platform sample/*`.
- **Hardcoded SF Pro PostScript names**: `"SFProText-Regular"`, `"SFProDisplay-Semibold"`, `"SFPro-Regular"`, etc.

### 4.2 Required Native System UI Font Descriptor (`CTFontRegularUsage`)

For iOS / Mini Program status bar clocks (such as `"9:41"`) and native system UI labels, omit `"name"` and specify `"NSCTFontUIUsageAttribute"` inside `MSAttributedStringFontAttribute.attributes`:

```json
{
  "_class": "fontDescriptor",
  "attributes": {
    "NSCTFontUIUsageAttribute": "CTFontRegularUsage",
    "size": 14
  }
}
```

Common `NSCTFontUIUsageAttribute` values supported by macOS `CoreText` and Sketch:

- `"CTFontRegularUsage"` -> `.SFNS-Regular` (`CTFontCreateUIFontForLanguage(.system, size, nil)`)
- `"CTFontEmphasizedUsage"` / `"CTFontMediumUsage"` -> `.SFNS-Medium` / `.SFNS-Semibold` (`CTFontCreateUIFontForLanguage(.emphasizedSystem, size, nil)`)

When exported via `sketchtool export layers --formats=pdf`, a valid system clock layer embeds a TrueType font subset whose `/BaseFont` or `/FontName` contains `.SFNS-Regular` with `/Subtype /TrueType`.

---

## 5. Symbol Instances & `overrideValues` (`MSImmutableOverrideValue`)

### 5.1 Archive JSON Representation

```json
{
  "_class": "symbolInstance",
  "do_objectID": "4C9FAC30-1111-4222-8333-444455556666",
  "name": "PrimaryButton",
  "symbolID": "5D0ABD40-1111-4222-8333-444455556666",
  "verticalSpacing": 0,
  "horizontalSpacing": 0,
  "overrideValues": [
    {
      "_class": "overrideValue",
      "do_objectID": "4C9FAC30-1111-4222-8333-444455556667",
      "overrideName": "6E1BCE50-1111-4222-8333-444455556666_stringValue",
      "value": "立即认证"
    },
    {
      "_class": "overrideValue",
      "do_objectID": "4C9FAC30-1111-4222-8333-444455556668",
      "overrideName": "7F2CDF60-1111-4222-8333-444455556666_color:fill-0",
      "value": {
        "_class": "color",
        "alpha": 1,
        "blue": 0.96,
        "green": 0.42,
        "red": 0.12,
        "swatchID": "9C112233-4444-4555-8666-777788889999"
      }
    }
  ]
}
```

### 5.2 Supported Override Suffixes (`overrideName`)

Every `overrideName` has the path `<nested-instance-do_objectID>/.../<target-layer-do_objectID>_<property>`:

| Suffix | Value Type | Description |
| :-- | :-- | :-- |
| `_stringValue` | `string` | Text content override on a `text` layer inside the Symbol master. |
| `_symbolID` | `string` (`UUID` or `""`) | Nested Symbol swap (`""` hides the nested instance). |
| `_layerStyle` | `string` (`sharedStyleID`) | Shared layer style override. |
| `_textStyle` | `string` (`sharedStyleID`) | Shared text style override. |
| `_image` | `MSImageData` (`_ref: "images/..."`) | Bitmap fill/image override. Set `imageResizeBehavior = 2` (Fit) in live JS. |
| `_color:fill-0` | `MSImmutableColor` (with optional `swatchID`) | Fill color override at index `0`. |
| `_color:border-0` | `MSImmutableColor` (with optional `swatchID`) | Border color override at index `0`. |
| `_textColor` | `MSImmutableColor` | Text color override. |

In Sketch MCP (`get_symbol_overrides`), each slot exposes `commonOverrideIDPrefix` (`<nested-id>/<layer-id>`). Construct override IDs as `${commonOverrideIDPrefix}_${property}` rather than matching by `affectedLayer.name`.

---

## 6. Prototype Flows (`MSImmutableFlowConnection`), `isFlowHome`, & `HotSpot` Layers

### 6.1 `flow` Object on Any Layer or `MSImmutableHotspotLayer`

```json
{
  "_class": "MSImmutableHotspotLayer",
  "do_objectID": "8A3DEF70-1111-4222-8333-444455556666",
  "name": "HotSpot/Submit",
  "isVisible": true,
  "frame": {
    "_class": "rect",
    "constrainProportions": false,
    "height": 48,
    "width": 343,
    "x": 16,
    "y": 680
  },
  "flow": {
    "_class": "MSImmutableFlowConnection",
    "do_objectID": "8A3DEF70-1111-4222-8333-444455556667",
    "destinationArtboardID": "9B4EF080-1111-4222-8333-444455556666",
    "animationType": 0,
    "maintainScrollPosition": false
  }
}
```

### 6.2 Flow Graph Rules and the Start-Artboard `"back"` Trap

1. **Valid `destinationArtboardID` values**:
   - A concrete target artboard `do_objectID` UUID that exists in the document (or imported library).
   - The literal string `"back"` (which pops the runtime navigation history stack in Sketch Prototype Player).
2. **Start-Artboard `"back"` Dead-Button Trap**:
   - An artboard with `"isFlowHome": true` (or `"flowStartPoint": true`), or an artboard with **in-degree `0`** in the prototype flow graph (no other artboard transitions into it), starts with an **empty history stack** when launched in Prototype Player.
   - If a back button or hotspot on that start artboard sets `"destinationArtboardID": "back"`, clicking it in Prototype Player is a no-op (**dead button**).
   - **Mandatory fix**: On any `isFlowHome: true` or in-degree `0` start artboard, back/return navigation must point to the concrete sibling/parent artboard UUID (`"destinationArtboardID": "<target-artboard-uuid>"`) with `"maintainScrollPosition": true`.
3. **Hit Target Size & Freeform HotSpot Alignment**:
   - Every interactive hotspot or flow-bearing layer must meet the minimum touch/click target size (`>= 44x44` pt on mobile; configurable minimum height on desktop).
   - When an artboard places `MSImmutableHotspotLayer` overlays at the top level (Freeform) above a `MSImmutableFlexGroupLayout` stack, each hotspot's artboard-relative `(x, y, width, height)` must align with its underlying Flex button/row after CoreText line-height re-baking (`0 px` vertical desync).

---

## 7. Color Variables (`Swatch` & `swatchID` Bindings)

In `document.json`, shared Color Variables live under `sharedSwatches.objects` (`_class: "swatch"`):

```json
{
  "_class": "swatch",
  "do_objectID": "9C112233-4444-4555-8666-777788889999",
  "name": "Brand/Primary",
  "value": {
    "_class": "color",
    "alpha": 1,
    "blue": 0.96,
    "green": 0.42,
    "red": 0.12
  }
}
```

Any `color` object in fills, borders, shadows, text attributes, or `overrideValues` binds to that Color Variable by embedding `"swatchID": "9C112233-4444-4555-8666-777788889999"`. Every referenced `swatchID` must exist in `document.json` (`sharedSwatches.objects` or `foreignSwatches`).
