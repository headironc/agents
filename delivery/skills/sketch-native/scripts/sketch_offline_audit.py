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
import os
import re
import stat
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


CLOCK_TEXT_RE = re.compile(r"^\d{1,2}:\d{2}$")
STATUSBAR_CONTEXT_HINTS = (
    "statusbar",
    "status-bar",
    "status_bar",
    "status-time",
    "status time",
    "状态栏",
)


def _is_statusbar_clock_layer(
    txt_content: str,
    layer_name: str,
    ancestor_names: List[str],
    abs_y: float,
) -> bool:
    """Identify iOS/mini-program status-bar system clock layers without misclassifying business HH:mm text."""
    if not CLOCK_TEXT_RE.match(txt_content):
        return False
    lname_low = layer_name.strip().lower()
    chain_low = " / ".join([*[a.lower() for a in ancestor_names], lname_low])
    if any(h in chain_low for h in STATUSBAR_CONTEXT_HINTS):
        return True
    if abs_y <= 44.0 and (
        txt_content in ("9:41", "09:41")
        or lname_low in ("time", "clock", "9:41", "09:41", "时间")
    ):
        return True
    return False


def _validate_existing_output_target(file_path: Path) -> None:
    try:
        st = os.lstat(file_path)
    except FileNotFoundError:
        return
    if stat.S_ISLNK(st.st_mode):
        raise RuntimeError(f"Refusing to write to symlinked file: {file_path}")
    if not stat.S_ISREG(st.st_mode):
        raise RuntimeError(f"Refusing to overwrite non-regular file: {file_path}")
    if hasattr(os, "getuid") and st.st_uid != os.getuid():
        raise RuntimeError(
            f"Refusing to overwrite file not owned by current user: {file_path}"
        )
    if st.st_nlink > 1:
        raise RuntimeError(f"Refusing to overwrite hard-linked file: {file_path}")


def _write_text_nofollow(file_path: Path, text: str, mode: int = 0o600) -> None:
    """Atomically write text to file_path via an exclusive 0600 temp file, rejecting symlinks and foreign-owned targets."""
    parent = file_path.parent
    if str(parent) not in ("/tmp", "/var") and parent.is_symlink():
        raise RuntimeError(f"Refusing to write inside symlinked directory: {parent}")
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    resolved_parent = parent.resolve() if str(parent) in ("/tmp", "/var") else parent
    st_parent = os.lstat(resolved_parent)
    if not stat.S_ISDIR(st_parent.st_mode):
        raise RuntimeError(f"Output parent is not a directory: {parent}")
    if hasattr(os, "getuid") and st_parent.st_uid != os.getuid() and not (
        st_parent.st_mode & stat.S_ISVTX
    ):
        raise RuntimeError(
            f"Refusing to write inside directory not owned by current user: {parent}"
        )
    _validate_existing_output_target(file_path)
    fd, tmp_str = tempfile.mkstemp(
        prefix=f".{file_path.name}.", suffix=".tmp", dir=str(resolved_parent)
    )
    tmp_path = Path(tmp_str)
    try:
        try:
            os.fchmod(fd, mode)
            data = text.encode("utf-8")
            view = memoryview(data)
            total = 0
            while total < len(view):
                written = os.write(fd, view[total:])
                if written <= 0:
                    raise RuntimeError(f"Short write to {tmp_path}")
                total += written
            os.fsync(fd)
        finally:
            os.close(fd)
        _validate_existing_output_target(file_path)
        os.replace(tmp_path, file_path)
    finally:
        if tmp_path.exists() or tmp_path.is_symlink():
            try:
                tmp_path.unlink()
            except OSError:
                pass


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


def _find_layer_in_symbol_master(
    master: Dict[str, Any], target_layer_id: str
) -> Optional[Dict[str, Any]]:
    found: Optional[Dict[str, Any]] = None

    def walk(node: Dict[str, Any]) -> None:
        nonlocal found
        if found is not None:
            return
        if str(node.get("do_objectID", "")) == target_layer_id:
            found = node
            return
        for ch in node.get("layers") or []:
            if isinstance(ch, dict):
                walk(ch)

    walk(master)
    return found


def _resolve_override_path_in_masters(
    root_sym_id: str,
    path_part: str,
    symbol_masters: Dict[str, Dict[str, Any]],
    foreign_symbol_ids: Set[str],
    override_values: List[Dict[str, Any]],
) -> Tuple[bool, str, str]:
    """Validate every segment of a potentially nested override path (`instA/instB/leaf`).

    Returns `(is_valid, failed_layer_id, failed_symbol_id)`.
    """
    segments = [seg for seg in path_part.split("/") if seg]
    if not segments:
        return False, "", root_sym_id

    symbol_swaps: Dict[str, str] = {}
    for ov in override_values:
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if ov_name.endswith("_symbolID") and isinstance(ov.get("value"), str):
            prefix = ov_name[: -len("_symbolID")]
            symbol_swaps[prefix] = str(ov["value"])

    cur_sym_id = root_sym_id
    prefix_segments: List[str] = []
    for idx, seg in enumerate(segments):
        prefix_segments.append(seg)
        cur_master = symbol_masters.get(cur_sym_id)
        if cur_master is None:
            # If the symbol master is an external/upstream foreign symbol without an embedded master tree,
            # we cannot inspect its internal layers offline.
            if cur_sym_id in foreign_symbol_ids:
                return True, "", cur_sym_id
            return False, seg, cur_sym_id

        target_node = _find_layer_in_symbol_master(cur_master, seg)
        if target_node is None:
            return False, seg, cur_sym_id

        is_last = idx == len(segments) - 1
        if not is_last:
            if target_node.get("_class") != "symbolInstance":
                return False, seg, cur_sym_id
            prefix_key = "/".join(prefix_segments)
            next_sym_id = symbol_swaps.get(
                prefix_key, str(target_node.get("symbolID", ""))
            )
            if not next_sym_id:
                return False, seg, cur_sym_id
            cur_sym_id = next_sym_id

    return True, "", cur_sym_id


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


