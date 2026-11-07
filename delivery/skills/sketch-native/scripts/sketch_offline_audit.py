#!/usr/bin/env python3
"""Sub-second full offline structural, layout, font, and flow auditor for .sketch files.

Performs 5 invariant checks in < 1s using Python zipfile + json:
1. Archive & do_objectID uniqueness across document.json and pages/*.json.
2. Reference integrity: symbolID, sharedStyleID, swatchID, MSImageData, overrideValues.
3. Font hygiene: 0 Noto*, 0 hardcoded SFPro*, 0 Type/Platform sample/*, and
   CTFontRegularUsage on status bar system clock layers (such as "9:41").
4. Flex Stack (MSImmutableFlexGroupLayout) coordinate closure and 2px Focus Ring
   ancestor clippingBehavior == 0 + artboard bounds safety.
5. HotSpot & Flow Graph integrity: UUID vs "back" counts, 0 dangling destinationArtboardID,
   start-artboard (isFlowHome: true or in-degree 0) "back" dead-button trap detection,
   minimum hit target dimensions (>= 44x44), and Freeform HotSpot vs Flex control alignment.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


CLOCK_TEXT_RE = re.compile(r"^\d{1,2}:\d{2}$")
CLOCK_NAME_HINTS = ("status-time", "statusbar/time", "clock", "time", "状态栏时间")


def _new_finding(
    category: str,
    code: str,
    message: str,
    *,
    severity: str = "blocking",
    page_id: Optional[str] = None,
    artboard_id: Optional[str] = None,
    layer_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    item: Dict[str, Any] = {
        "severity": severity,
        "category": category,
        "code": code,
        "message": message,
    }
    if page_id:
        item["pageID"] = page_id
    if artboard_id:
        item["artboardID"] = artboard_id
    if layer_id:
        item["layerID"] = layer_id
    if details:
        item["details"] = details
    return item


def _collect_symbol_layer_ids(master: Dict[str, Any]) -> Set[str]:
    ids: Set[str] = set()

    def walk(node: Dict[str, Any]) -> None:
        oid = node.get("do_objectID")
        if oid:
            ids.add(str(oid))
        for ch in node.get("layers") or []:
            if isinstance(ch, dict):
                walk(ch)

    walk(master)
    return ids


def _is_focus_ring_layer(layer: Dict[str, Any]) -> bool:
    name = str(layer.get("name", "")).lower()
    if "focus" in name or "focus-ring" in name or "focusring" in name or "焦点" in name:
        return True
    style = layer.get("style") or {}
    for border in style.get("borders") or []:
        if not isinstance(border, dict) or not border.get("isEnabled", True):
            continue
        pos = int(border.get("position", 0))
        thickness = float(border.get("thickness", 0.0) or 0.0)
        if pos == 2 and abs(thickness - 2.0) <= 0.5 and ("focus" in name or layer.get("hasFocusRing") is True):
            return True
    return bool(layer.get("hasFocusRing", False))


def _check_flex_group_closure(
    group: Dict[str, Any],
    page_id: str,
    artboard_id: Optional[str],
    findings: List[Dict[str, Any]],
    tolerance: float = 1.5,
) -> None:
    layout = group.get("groupLayout") or {}
    if layout.get("_class") != "MSImmutableFlexGroupLayout":
        return

    g_id = str(group.get("do_objectID", ""))
    g_frame = group.get("frame") or {}
    g_w = float(g_frame.get("width", 0.0))
    g_h = float(g_frame.get("height", 0.0))

    flex_dir = int(layout.get("flexDirection", 1))
    justify = int(layout.get("justifyContent", 0))
    has_ind = bool(layout.get("hasIndividualPadding", False))
    base_pad = float(layout.get("padding", 0.0) or 0.0)
    top_pad = float(layout.get("topPadding", base_pad) if has_ind else base_pad)
    right_pad = float(layout.get("rightPadding", base_pad) if has_ind else base_pad)
    bottom_pad = float(layout.get("bottomPadding", base_pad) if has_ind else base_pad)
    left_pad = float(layout.get("leftPadding", base_pad) if has_ind else base_pad)
    gap = float(layout.get("allGuttersGap", 0.0) or 0.0)
    horiz_sizing = int(layout.get("horizontalSizing", 0))
    vert_sizing = int(layout.get("verticalSizing", 0))

    flow_children = [
        ch
        for ch in (group.get("layers") or [])
        if isinstance(ch, dict)
        and ch.get("isVisible", True)
        and not bool((ch.get("flexItem") or {}).get("ignoresStackLayout", False))
    ]
    if not flow_children:
        return

    visual_children = list(reversed(flow_children))
    if flex_dir == 1 and justify == 0:
        cursor_y = top_pad
        for idx, ch in enumerate(visual_children):
            cf = ch.get("frame") or {}
            cy = float(cf.get("y", 0.0))
            ch_h = float(cf.get("height", 0.0))
            if abs(cy - cursor_y) > tolerance:
                findings.append(
                    _new_finding(
                        "flex_and_focus",
                        "FLEX-CHILD-Y-MISMATCH",
                        f"Flex Column child '{ch.get('name')}' y={cy} does not match expected {cursor_y}",
                        page_id=page_id,
                        artboard_id=artboard_id,
                        layer_id=str(ch.get("do_objectID", "")),
                        details={
                            "stackID": g_id,
                            "actualY": cy,
                            "expectedY": round(cursor_y, 2),
                        },
                    )
                )
            cursor_y += ch_h
            if idx < len(visual_children) - 1:
                cursor_y += gap

        expected_total_h = cursor_y + bottom_pad
        if vert_sizing == 1 and abs(g_h - expected_total_h) > tolerance:
            findings.append(
                _new_finding(
                    "flex_and_focus",
                    "FLEX-CONTAINER-HEIGHT-UNCLOSED",
                    f"Flex Column '{group.get('name')}' height={g_h} does not close around children+padding={expected_total_h}",
                    page_id=page_id,
                    artboard_id=artboard_id,
                    layer_id=g_id,
                    details={
                        "actualHeight": g_h,
                        "expectedHeight": round(expected_total_h, 2),
                    },
                )
            )
    elif flex_dir == 0 and justify == 0:
        cursor_x = left_pad
        for idx, ch in enumerate(visual_children):
            cf = ch.get("frame") or {}
            cx = float(cf.get("x", 0.0))
            ch_w = float(cf.get("width", 0.0))
            if abs(cx - cursor_x) > tolerance:
                findings.append(
                    _new_finding(
                        "flex_and_focus",
                        "FLEX-CHILD-X-MISMATCH",
                        f"Flex Row child '{ch.get('name')}' x={cx} does not match expected {cursor_x}",
                        page_id=page_id,
                        artboard_id=artboard_id,
                        layer_id=str(ch.get("do_objectID", "")),
                        details={
                            "stackID": g_id,
                            "actualX": cx,
                            "expectedX": round(cursor_x, 2),
                        },
                    )
                )
            cursor_x += ch_w
            if idx < len(visual_children) - 1:
                cursor_x += gap

        expected_total_w = cursor_x + right_pad
        if horiz_sizing == 1 and abs(g_w - expected_total_w) > tolerance:
            findings.append(
                _new_finding(
                    "flex_and_focus",
                    "FLEX-CONTAINER-WIDTH-UNCLOSED",
                    f"Flex Row '{group.get('name')}' width={g_w} does not close around children+padding={expected_total_w}",
                    page_id=page_id,
                    artboard_id=artboard_id,
                    layer_id=g_id,
                    details={
                        "actualWidth": g_w,
                        "expectedWidth": round(expected_total_w, 2),
                    },
                )
            )


def run_offline_audit(
    sketch_path: Path,
    manifest_path: Optional[Path] = None,
    source_sketch_path: Optional[Path] = None,
    min_target_width: float = 44.0,
    min_target_height: float = 44.0,
) -> Dict[str, Any]:
    start_ts = time.perf_counter()
    findings: List[Dict[str, Any]] = []

    if not sketch_path.exists():
        raise FileNotFoundError(f".sketch archive does not exist: {sketch_path}")
    if not zipfile.is_zipfile(sketch_path):
        return {
            "tool": "sketch_offline_audit.py",
            "sketch": str(sketch_path),
            "passed": False,
            "elapsedMs": round((time.perf_counter() - start_ts) * 1000.0, 2),
            "blockingCount": 1,
            "findings": [
                _new_finding(
                    "archive_and_ids",
                    "ARCHIVE-NOT-VALID-ZIP",
                    f"File is not a valid ZIP archive: {sketch_path}",
                )
            ],
        }

    with zipfile.ZipFile(sketch_path, "r") as zf:
        bad_member = zf.testzip()
        if bad_member is not None:
            findings.append(
                _new_finding(
                    "archive_and_ids",
                    "ARCHIVE-CORRUPT-MEMBER",
                    f"Corrupt ZIP member detected: {bad_member}",
                )
            )
        namelist = set(zf.namelist())
        for req in ("document.json", "meta.json"):
            if req not in namelist:
                findings.append(
                    _new_finding(
                        "archive_and_ids",
                        "ARCHIVE-MISSING-CORE-JSON",
                        f"Required archive member '{req}' is missing",
                    )
                )

        doc_data = (
            json.loads(zf.read("document.json").decode("utf-8"))
            if "document.json" in namelist
            else {}
        )
        meta_data = (
            json.loads(zf.read("meta.json").decode("utf-8"))
            if "meta.json" in namelist
            else {}
        )
        pages_data: Dict[str, Dict[str, Any]] = {}
        for member in sorted(namelist):
            if member.startswith("pages/") and member.endswith(".json"):
                pages_data[member] = json.loads(zf.read(member).decode("utf-8"))

    # Upstream source .sketch symbol/swatch/style IDs if provided
    upstream_symbol_ids: Set[str] = set()
    upstream_style_ids: Set[str] = set()
    upstream_swatch_ids: Set[str] = set()
    if source_sketch_path and source_sketch_path.exists() and zipfile.is_zipfile(source_sketch_path):
        with zipfile.ZipFile(source_sketch_path, "r") as uzf:
            unamelist = set(uzf.namelist())
            if "document.json" in unamelist:
                udoc = json.loads(uzf.read("document.json").decode("utf-8"))
                for s in (udoc.get("layerStyles") or {}).get("objects") or []:
                    if s.get("do_objectID"):
                        upstream_style_ids.add(str(s["do_objectID"]))
                for s in (udoc.get("layerTextStyles") or {}).get("objects") or []:
                    if s.get("do_objectID"):
                        upstream_style_ids.add(str(s["do_objectID"]))
                for sw in (udoc.get("sharedSwatches") or {}).get("objects") or []:
                    if sw.get("do_objectID"):
                        upstream_swatch_ids.add(str(sw["do_objectID"]))
            for member in unamelist:
                if member.startswith("pages/") and member.endswith(".json"):
                    upage = json.loads(uzf.read(member).decode("utf-8"))

                    def _walk_up(n: Dict[str, Any]) -> None:
                        if n.get("_class") == "symbolMaster" and n.get("symbolID"):
                            upstream_symbol_ids.add(str(n["symbolID"]))
                        for ch in n.get("layers") or []:
                            if isinstance(ch, dict):
                                _walk_up(ch)

                    _walk_up(upage)

    # 1. Collect shared objects from document.json
    shared_style_ids: Set[str] = set(upstream_style_ids)
    swatch_ids: Set[str] = set(upstream_swatch_ids)
    symbol_masters: Dict[str, Dict[str, Any]] = {}
    foreign_symbol_ids: Set[str] = set(upstream_symbol_ids)

    noto_hits: List[Dict[str, Any]] = []
    sfpro_hits: List[Dict[str, Any]] = []
    platform_sample_hits: List[Dict[str, Any]] = []
    clock_font_Checks: List[Dict[str, Any]] = []

    def inspect_font_descriptor(
        font_desc: Dict[str, Any],
        context_label: str,
        page_id: Optional[str] = None,
        artboard_id: Optional[str] = None,
        layer_id: Optional[str] = None,
    ) -> None:
        attrs = font_desc.get("attributes") or {}
        fname = str(attrs.get("name", "") or "")
        if fname.lower().startswith("noto"):
            noto_hits.append(
                {
                    "context": context_label,
                    "fontName": fname,
                    "pageID": page_id,
                    "artboardID": artboard_id,
                    "layerID": layer_id,
                }
            )
            findings.append(
                _new_finding(
                    "font_hygiene",
                    "FONT-FORBIDDEN-NOTO",
                    f"Forbidden Noto* font '{fname}' found in {context_label}",
                    page_id=page_id,
                    artboard_id=artboard_id,
                    layer_id=layer_id,
                )
            )
        if fname.lower().startswith("sfpro") or fname.lower().startswith("sf-pro"):
            sfpro_hits.append(
                {
                    "context": context_label,
                    "fontName": fname,
                    "pageID": page_id,
                    "artboardID": artboard_id,
                    "layerID": layer_id,
                }
            )
            findings.append(
                _new_finding(
                    "font_hygiene",
                    "FONT-HARDCODED-SFPRO",
                    f"Hardcoded SFPro* font '{fname}' in {context_label}; use NSCTFontUIUsageAttribute: CTFontRegularUsage",
                    page_id=page_id,
                    artboard_id=artboard_id,
                    layer_id=layer_id,
                )
            )

    for style_group_key in ("layerStyles", "layerTextStyles"):
        objs = (doc_data.get(style_group_key) or {}).get("objects") or []
        for st in objs:
            if not isinstance(st, dict):
                continue
            sid = st.get("do_objectID")
            if sid:
                shared_style_ids.add(str(sid))
            sname = str(st.get("name", ""))
            if sname.startswith("Type/Platform sample/"):
                platform_sample_hits.append({"styleID": sid, "name": sname})
                findings.append(
                    _new_finding(
                        "font_hygiene",
                        "STYLE-FORBIDDEN-PLATFORM-SAMPLE",
                        f"Forbidden sample shared style '{sname}' ({sid})",
                    )
                )
            val = st.get("value") or {}
            t_style = (val.get("textStyle") or {}).get("encodedAttributes") or {}
            f_desc = t_style.get("MSAttributedStringFontAttribute")
            if isinstance(f_desc, dict):
                inspect_font_descriptor(f_desc, f"sharedStyle:{sname}")

    for f_style_key in ("foreignLayerStyles", "foreignTextStyles"):
        for fst in doc_data.get(f_style_key) or []:
            if isinstance(fst, dict):
                local_st = fst.get("localSharedStyle") or {}
                if local_st.get("do_objectID"):
                    shared_style_ids.add(str(local_st["do_objectID"]))

    for sw in (doc_data.get("sharedSwatches") or {}).get("objects") or []:
        if isinstance(sw, dict) and sw.get("do_objectID"):
            swatch_ids.add(str(sw["do_objectID"]))
    for fsw in doc_data.get("foreignSwatches") or []:
        if isinstance(fsw, dict):
            local_sw = fsw.get("localSwatch") or {}
            if local_sw.get("do_objectID"):
                swatch_ids.add(str(local_sw["do_objectID"]))

    for fsym in doc_data.get("foreignSymbols") or []:
        if isinstance(fsym, dict):
            sm = fsym.get("symbolMaster") or {}
            if sm.get("symbolID"):
                foreign_symbol_ids.add(str(sm["symbolID"]))
            if sm.get("do_objectID"):
                symbol_masters[str(sm.get("symbolID") or sm["do_objectID"])] = sm

    # Pre-index all symbolMasters and artboards across pages
    artboards_by_id: Dict[str, Dict[str, Any]] = {}
    artboard_page_map: Dict[str, str] = {}

    for page_member, page_obj in pages_data.items():
        pid = str(page_obj.get("do_objectID", page_member))

        def pre_walk(node: Dict[str, Any]) -> None:
            cls = node.get("_class")
            if cls == "symbolMaster" and node.get("symbolID"):
                symbol_masters[str(node["symbolID"])] = node
            if cls in ("artboard", "symbolMaster") and node.get("do_objectID"):
                aid = str(node["do_objectID"])
                artboards_by_id[aid] = node
                artboard_page_map[aid] = pid
            for ch in node.get("layers") or []:
                if isinstance(ch, dict):
                    pre_walk(ch)

        pre_walk(page_obj)

    symbol_master_layer_ids: Dict[str, Set[str]] = {
        sym_id: _collect_symbol_layer_ids(master)
        for sym_id, master in symbol_masters.items()
    }

    # Walk all pages for ID uniqueness, references, fonts, Flex stacks, Focus Rings, and Flows
    seen_object_ids: Dict[str, str] = {}
    duplicate_ids: List[Dict[str, str]] = []
    dangling_symbols: List[Dict[str, Any]] = []
    dangling_styles: List[Dict[str, Any]] = []
    dangling_swatches: List[Dict[str, Any]] = []
    dangling_images: List[Dict[str, Any]] = []
    dangling_overrides: List[Dict[str, Any]] = []

    flow_edges: List[Dict[str, Any]] = []
    back_flows: List[Dict[str, Any]] = []
    dangling_flows: List[Dict[str, Any]] = []

    def check_color_obj(
        color_obj: Any,
        page_id: str,
        artboard_id: Optional[str],
        layer_id: str,
    ) -> None:
        if not isinstance(color_obj, dict):
            return
        sw_id = color_obj.get("swatchID")
        if sw_id and str(sw_id) not in swatch_ids:
            dangling_swatches.append(
                {
                    "swatchID": str(sw_id),
                    "pageID": page_id,
                    "artboardID": artboard_id,
                    "layerID": layer_id,
                }
            )
            findings.append(
                _new_finding(
                    "reference_integrity",
                    "REF-DANGLING-SWATCH-ID",
                    f"Dangling swatchID '{sw_id}' on layer {layer_id}",
                    page_id=page_id,
                    artboard_id=artboard_id,
                    layer_id=layer_id,
                )
            )

    def check_image_ref(
        img_obj: Any,
        page_id: str,
        artboard_id: Optional[str],
        layer_id: str,
    ) -> None:
        if not isinstance(img_obj, dict):
            return
        if img_obj.get("_class") == "MSJSONFileReference":
            ref = str(img_obj.get("_ref", ""))
            if ref and ref not in namelist:
                dangling_images.append(
                    {
                        "ref": ref,
                        "pageID": page_id,
                        "artboardID": artboard_id,
                        "layerID": layer_id,
                    }
                )
                findings.append(
                    _new_finding(
                        "reference_integrity",
                        "REF-MISSING-IMAGE-DATA",
                        f"Missing archive image asset '{ref}' referenced by layer {layer_id}",
                        page_id=page_id,
                        artboard_id=artboard_id,
                        layer_id=layer_id,
                    )
                )

    for page_member, page_obj in sorted(pages_data.items()):
        page_id = str(page_obj.get("do_objectID", page_member))

        def walk_layer(
            node: Dict[str, Any],
            artboard: Optional[Dict[str, Any]],
            ancestors: List[Dict[str, Any]],
            abs_x: float,
            abs_y: float,
        ) -> None:
            oid = str(node.get("do_objectID", ""))
            cls = str(node.get("_class", ""))
            loc_tag = f"{page_member}:{cls}:{node.get('name', '')}"
            if oid:
                if oid in seen_object_ids:
                    duplicate_ids.append(
                        {"id": oid, "first": seen_object_ids[oid], "second": loc_tag}
                    )
                    findings.append(
                        _new_finding(
                            "archive_and_ids",
                            "ID-DUPLICATE-OBJECT-ID",
                            f"Duplicate do_objectID '{oid}' at {loc_tag} (first seen at {seen_object_ids[oid]})",
                            page_id=page_id,
                            artboard_id=(artboard or {}).get("do_objectID"),
                            layer_id=oid,
                        )
                    )
                else:
                    seen_object_ids[oid] = loc_tag

            cur_artboard = node if cls in ("artboard", "symbolMaster") else artboard
            aid = str((cur_artboard or {}).get("do_objectID", "")) or None

            frame = node.get("frame") or {}
            nx = float(frame.get("x", 0.0))
            ny = float(frame.get("y", 0.0))
            nw = float(frame.get("width", 0.0))
            nh = float(frame.get("height", 0.0))

            if cls in ("page", "artboard", "symbolMaster"):
                cur_abs_x = 0.0
                cur_abs_y = 0.0
            else:
                cur_abs_x = abs_x + nx
                cur_abs_y = abs_y + ny

            # Shared style reference check
            sh_id = node.get("sharedStyleID")
            if sh_id and str(sh_id) not in shared_style_ids:
                dangling_styles.append(
                    {
                        "sharedStyleID": str(sh_id),
                        "pageID": page_id,
                        "artboardID": aid,
                        "layerID": oid,
                    }
                )
                findings.append(
                    _new_finding(
                        "reference_integrity",
                        "REF-DANGLING-SHARED-STYLE",
                        f"Dangling sharedStyleID '{sh_id}' on layer '{node.get('name')}' ({oid})",
                        page_id=page_id,
                        artboard_id=aid,
                        layer_id=oid,
                    )
                )

            # Style colors & image fills
            style = node.get("style") or {}
            for fill in style.get("fills") or []:
                if isinstance(fill, dict):
                    check_color_obj(fill.get("color"), page_id, aid, oid)
                    check_image_ref(fill.get("image"), page_id, aid, oid)
            for border in style.get("borders") or []:
                if isinstance(border, dict):
                    check_color_obj(border.get("color"), page_id, aid, oid)
            for shadow in style.get("shadows") or []:
                if isinstance(shadow, dict):
                    check_color_obj(shadow.get("color"), page_id, aid, oid)
            if cls == "bitmap":
                check_image_ref(node.get("image"), page_id, aid, oid)

            # SymbolInstance & overrideValues checks
            if cls == "symbolInstance":
                sym_id = str(node.get("symbolID", ""))
                if (
                    not sym_id
                    or (sym_id not in symbol_masters and sym_id not in foreign_symbol_ids)
                ):
                    dangling_symbols.append(
                        {
                            "symbolID": sym_id,
                            "pageID": page_id,
                            "artboardID": aid,
                            "layerID": oid,
                        }
                    )
                    findings.append(
                        _new_finding(
                            "reference_integrity",
                            "REF-DANGLING-SYMBOL-ID",
                            f"SymbolInstance '{node.get('name')}' references missing symbolID '{sym_id}'",
                            page_id=page_id,
                            artboard_id=aid,
                            layer_id=oid,
                        )
                    )
                known_layer_ids = symbol_master_layer_ids.get(sym_id, set())
                for ov in node.get("overrideValues") or []:
                    if not isinstance(ov, dict):
                        continue
                    ov_name = str(ov.get("overrideName", ""))
                    if "_" not in ov_name:
                        dangling_overrides.append(
                            {"overrideName": ov_name, "layerID": oid}
                        )
                        findings.append(
                            _new_finding(
                                "reference_integrity",
                                "REF-INVALID-OVERRIDE-NAME",
                                f"Invalid overrideName '{ov_name}' on SymbolInstance {oid}",
                                page_id=page_id,
                                artboard_id=aid,
                                layer_id=oid,
                            )
                        )
                        continue
                    path_part, prop_part = ov_name.rsplit("_", 1)
                    leaf_layer_id = path_part.split("/")[-1]
                    if known_layer_ids and leaf_layer_id not in known_layer_ids:
                        dangling_overrides.append(
                            {
                                "overrideName": ov_name,
                                "leafLayerID": leaf_layer_id,
                                "symbolID": sym_id,
                                "layerID": oid,
                            }
                        )
                        findings.append(
                            _new_finding(
                                "reference_integrity",
                                "REF-DANGLING-OVERRIDE-PATH",
                                f"Override '{ov_name}' targets non-existent layer '{leaf_layer_id}' in symbolMaster '{sym_id}'",
                                page_id=page_id,
                                artboard_id=aid,
                                layer_id=oid,
                            )
                        )
                    ov_val = ov.get("value")
                    if prop_part == "symbolID" and isinstance(ov_val, str) and ov_val:
                        if (
                            ov_val not in symbol_masters
                            and ov_val not in foreign_symbol_ids
                        ):
                            dangling_overrides.append(
                                {"overrideName": ov_name, "value": ov_val, "layerID": oid}
                            )
                            findings.append(
                                _new_finding(
                                    "reference_integrity",
                                    "REF-DANGLING-OVERRIDE-SYMBOL",
                                    f"Override '{ov_name}' swaps to missing symbolID '{ov_val}'",
                                    page_id=page_id,
                                    artboard_id=aid,
                                    layer_id=oid,
                                )
                            )
                    elif prop_part in ("layerStyle", "textStyle") and isinstance(
                        ov_val, str
                    ) and ov_val:
                        if ov_val not in shared_style_ids:
                            dangling_overrides.append(
                                {"overrideName": ov_name, "value": ov_val, "layerID": oid}
                            )
                            findings.append(
                                _new_finding(
                                    "reference_integrity",
                                    "REF-DANGLING-OVERRIDE-STYLE",
                                    f"Override '{ov_name}' references missing sharedStyleID '{ov_val}'",
                                    page_id=page_id,
                                    artboard_id=aid,
                                    layer_id=oid,
                                )
                            )
                    elif isinstance(ov_val, dict):
                        check_color_obj(ov_val, page_id, aid, oid)
                        check_image_ref(ov_val, page_id, aid, oid)

            # Text font hygiene & status bar clock check
            if cls == "text":
                attr_str = node.get("attributedString") or {}
                txt_content = str(attr_str.get("string", "")).strip()
                lname = str(node.get("name", ""))
                if lname.startswith("Type/Platform sample/"):
                    platform_sample_hits.append({"layerID": oid, "name": lname})
                    findings.append(
                        _new_finding(
                            "font_hygiene",
                            "LAYER-FORBIDDEN-PLATFORM-SAMPLE",
                            f"Forbidden sample text layer name '{lname}'",
                            page_id=page_id,
                            artboard_id=aid,
                            layer_id=oid,
                        )
                    )
                is_clock = bool(CLOCK_TEXT_RE.match(txt_content)) or any(
                    hint in lname.lower() for hint in CLOCK_NAME_HINTS
                )
                for seg in attr_str.get("attributes") or []:
                    if not isinstance(seg, dict):
                        continue
                    s_attrs = seg.get("attributes") or {}
                    f_desc = s_attrs.get("MSAttributedStringFontAttribute")
                    if isinstance(f_desc, dict):
                        inspect_font_descriptor(
                            f_desc, f"text:{lname}", page_id, aid, oid
                        )
                        if is_clock and CLOCK_TEXT_RE.match(txt_content):
                            f_attrs = f_desc.get("attributes") or {}
                            ui_usage = f_attrs.get("NSCTFontUIUsageAttribute")
                            hard_name = f_attrs.get("name")
                            clock_ok = (
                                ui_usage == "CTFontRegularUsage" and not hard_name
                            )
                            clock_font_Checks.append(
                                {
                                    "layerID": oid,
                                    "name": lname,
                                    "text": txt_content,
                                    "uiUsage": ui_usage,
                                    "fontName": hard_name,
                                    "valid": clock_ok,
                                }
                            )
                            if not clock_ok:
                                findings.append(
                                    _new_finding(
                                        "font_hygiene",
                                        "CLOCK-MISSING-CTFONT-REGULAR-USAGE",
                                        f"Status bar clock '{txt_content}' ({oid}) must use NSCTFontUIUsageAttribute='CTFontRegularUsage' without hardcoded font name",
                                        page_id=page_id,
                                        artboard_id=aid,
                                        layer_id=oid,
                                    )
                                )
                    check_color_obj(
                        s_attrs.get("MSAttributedStringColorAttribute"),
                        page_id,
                        aid,
                        oid,
                    )

            # Flex Stack closure check
            if (node.get("groupLayout") or {}).get(
                "_class"
            ) == "MSImmutableFlexGroupLayout":
                _check_flex_group_closure(node, page_id, aid, findings)

            # 2px Focus Ring clipping & bounds check
            if _is_focus_ring_layer(node) and cur_artboard is not None:
                for anc in ancestors:
                    if anc.get("_class") in ("page", "artboard", "symbolMaster"):
                        continue
                    clip_val = int(anc.get("clippingBehavior", 0) or 0)
                    clips_flag = bool(anc.get("clipsContents", False))
                    if clip_val != 0 or clips_flag:
                        findings.append(
                            _new_finding(
                                "flex_and_focus",
                                "FOCUS-RING-ANCESTOR-CLIPPED",
                                f"Focus ring layer '{node.get('name')}' ({oid}) has clipping ancestor '{anc.get('name')}' (clippingBehavior={clip_val})",
                                page_id=page_id,
                                artboard_id=aid,
                                layer_id=oid,
                                details={"ancestorID": anc.get("do_objectID")},
                            )
                        )
                ab_frame = cur_artboard.get("frame") or {}
                ab_w = float(ab_frame.get("width", 0.0))
                ab_h = float(ab_frame.get("height", 0.0))
                outset = 2.0
                if (
                    cur_abs_x - outset < -0.5
                    or cur_abs_y - outset < -0.5
                    or cur_abs_x + nw + outset > ab_w + 0.5
                    or cur_abs_y + nh + outset > ab_h + 0.5
                ):
                    findings.append(
                        _new_finding(
                            "flex_and_focus",
                            "FOCUS-RING-OUTSIDE-ARTBOARD",
                            f"2px Focus ring on '{node.get('name')}' ({oid}) exceeds artboard bounds [{ab_w}x{ab_h}]",
                            page_id=page_id,
                            artboard_id=aid,
                            layer_id=oid,
                            details={
                                "focusBox": [
                                    cur_abs_x - outset,
                                    cur_abs_y - outset,
                                    nw + 2 * outset,
                                    nh + 2 * outset,
                                ],
                                "artboardSize": [ab_w, ab_h],
                            },
                        )
                    )

            # Flow & HotSpot check
            flow = node.get("flow")
            is_hotspot = cls == "MSImmutableHotspotLayer"
            if isinstance(flow, dict) or is_hotspot:
                if nw < min_target_width - 0.1 or nh < min_target_height - 0.1:
                    findings.append(
                        _new_finding(
                            "flow_and_hotspots",
                            "HOTSPOT-TARGET-TOO-SMALL",
                            f"Interactive target '{node.get('name')}' ({oid}) is {nw}x{nh}, smaller than minimum {min_target_width}x{min_target_height}",
                            page_id=page_id,
                            artboard_id=aid,
                            layer_id=oid,
                            details={"width": nw, "height": nh},
                        )
                    )
            if isinstance(flow, dict):
                dest = str(flow.get("destinationArtboardID", ""))
                maintains_scroll = bool(flow.get("maintainScrollPosition", False))
                if dest == "back":
                    back_flows.append(
                        {
                            "pageID": page_id,
                            "sourceArtboardID": aid,
                            "layerID": oid,
                            "layerName": node.get("name"),
                            "maintainScrollPosition": maintains_scroll,
                        }
                    )
                elif dest:
                    if dest not in artboards_by_id:
                        dangling_flows.append(
                            {
                                "pageID": page_id,
                                "sourceArtboardID": aid,
                                "layerID": oid,
                                "destinationArtboardID": dest,
                            }
                        )
                        findings.append(
                            _new_finding(
                                "flow_and_hotspots",
                                "FLOW-DANGLING-DESTINATION",
                                f"Flow on '{node.get('name')}' ({oid}) targets non-existent destinationArtboardID '{dest}'",
                                page_id=page_id,
                                artboard_id=aid,
                                layer_id=oid,
                            )
                        )
                    else:
                        flow_edges.append(
                            {
                                "pageID": page_id,
                                "sourceArtboardID": aid,
                                "destinationArtboardID": dest,
                                "layerID": oid,
                                "layerName": node.get("name"),
                                "maintainScrollPosition": maintains_scroll,
                            }
                        )

            next_ancestors = ancestors + [node]
            for child in node.get("layers") or []:
                if isinstance(child, dict):
                    walk_layer(child, cur_artboard, next_ancestors, cur_abs_x, cur_abs_y)

        walk_layer(page_obj, None, [], 0.0, 0.0)

        # Check Freeform HotSpot alignment against underlying Flex controls on each artboard
        for top_layer in page_obj.get("layers") or []:
            if not isinstance(top_layer, dict) or top_layer.get("_class") not in (
                "artboard",
                "symbolMaster",
            ):
                continue
            ab_id = str(top_layer.get("do_objectID", ""))
            flex_control_rects: List[Tuple[str, str, float, float, float, float]] = []

            def collect_flex_controls(
                n: Dict[str, Any], ox: float, oy: float, inside_flex: bool
            ) -> None:
                is_flex = (
                    n.get("groupLayout") or {}
                ).get("_class") == "MSImmutableFlexGroupLayout"
                nf = n.get("frame") or {}
                ax = ox + float(nf.get("x", 0.0))
                ay = oy + float(nf.get("y", 0.0))
                aw = float(nf.get("width", 0.0))
                ah = float(nf.get("height", 0.0))
                if inside_flex and n.get("_class") != "MSImmutableHotspotLayer":
                    flex_control_rects.append(
                        (
                            str(n.get("do_objectID", "")),
                            str(n.get("name", "")),
                            ax,
                            ay,
                            aw,
                            ah,
                        )
                    )
                for ch in n.get("layers") or []:
                    if isinstance(ch, dict):
                        collect_flex_controls(ch, ax, ay, inside_flex or is_flex)

            for child in top_layer.get("layers") or []:
                if isinstance(child, dict) and child.get("_class") != "MSImmutableHotspotLayer":
                    collect_flex_controls(child, 0.0, 0.0, False)

            if not flex_control_rects:
                continue

            for child in top_layer.get("layers") or []:
                if (
                    not isinstance(child, dict)
                    or child.get("_class") != "MSImmutableHotspotLayer"
                ):
                    continue
                hf = child.get("frame") or {}
                hx = float(hf.get("x", 0.0))
                hy = float(hf.get("y", 0.0))
                hw = float(hf.get("width", 0.0))
                hh = float(hf.get("height", 0.0))
                target_id = child.get("targetLayerID")
                aligned = False
                for cid, cname, cx, cy, cw, ch_h in flex_control_rects:
                    if target_id and cid != target_id:
                        continue
                    if (
                        abs(hx - cx) <= 2.0
                        and abs(hy - cy) <= 2.0
                        and abs(hw - cw) <= 4.0
                        and abs(hh - ch_h) <= 4.0
                    ):
                        aligned = True
                        break
                if not aligned:
                    findings.append(
                        _new_finding(
                            "flow_and_hotspots",
                            "HOTSPOT-FLEX-DESYNC",
                            f"Top-level Freeform HotSpot '{child.get('name')}' ({child.get('do_objectID')}) at ({hx},{hy},{hw},{hh}) does not align with any Flex control on artboard '{top_layer.get('name')}'",
                            page_id=page_id,
                            artboard_id=ab_id,
                            layer_id=str(child.get("do_objectID", "")),
                        )
                    )

    # Check start-artboard (isFlowHome: true or in-degree 0) "back" dead-button trap
    in_degree: Dict[str, int] = {aid: 0 for aid in artboards_by_id}
    for edge in flow_edges:
        dest_id = edge["destinationArtboardID"]
        if dest_id in in_degree:
            in_degree[dest_id] += 1

    for bf in back_flows:
        src_aid = bf.get("sourceArtboardID")
        if not src_aid or src_aid not in artboards_by_id:
            continue
        ab_node = artboards_by_id[src_aid]
        is_home = bool(
            ab_node.get("isFlowHome", False) or ab_node.get("flowStartPoint", False)
        )
        indeg = in_degree.get(src_aid, 0)
        if is_home or indeg == 0:
            findings.append(
                _new_finding(
                    "flow_and_hotspots",
                    "FLOW-START-ARTBOARD-BACK-TRAP",
                    (
                        f"Layer '{bf.get('layerName')}' ({bf.get('layerID')}) on start artboard "
                        f"'{ab_node.get('name')}' (isFlowHome={is_home}, inDegree={indeg}) uses "
                        f"destinationArtboardID='back' (dead button with empty history stack); "
                        f"must point to sibling artboard UUID with maintainScrollPosition=true"
                    ),
                    page_id=bf.get("pageID"),
                    artboard_id=src_aid,
                    layer_id=bf.get("layerID"),
                )
            )

    # Optional manifest check
    if manifest_path and manifest_path.exists():
        manifest_obj = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected_artboards = manifest_obj.get("artboards") or []
        for exp in expected_artboards:
            exp_id = str(exp.get("id") or exp.get("artboardID") or "")
            if exp_id and exp_id not in artboards_by_id:
                findings.append(
                    _new_finding(
                        "archive_and_ids",
                        "MANIFEST-MISSING-ARTBOARD",
                        f"Artboard '{exp_id}' declared in manifest is missing from .sketch",
                        artboard_id=exp_id,
                    )
                )

    elapsed_ms = round((time.perf_counter() - start_ts) * 1000.0, 2)
    blocking = [f for f in findings if f.get("severity") == "blocking"]

    return {
        "tool": "sketch_offline_audit.py",
        "sketch": str(sketch_path),
        "passed": len(blocking) == 0,
        "elapsedMs": elapsed_ms,
        "blockingCount": len(blocking),
        "summary": {
            "totalObjects": len(seen_object_ids),
            "duplicateObjectIDs": len(duplicate_ids),
            "pagesCount": len(pages_data),
            "artboardsCount": len(artboards_by_id),
            "symbolMastersCount": len(symbol_masters),
            "sharedStylesCount": len(shared_style_ids),
            "swatchesCount": len(swatch_ids),
            "danglingSymbols": len(dangling_symbols),
            "danglingStyles": len(dangling_styles),
            "danglingSwatches": len(dangling_swatches),
            "danglingImages": len(dangling_images),
            "danglingOverrides": len(dangling_overrides),
            "notoFontCount": len(noto_hits),
            "hardcodedSFProCount": len(sfpro_hits),
            "platformSampleStyleCount": len(platform_sample_hits),
            "clockLayersVerified": len(clock_font_Checks),
            "flowDirectUUIDCount": len(flow_edges),
            "flowBackActionCount": len(back_flows),
            "danglingFlowCount": len(dangling_flows),
        },
        "meta": {
            "app": meta_data.get("app"),
            "appVersion": meta_data.get("appVersion"),
            "build": meta_data.get("build"),
            "version": meta_data.get("version"),
        },
        "findings": findings,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sketch_offline_audit.py",
        description=(
            "Sub-second offline structural, reference, font hygiene, Flex Stack, "
            "Focus Ring, and Prototype Flow auditor for macOS .sketch archives."
        ),
    )
    parser.add_argument(
        "--sketch",
        "-s",
        required=True,
        help="Path to the .sketch file to audit.",
    )
    parser.add_argument(
        "--manifest",
        "-m",
        help="Optional manifest.json path to verify expected artboards.",
    )
    parser.add_argument(
        "--source-sketch",
        help="Optional upstream source/library .sketch path for symbol/style/swatch resolution.",
    )
    parser.add_argument(
        "--min-target-width",
        type=float,
        default=44.0,
        help="Minimum interactive HotSpot/Flow width in points (default: 44).",
    )
    parser.add_argument(
        "--min-target-height",
        type=float,
        default=44.0,
        help="Minimum interactive HotSpot/Flow height in points (default: 44).",
    )
    parser.add_argument(
        "--output",
        "-o",
        help="Optional file path to write the structured JSON audit report.",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        report = run_offline_audit(
            sketch_path=Path(args.sketch),
            manifest_path=Path(args.manifest) if args.manifest else None,
            source_sketch_path=Path(args.source_sketch) if args.source_sketch else None,
            min_target_width=args.min_target_width,
            min_target_height=args.min_target_height,
        )
        exit_code = 0 if report.get("passed", False) else 1
    except Exception as exc:
        report = {
            "tool": "sketch_offline_audit.py",
            "sketch": args.sketch,
            "passed": False,
            "error": str(exc),
        }
        exit_code = 2

    out_str = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(out_str + "\n", encoding="utf-8")
    print(out_str)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
