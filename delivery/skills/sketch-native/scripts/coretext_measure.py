#!/usr/bin/env python3
"""macOS CoreText line-break measurement and Sketch Flex Stack re-baker.

Wraps `measure-coretext.swift` (with automatic compiled binary caching in TMPDIR)
to measure exact line breaks for `textBehaviour == 1` text layers and auto-height
`SymbolInstance` text overrides, detect `NATIVE-LAYOUT-HOTSPOT-DESYNC` (> 0 px height
drift), and optionally re-bake `MSImmutableFlexGroupLayout` vertical coordinates and
synchronized top-level Freeform `HotSpot` coordinates in place inside a `.sketch` file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


SCRIPT_DIR = Path(__file__).resolve().parent
SWIFT_SOURCE = SCRIPT_DIR / "measure-coretext.swift"


def _fallback_measure_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic CoreText-calibrated fallback when Swift/CoreText is unavailable."""
    text = str(item.get("text", ""))
    font_size = max(1.0, float(item.get("fontSize", 14.0)))
    raw_line_height = item.get("lineHeight")
    single_lh = (
        float(raw_line_height)
        if raw_line_height is not None and float(raw_line_height) > 0
        else float(math.ceil(font_size * 1.4))
    )
    width = max(1.0, float(item.get("width", 100.0)))
    para_spacing = max(0.0, float(item.get("paragraphSpacing", 0.0) or 0.0))
    kerning = float(item.get("kerning", 0.0) or 0.0)
    ui_usage = item.get("uiUsage")
    font_name = item.get("fontName") or ui_usage or "CTFontRegularUsage"
    used_sys = bool(
        ui_usage
        or font_name
        in {
            "CTFontRegularUsage",
            "CTFontEmphasizedUsage",
            ".SFNS-Regular",
            "system",
            "System",
        }
    )
    resolved_ps = ".SFNS-Regular" if used_sys else str(font_name)

    if not text:
        return {
            "id": str(item.get("id", "")),
            "text": "",
            "requestedFontName": str(font_name),
            "resolvedPostScriptName": resolved_ps,
            "usedSystemUIFont": used_sys,
            "fontSize": font_size,
            "singleLineHeight": single_lh,
            "width": width,
            "paragraphSpacing": para_spacing,
            "lineCount": 1,
            "lines": [
                {
                    "index": 0,
                    "location": 0,
                    "length": 0,
                    "text": "",
                    "width": 0.0,
                    "lineHeight": single_lh,
                }
            ],
            "bakedHeight": float(round(single_lh)),
        }

    paragraphs = text.split("\n")
    lines: List[Dict[str, Any]] = []
    cursor = 0
    line_idx = 0
    for para in paragraphs:
        if not para:
            lines.append(
                {
                    "index": line_idx,
                    "location": cursor,
                    "length": 0,
                    "text": "",
                    "width": 0.0,
                    "lineHeight": single_lh,
                }
            )
            line_idx += 1
            cursor += 1
            continue

        cur_start = 0
        cur_w = 0.0
        cur_chars: List[str] = []
        for idx, ch in enumerate(para):
            ea = unicodedata.east_asian_width(ch)
            ch_w = (
                font_size * 1.0
                if ea in ("W", "F")
                else (font_size * 0.32 if ch.isspace() else font_size * 0.56)
            ) + kerning
            if cur_chars and (cur_w + ch_w) > width + 0.01:
                seg = "".join(cur_chars)
                lines.append(
                    {
                        "index": line_idx,
                        "location": cursor + cur_start,
                        "length": len(seg),
                        "text": seg,
                        "width": round(cur_w, 2),
                        "lineHeight": single_lh,
                    }
                )
                line_idx += 1
                cur_start = idx
                cur_chars = [ch]
                cur_w = ch_w
            else:
                cur_chars.append(ch)
                cur_w += ch_w

        if cur_chars:
            seg = "".join(cur_chars)
            lines.append(
                {
                    "index": line_idx,
                    "location": cursor + cur_start,
                    "length": len(seg),
                    "text": seg,
                    "width": round(cur_w, 2),
                    "lineHeight": single_lh,
                }
            )
            line_idx += 1
        cursor += len(para) + 1

    breaks = max(0, len(paragraphs) - 1)
    baked_h = round(len(lines) * single_lh + breaks * para_spacing)
    return {
        "id": str(item.get("id", "")),
        "text": text,
        "requestedFontName": str(font_name),
        "resolvedPostScriptName": resolved_ps,
        "usedSystemUIFont": used_sys,
        "fontSize": font_size,
        "singleLineHeight": single_lh,
        "width": width,
        "paragraphSpacing": para_spacing,
        "lineCount": len(lines),
        "lines": lines,
        "bakedHeight": float(baked_h),
    }