def _participates_in_flex_flow(child: Dict[str, Any]) -> bool:
    flex_item = child.get("flexItem") or {}
    if bool(flex_item.get("ignoresStackLayout", False)):
        return False
    if bool(child.get("isVisible", True)):
        return True
    return bool(flex_item.get("preserveSpaceWhenHidden", False))


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
        if isinstance(ch, dict) and _participates_in_flex_flow(ch)
    ]
    if not flow_children:
        return

    visual_children = list(reversed(flow_children))
    if flex_dir == 1:
        total_children_h = sum(
            float((ch.get("frame") or {}).get("height", 0.0))
            for ch in visual_children
        )
        n_children = len(visual_children)
        natural_content_h = total_children_h + gap * max(0, n_children - 1)
        expected_total_h = top_pad + natural_content_h + bottom_pad

        cursor_y = top_pad
        step_gap = gap
        if vert_sizing != 1 and g_h > 0.0:
            inner_h = max(0.0, g_h - top_pad - bottom_pad)
            free_space = inner_h - natural_content_h
            if justify == 1:  # Center
                cursor_y = top_pad + free_space / 2.0
            elif justify == 2:  # End
                cursor_y = top_pad + free_space
            elif justify == 3 and n_children > 1:  # SpaceBetween
                cursor_y = top_pad
                step_gap = max(0.0, (inner_h - total_children_h) / (n_children - 1))
            elif justify == 4 and n_children > 0:  # SpaceAround
                unit = max(0.0, (inner_h - total_children_h) / n_children)
                cursor_y = top_pad + unit / 2.0
                step_gap = unit
            elif justify == 5 and n_children > 0:  # SpaceEvenly
                unit = max(0.0, (inner_h - total_children_h) / (n_children + 1))
                cursor_y = top_pad + unit
                step_gap = unit

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
                cursor_y += step_gap

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
        max_child_h = max(
            float((ch.get("frame") or {}).get("height", 0.0)) for ch in visual_children
        )
        expected_row_h = top_pad + max_child_h + bottom_pad
        if vert_sizing == 1 and abs(g_h - expected_row_h) > tolerance:
            findings.append(
                _new_finding(
                    "flex_and_focus",
                    "FLEX-CONTAINER-HEIGHT-UNCLOSED",
                    f"Flex Row '{group.get('name')}' height={g_h} does not close around tallest child+padding={expected_row_h}",
                    page_id=page_id,
                    artboard_id=artboard_id,
                    layer_id=g_id,
                    details={
                        "actualHeight": g_h,
                        "expectedHeight": round(expected_row_h, 2),
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

        for page_ref in doc_data.get("pages") or []:
            if not isinstance(page_ref, dict):
                continue
            ref_str = str(page_ref.get("_ref", "")).strip()
            if not ref_str and page_ref.get("do_objectID"):
                ref_str = f"pages/{page_ref['do_objectID']}"
            if ref_str:
                expected_member = (
                    ref_str if ref_str.endswith(".json") else f"{ref_str}.json"
                )
                if expected_member not in pages_data:
                    findings.append(
                        _new_finding(
                            "archive_and_ids",
                            "ARCHIVE-MISSING-REFERENCED-PAGE",
                            f"document.json references page '{expected_member}' which is missing from the archive",
                        )
                    )
        if not pages_data:
            findings.append(
                _new_finding(
                    "archive_and_ids",
                    "ARCHIVE-NO-PAGES",
                    "Archive contains no pages/*.json members",
                )
            )

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

    seen_object_ids: Dict[str, str] = {}
    duplicate_ids: List[Dict[str, str]] = []

    def register_object_id(
        oid: str,
        loc_tag: str,
        page_id: Optional[str] = None,
        artboard_id: Optional[str] = None,
    ) -> None:
        if not oid:
            return
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
                    artboard_id=artboard_id,
                    layer_id=oid,
                )
            )
        else:
            seen_object_ids[oid] = loc_tag

    if doc_data.get("do_objectID"):
        register_object_id(str(doc_data["do_objectID"]), "document.json:document")

    def audit_shared_style_object(st: Dict[str, Any], label_prefix: str) -> None:
        sid = st.get("do_objectID")
        sname = str(st.get("name", ""))
        if sid:
            sid_str = str(sid)
            shared_style_ids.add(sid_str)
            register_object_id(sid_str, f"document.json:{label_prefix}:{sname}")
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
            inspect_font_descriptor(f_desc, f"{label_prefix}:{sname}")

    for style_group_key in ("layerStyles", "layerTextStyles"):
        objs = (doc_data.get(style_group_key) or {}).get("objects") or []
        for st in objs:
            if isinstance(st, dict):
                audit_shared_style_object(st, "sharedStyle")

    for f_style_key in ("foreignLayerStyles", "foreignTextStyles"):
        for fst in doc_data.get(f_style_key) or []:
            if isinstance(fst, dict):
                local_st = fst.get("localSharedStyle") or {}
                if isinstance(local_st, dict) and local_st:
                    audit_shared_style_object(local_st, "foreignSharedStyle")
                fst_oid = str(fst.get("do_objectID", "") or "")
                if fst_oid and fst_oid != str((local_st or {}).get("do_objectID", "") or ""):
                    register_object_id(fst_oid, f"document.json:{f_style_key}")

    for sw in (doc_data.get("sharedSwatches") or {}).get("objects") or []:
        if isinstance(sw, dict) and sw.get("do_objectID"):
            sw_id = str(sw["do_objectID"])
            swatch_ids.add(sw_id)
            register_object_id(
                sw_id, f"document.json:swatch:{sw.get('name', '')}"
            )
    for fsw in doc_data.get("foreignSwatches") or []:
        if isinstance(fsw, dict):
            local_sw = fsw.get("localSwatch") or {}
            if local_sw.get("do_objectID"):
                lsw_id = str(local_sw["do_objectID"])
                swatch_ids.add(lsw_id)
                register_object_id(
                    lsw_id, f"document.json:foreignSwatch:{local_sw.get('name', '')}"
                )
            fsw_oid = str(fsw.get("do_objectID", "") or "")
            if fsw_oid and fsw_oid != str(local_sw.get("do_objectID", "") or ""):
                register_object_id(fsw_oid, "document.json:foreignSwatches")

    embedded_foreign_masters: List[Dict[str, Any]] = []
    for fsym in doc_data.get("foreignSymbols") or []:
        if isinstance(fsym, dict):
            sm = fsym.get("symbolMaster") or fsym.get("originalMaster") or {}
            if isinstance(sm, dict) and sm:
                if sm.get("symbolID"):
                    foreign_symbol_ids.add(str(sm["symbolID"]))
                if sm.get("do_objectID") or sm.get("symbolID"):
                    symbol_masters[str(sm.get("symbolID") or sm["do_objectID"])] = sm
                embedded_foreign_masters.append(sm)
            fsym_oid = str(fsym.get("do_objectID", "") or "")
            if fsym_oid and fsym_oid != str((sm if isinstance(sm, dict) else {}).get("do_objectID", "") or ""):
                register_object_id(fsym_oid, "document.json:foreignSymbols")

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

    # Walk all pages for ID uniqueness, references, fonts, Flex stacks, Focus Rings, and Flows
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

    audit_roots: List[Tuple[str, Dict[str, Any]]] = list(sorted(pages_data.items()))
    if embedded_foreign_masters:
        audit_roots.append(
            (
                "document.json#foreignSymbols",
                {
                    "_class": "page",
                    "do_objectID": "",
                    "name": "ForeignSymbols",
                    "layers": embedded_foreign_masters,
                },
            )
        )

    for page_member, page_obj in audit_roots:
        page_id = str(page_obj.get("do_objectID") or page_member)

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
                register_object_id(
                    oid,
                    loc_tag,
                    page_id=page_id,
                    artboard_id=(artboard or {}).get("do_objectID"),
                )

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
                override_list = [
                    ov for ov in (node.get("overrideValues") or []) if isinstance(ov, dict)
                ]
                for ov in override_list:
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
                    if sym_id in symbol_masters:
                        is_valid_path, failed_layer_id, failed_sym_id = (
                            _resolve_override_path_in_masters(
                                sym_id,
                                path_part,
                                symbol_masters,
                                foreign_symbol_ids,
                                override_list,
                            )
                        )
                        if not is_valid_path:
                            dangling_overrides.append(
                                {
                                    "overrideName": ov_name,
                                    "leafLayerID": failed_layer_id,
                                    "symbolID": failed_sym_id,
                                    "layerID": oid,
                                }
                            )
                            findings.append(
                                _new_finding(
                                    "reference_integrity",
                                    "REF-DANGLING-OVERRIDE-PATH",
                                    f"Override '{ov_name}' targets non-existent or invalid path segment '{failed_layer_id}' in symbolMaster '{failed_sym_id}'",
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
                ancestor_names = [
                    str(anc.get("name", ""))
                    for anc in ancestors
                    if anc.get("_class") not in ("page",)
                ]
                is_clock = _is_statusbar_clock_layer(
                    txt_content, lname, ancestor_names, cur_abs_y
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
        _write_text_nofollow(Path(args.output), out_str + "\n")
    print(out_str)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