def _get_or_compile_swift_binary() -> Optional[Path]:
    if platform.system() != "Darwin" or not SWIFT_SOURCE.exists():
        return None
    swiftc = shutil.which("swiftc")
    if not swiftc:
        return None
    source_bytes = SWIFT_SOURCE.read_bytes()
    digest = hashlib.sha256(source_bytes).hexdigest()[:16]
    cache_dir = Path(tempfile.gettempdir()) / "sketch-native-coretext-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    binary_path = cache_dir / f"measure-coretext-{digest}"
    if binary_path.exists() and os.access(binary_path, os.X_OK):
        return binary_path

    tmp_bin = cache_dir / f"measure-coretext-{digest}.{os.getpid()}.tmp"
    try:
        proc = subprocess.run(
            [swiftc, "-O", str(SWIFT_SOURCE), "-o", str(tmp_bin)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if proc.returncode == 0 and tmp_bin.exists():
            tmp_bin.chmod(0o755)
            tmp_bin.replace(binary_path)
            return binary_path
    except Exception:
        pass
    finally:
        if tmp_bin.exists():
            try:
                tmp_bin.unlink()
            except OSError:
                pass
    return None


def measure_specs(
    items: List[Dict[str, Any]], force_fallback: bool = False
) -> Dict[str, Any]:
    """Measure a batch of text specs via native macOS CoreText or fallback."""
    if not items:
        return {
            "tool": "coretext_measure.py",
            "engine": "macOS-CoreText-CTTypesetter"
            if (platform.system() == "Darwin" and not force_fallback)
            else "python-coretext-calibrated-fallback",
            "count": 0,
            "results": [],
        }

    if not force_fallback and platform.system() == "Darwin" and SWIFT_SOURCE.exists():
        binary = _get_or_compile_swift_binary()
        cmd = [str(binary)] if binary else ["swift", str(SWIFT_SOURCE)]
        try:
            proc = subprocess.run(
                cmd + ["--input", "-"],
                input=json.dumps(items, ensure_ascii=False),
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                return json.loads(proc.stdout)
        except Exception:
            pass

    results = [_fallback_measure_item(it) for it in items]
    return {
        "tool": "coretext_measure.py",
        "engine": "python-coretext-calibrated-fallback",
        "count": len(results),
        "results": results,
    }


def _extract_text_layer_spec(layer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if layer.get("_class") != "text":
        return None
    if int(layer.get("textBehaviour", 0)) != 1:
        return None
    frame = layer.get("frame") or {}
    width = float(frame.get("width", 0.0))
    if width <= 0:
        return None

    attr_str = layer.get("attributedString") or {}
    text = str(attr_str.get("string", ""))
    attrs_list = attr_str.get("attributes") or []
    first_attr = (attrs_list[0].get("attributes") if attrs_list else {}) or {}
    font_desc = (
        first_attr.get("MSAttributedStringFontAttribute") or {}
    ).get("attributes") or {}
    para_style = first_attr.get("paragraphStyle") or {}

    font_name = font_desc.get("name")
    ui_usage = font_desc.get("NSCTFontUIUsageAttribute")
    font_size = float(font_desc.get("size", 14.0))
    line_height = para_style.get("maximumLineHeight") or para_style.get(
        "minimumLineHeight"
    )
    para_spacing = float(para_style.get("paragraphSpacing", 0.0) or 0.0)
    kerning = float(first_attr.get("kerning", 0.0) or 0.0)

    return {
        "id": str(layer.get("do_objectID", "")),
        "name": str(layer.get("name", "")),
        "text": text,
        "fontName": font_name,
        "uiUsage": ui_usage,
        "fontSize": font_size,
        "lineHeight": float(line_height) if line_height is not None else None,
        "width": width,
        "paragraphSpacing": para_spacing,
        "kerning": kerning,
        "currentHeight": float(frame.get("height", 0.0)),
    }


def _index_symbol_masters(
    pages_data: Dict[str, Dict[str, Any]]
) -> Dict[str, Dict[str, Any]]:
    masters: Dict[str, Dict[str, Any]] = {}

    def walk(node: Dict[str, Any]) -> None:
        if node.get("_class") == "symbolMaster" and node.get("symbolID"):
            masters[str(node["symbolID"])] = node
        for child in node.get("layers") or []:
            if isinstance(child, dict):
                walk(child)

    for page in pages_data.values():
        walk(page)
    return masters


def _find_layer_by_id(
    root: Dict[str, Any], target_id: str
) -> Optional[Dict[str, Any]]:
    if str(root.get("do_objectID", "")) == target_id:
        return root
    for child in root.get("layers") or []:
        if isinstance(child, dict):
            found = _find_layer_by_id(child, target_id)
            if found is not None:
                return found
    return None


def _reflow_vertical_flex_group(group: Dict[str, Any]) -> float:
    """Re-pack a vertical MSImmutableFlexGroupLayout in Sketch's reversed index order."""
    layout = group.get("groupLayout") or {}
    if layout.get("_class") != "MSImmutableFlexGroupLayout":
        return 0.0
    if int(layout.get("flexDirection", 1)) != 1:
        return 0.0

    has_ind = bool(layout.get("hasIndividualPadding", False))
    base_pad = float(layout.get("padding", 0.0) or 0.0)
    top_pad = float(layout.get("topPadding", base_pad) if has_ind else base_pad)
    bottom_pad = float(layout.get("bottomPadding", base_pad) if has_ind else base_pad)
    gap = float(layout.get("allGuttersGap", 0.0) or 0.0)

    children = [
        ch
        for ch in (group.get("layers") or [])
        if isinstance(ch, dict)
        and ch.get("isVisible", True)
        and not bool((ch.get("flexItem") or {}).get("ignoresStackLayout", False))
    ]
    visual_children = list(reversed(children))
    cursor_y = top_pad
    for idx, child in enumerate(visual_children):
        c_frame = child.get("frame")
        if isinstance(c_frame, dict):
            c_frame["y"] = round(cursor_y, 2)
            cursor_y += float(c_frame.get("height", 0.0))
            if idx < len(visual_children) - 1:
                cursor_y += gap

    new_total_h = round(cursor_y + bottom_pad, 2)
    vertical_sizing = int(layout.get("verticalSizing", 1))
    g_frame = group.get("frame")
    if isinstance(g_frame, dict) and vertical_sizing == 1 and len(visual_children) > 0:
        old_h = float(g_frame.get("height", 0.0))
        g_frame["height"] = new_total_h
        return new_total_h - old_h
    return 0.0


def _collect_artboard_rects(
    node: Dict[str, Any], offset_x: float = 0.0, offset_y: float = 0.0
) -> Dict[str, Tuple[float, float, float, float]]:
    rects: Dict[str, Tuple[float, float, float, float]] = {}
    frame = node.get("frame") or {}
    abs_x = offset_x + float(frame.get("x", 0.0))
    abs_y = offset_y + float(frame.get("y", 0.0))
    w = float(frame.get("width", 0.0))
    h = float(frame.get("height", 0.0))
    oid = str(node.get("do_objectID", ""))
    if oid and node.get("_class") not in ("page", "artboard", "symbolMaster"):
        rects[oid] = (abs_x, abs_y, w, h)
    next_x = 0.0 if node.get("_class") in ("page", "artboard", "symbolMaster") else abs_x
    next_y = 0.0 if node.get("_class") in ("page", "artboard", "symbolMaster") else abs_y
    for child in node.get("layers") or []:
        if isinstance(child, dict):
            rects.update(_collect_artboard_rects(child, next_x, next_y))
    return rects


def audit_and_rebake_sketch(
    sketch_path: Path, rebake: bool = False, force_fallback: bool = False
) -> Dict[str, Any]:
    if not sketch_path.exists():
        raise FileNotFoundError(f".sketch file not found: {sketch_path}")

    with zipfile.ZipFile(sketch_path, "r") as zf:
        members = {name: zf.read(name) for name in zf.namelist()}

    pages_data: Dict[str, Dict[str, Any]] = {}
    for name, raw in members.items():
        if name.startswith("pages/") and name.endswith(".json"):
            pages_data[name] = json.loads(raw.decode("utf-8"))

    symbol_masters = _index_symbol_masters(pages_data)

    measure_queue: List[Dict[str, Any]] = []
    targets_meta: List[Dict[str, Any]] = []

    def scan_node(
        page_file: str,
        artboard: Optional[Dict[str, Any]],
        node: Dict[str, Any],
        ancestors: List[Dict[str, Any]],
    ) -> None:
        cur_artboard = (
            node
            if node.get("_class") in ("artboard", "symbolMaster")
            else artboard
        )
        spec = _extract_text_layer_spec(node)
        if spec is not None:
            measure_queue.append(spec)
            targets_meta.append(
                {
                    "kind": "textLayer",
                    "pageFile": page_file,
                    "artboard": cur_artboard,
                    "node": node,
                    "ancestors": list(ancestors),
                    "spec": spec,
                }
            )
        elif node.get("_class") == "symbolInstance":
            sym_id = str(node.get("symbolID", ""))
            master = symbol_masters.get(sym_id)
            if master is not None:
                for ov in node.get("overrideValues") or []:
                    ov_name = str(ov.get("overrideName", ""))
                    if not ov_name.endswith("_stringValue"):
                        continue
                    target_layer_id = ov_name[: -len("_stringValue")].split("/")[-1]
                    master_text = _find_layer_by_id(master, target_layer_id)
                    if master_text is None:
                        continue
                    m_spec = _extract_text_layer_spec(master_text)
                    if m_spec is None:
                        continue
                    inst_frame = node.get("frame") or {}
                    m_frame = master.get("frame") or {}
                    scale_w = float(inst_frame.get("width", m_spec["width"])) - (
                        float(m_frame.get("width", m_spec["width"])) - m_spec["width"]
                    )
                    ov_id = f"{node.get('do_objectID')}::{ov_name}"
                    ov_spec = dict(m_spec)
                    ov_spec["id"] = ov_id
                    ov_spec["text"] = str(ov.get("value", ""))
                    ov_spec["width"] = max(1.0, scale_w)
                    measure_queue.append(ov_spec)
                    targets_meta.append(
                        {
                            "kind": "symbolInstanceOverride",
                            "pageFile": page_file,
                            "artboard": cur_artboard,
                            "node": node,
                            "ancestors": list(ancestors),
                            "spec": ov_spec,
                            "masterTextBaseHeight": m_spec["currentHeight"],
                            "masterBaseHeight": float(
                                m_frame.get("height", inst_frame.get("height", 0.0))
                            ),
                        }
                    )

        next_ancestors = ancestors + [node]
        for child in node.get("layers") or []:
            if isinstance(child, dict):
                scan_node(page_file, cur_artboard, child, next_ancestors)

    for page_file, page_obj in sorted(pages_data.items()):
        scan_node(page_file, None, page_obj, [])

    batch_report = measure_specs(measure_queue, force_fallback=force_fallback)
    measured_by_id = {item["id"]: item for item in batch_report.get("results", [])}

    drifts: List[Dict[str, Any]] = []
    rebaked_layers: List[Dict[str, Any]] = []
    dirty_pages: set[str] = set()

    for meta in targets_meta:
        spec = meta["spec"]
        m_res = measured_by_id.get(spec["id"])
        if m_res is None:
            continue
        node = meta["node"]
        frame = node.get("frame") or {}
        current_h = float(frame.get("height", 0.0))
        if meta["kind"] == "textLayer":
            expected_h = float(m_res["bakedHeight"])
        else:
            delta_text = float(m_res["bakedHeight"]) - float(
                meta["masterTextBaseHeight"]
            )
            expected_h = float(meta["masterBaseHeight"]) + max(0.0, delta_text)

        delta_h = round(expected_h - current_h, 2)
        if abs(delta_h) > 0.01:
            drift_record = {
                "code": "NATIVE-LAYOUT-HOTSPOT-DESYNC",
                "kind": meta["kind"],
                "pageFile": meta["pageFile"],
                "artboardID": (meta["artboard"] or {}).get("do_objectID"),
                "artboardName": (meta["artboard"] or {}).get("name"),
                "layerID": node.get("do_objectID"),
                "layerName": node.get("name"),
                "specID": spec["id"],
                "currentHeight": current_h,
                "bakedHeight": expected_h,
                "deltaHeight": delta_h,
                "lineCount": m_res["lineCount"],
                "resolvedPostScriptName": m_res["resolvedPostScriptName"],
            }
            drifts.append(drift_record)

            if rebake:
                artboard = meta["artboard"]
                before_rects = (
                    _collect_artboard_rects(artboard) if artboard is not None else {}
                )
                frame["height"] = expected_h
                for anc in reversed(meta["ancestors"]):
                    if (anc.get("groupLayout") or {}).get(
                        "_class"
                    ) == "MSImmutableFlexGroupLayout":
                        _reflow_vertical_flex_group(anc)
                if artboard is not None:
                    after_rects = _collect_artboard_rects(artboard)
                    for top_child in artboard.get("layers") or []:
                        if (
                            isinstance(top_child, dict)
                            and top_child.get("_class") == "MSImmutableHotspotLayer"
                        ):
                            hs_frame = top_child.get("frame") or {}
                            hx = float(hs_frame.get("x", 0.0))
                            hy = float(hs_frame.get("y", 0.0))
                            hw = float(hs_frame.get("width", 0.0))
                            hh = float(hs_frame.get("height", 0.0))
                            for oid, (bx, by, bw, bh) in before_rects.items():
                                if oid == top_child.get("do_objectID"):
                                    continue
                                if (
                                    abs(hx - bx) <= 2.0
                                    and abs(hy - by) <= 2.0
                                    and abs(hw - bw) <= 2.0
                                    and abs(hh - bh) <= 2.0
                                ):
                                    ax, ay, _, _ = after_rects.get(
                                        oid, (bx, by, bw, bh)
                                    )
                                    hs_frame["x"] = round(ax + (hx - bx), 2)
                                    hs_frame["y"] = round(ay + (hy - by), 2)
                                    break

                dirty_pages.add(meta["pageFile"])
                rebaked_layers.append(drift_record)

    if rebake and dirty_pages:
        for page_file in dirty_pages:
            members[page_file] = (
                json.dumps(pages_data[page_file], ensure_ascii=False, indent=2) + "\n"
            ).encode("utf-8")
        tmp_zip = sketch_path.with_suffix(".sketch.rebake.tmp")
        with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, raw in members.items():
                zout.writestr(name, raw)
        tmp_zip.replace(sketch_path)

    remaining_drifts = [] if rebake else drifts
    passed = len(remaining_drifts) == 0
    return {
        "tool": "coretext_measure.py",
        "mode": "sketch-rebake" if rebake else "sketch-audit",
        "sketch": str(sketch_path),
        "engine": batch_report.get("engine"),
        "passed": passed,
        "measuredCount": len(measure_queue),
        "driftCount": len(drifts),
        "rebakedCount": len(rebaked_layers),
        "remainingDriftCount": len(remaining_drifts),
        "drifts": drifts,
        "results": batch_report.get("results", []),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="coretext_measure.py",
        description=(
            "Measure exact macOS CoreText line breaks for Sketch textBehaviour == 1 "
            "layers and SymbolInstance overrides, detect NATIVE-LAYOUT-HOTSPOT-DESYNC, "
            "and optionally re-bake MSImmutableFlexGroupLayout vertical stacks in place."
        ),
    )
    parser.add_argument(
        "--input",
        "-i",
        help="Path to JSON array of text measurement specs (or '-' for stdin).",
    )
    parser.add_argument(
        "--sketch",
        "-s",
        help="Path to a .sketch archive to audit (and optionally --rebake).",
    )
    parser.add_argument(
        "--rebake",
        action="store_true",
        help="Re-bake text/SymbolInstance heights, parent Flex Stacks, and aligned HotSpots in place.",
    )
    parser.add_argument(
        "--output",
        "-o",
        help="Write the JSON report to this file path in addition to stdout.",
    )
    parser.add_argument(
        "--offline-fallback",
        action="store_true",
        help="Force deterministic CoreText-calibrated Python measurement without invoking Swift.",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.input and not args.sketch:
        parser.error("Provide either --input <specs.json> or --sketch <file.sketch>.")

    try:
        if args.sketch:
            report = audit_and_rebake_sketch(
                Path(args.sketch),
                rebake=args.rebake,
                force_fallback=args.offline_fallback,
            )
            exit_code = 0 if report.get("passed", False) else 1
        else:
            if args.input == "-":
                raw = sys.stdin.read()
            else:
                raw = Path(args.input).read_text(encoding="utf-8")
            parsed = json.loads(raw)
            items = parsed["items"] if isinstance(parsed, dict) and "items" in parsed else parsed
            if not isinstance(items, list):
                raise ValueError("Input JSON must be a list of specs or {'items': [...]}")
            report = measure_specs(items, force_fallback=args.offline_fallback)
            report["passed"] = True
            exit_code = 0
    except Exception as exc:
        err_report = {
            "tool": "coretext_measure.py",
            "passed": False,
            "error": str(exc),
        }
        out_str = json.dumps(err_report, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(out_str + "\n", encoding="utf-8")
        print(out_str)
        return 2

    out_str = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(out_str + "\n", encoding="utf-8")
    print(out_str)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
