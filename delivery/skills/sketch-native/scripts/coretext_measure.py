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
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


SCRIPT_DIR = Path(__file__).resolve().parent
SWIFT_SOURCE = SCRIPT_DIR / "measure-coretext.swift"


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
    items: List[Dict[str, Any]],
    swift_bin: Optional[str] = None,
) -> Dict[str, Any]:
    """Measure a batch of text specs exclusively via native macOS CoreText."""
    if platform.system() != "Darwin":
        raise RuntimeError(
            f"Unsupported platform '{platform.system()}': native macOS CoreText is required."
        )
    if not SWIFT_SOURCE.exists():
        raise FileNotFoundError(
            f"Required Swift CoreText helper not found: {SWIFT_SOURCE}"
        )
    if not items:
        return {
            "tool": "coretext_measure.py",
            "engine": "macOS-CoreText-CTTypesetter",
            "count": 0,
            "results": [],
        }

    if swift_bin:
        cmd = [swift_bin, str(SWIFT_SOURCE)]
    else:
        binary = _get_or_compile_swift_binary()
        cmd = [str(binary)] if binary else ["swift", str(SWIFT_SOURCE)]

    proc = subprocess.run(
        cmd + ["--input", "-"],
        input=json.dumps(items, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        err_detail = (proc.stderr or "").strip() or f"exit code {proc.returncode}"
        raise RuntimeError(
            f"Native macOS CoreText measurement failed: {err_detail}"
        )
    parsed = json.loads(proc.stdout)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("results"), list):
        raise RuntimeError("Native macOS CoreText returned invalid JSON structure.")
    return parsed


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

    runs: List[Dict[str, Any]] = []
    for attr_entry in attrs_list:
        if not isinstance(attr_entry, dict):
            continue
        loc = int(attr_entry.get("location", 0) or 0)
        length = int(attr_entry.get("length", 0) or 0)
        if length <= 0:
            continue
        sub_attrs = attr_entry.get("attributes") or {}
        sub_font = (
            sub_attrs.get("MSAttributedStringFontAttribute") or {}
        ).get("attributes") or {}
        sub_para = sub_attrs.get("paragraphStyle") or {}
        sub_lh = sub_para.get("maximumLineHeight") or sub_para.get(
            "minimumLineHeight"
        )
        runs.append(
            {
                "location": loc,
                "length": length,
                "fontName": sub_font.get("name", font_name),
                "uiUsage": sub_font.get("NSCTFontUIUsageAttribute", ui_usage),
                "fontSize": float(sub_font.get("size", font_size)),
                "lineHeight": (
                    float(sub_lh)
                    if sub_lh is not None
                    else (float(line_height) if line_height is not None else None)
                ),
                "paragraphSpacing": float(
                    sub_para.get("paragraphSpacing", para_spacing) or 0.0
                ),
                "kerning": float(sub_attrs.get("kerning", kerning) or 0.0),
            }
        )

    spec_out: Dict[str, Any] = {
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
    if runs:
        spec_out["runs"] = runs
    return spec_out


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


def _resolve_nested_override_text_layer(
    root_master: Dict[str, Any],
    override_path: str,
    symbol_masters: Dict[str, Dict[str, Any]],
    instance_overrides: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Resolve a potentially nested override path (<inst-id>/.../<text-id>) to its target text layer."""
    segments = [seg for seg in override_path.split("/") if seg]
    if not segments:
        return None
    swap_map: Dict[str, str] = {}
    for ov in instance_overrides:
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if ov_name.endswith("_symbolID") and isinstance(ov.get("value"), str) and ov.get("value"):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    cur_master = root_master
    for idx, seg_id in enumerate(segments):
        found = _find_layer_by_id(cur_master, seg_id)
        if found is None:
            return None
        if idx < len(segments) - 1:
            if found.get("_class") != "symbolInstance":
                return None
            prefix = "/".join(segments[: idx + 1])
            next_sym_id = swap_map.get(prefix) or str(found.get("symbolID", ""))
            next_master = symbol_masters.get(next_sym_id)
            if next_master is None:
                return None
            cur_master = next_master
        else:
            return found
    return None


def _reflow_vertical_flex_group(group: Dict[str, Any]) -> float:
    """Re-pack a vertical MSImmutableFlexGroupLayout in Sketch's reversed index order, preserving justifyContent."""
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
    justify = int(layout.get("justifyContent", 0) or 0)
    vertical_sizing = int(layout.get("verticalSizing", 1))

    children = [
        ch
        for ch in (group.get("layers") or [])
        if isinstance(ch, dict)
        and ch.get("isVisible", True)
        and not bool((ch.get("flexItem") or {}).get("ignoresStackLayout", False))
    ]
    visual_children = list(reversed(children))
    n = len(visual_children)
    if n == 0:
        return 0.0

    children_total_h = sum(
        float((ch.get("frame") or {}).get("height", 0.0)) for ch in visual_children
    )
    content_h = children_total_h + gap * max(0, n - 1)
    g_frame = group.get("frame")

    cursor_y = top_pad
    effective_gap = gap
    if vertical_sizing != 1 and isinstance(g_frame, dict):
        container_h = float(g_frame.get("height", 0.0))
        inner_h = container_h - top_pad - bottom_pad
        free_space = inner_h - content_h
        if justify == 0:
            cursor_y = top_pad
            effective_gap = gap
        elif justify == 1:
            cursor_y = top_pad + free_space / 2.0
            effective_gap = gap
        elif justify == 2:
            cursor_y = top_pad + free_space
            effective_gap = gap
        elif justify == 3:
            cursor_y = top_pad
            effective_gap = (inner_h - children_total_h) / (n - 1) if n > 1 else 0.0
        elif justify == 4:
            unit = (inner_h - children_total_h) / n
            cursor_y = top_pad + unit / 2.0
            effective_gap = unit
        elif justify == 5:
            unit = (inner_h - children_total_h) / (n + 1)
            cursor_y = top_pad + unit
            effective_gap = unit
        else:
            raise ValueError(
                f"Unsupported vertical justifyContent={justify} on Flex group '{group.get('do_objectID')}'"
            )

    for idx, child in enumerate(visual_children):
        c_frame = child.get("frame")
        if isinstance(c_frame, dict):
            c_frame["y"] = round(cursor_y, 2)
            cursor_y += float(c_frame.get("height", 0.0))
            if idx < n - 1:
                cursor_y += effective_gap

    new_total_h = round(top_pad + content_h + bottom_pad, 2)
    if isinstance(g_frame, dict) and vertical_sizing == 1:
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
    sketch_path: Path,
    rebake: bool = False,
    swift_bin: Optional[str] = None,
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
                inst_overrides = node.get("overrideValues") or []
                inst_frame = node.get("frame") or {}
                m_frame = master.get("frame") or {}
                override_entries: List[Dict[str, Any]] = []
                for ov in inst_overrides:
                    if not isinstance(ov, dict):
                        continue
                    ov_name = str(ov.get("overrideName", ""))
                    if not ov_name.endswith("_stringValue"):
                        continue
                    override_path = ov_name[: -len("_stringValue")]
                    master_text = _resolve_nested_override_text_layer(
                        master, override_path, symbol_masters, inst_overrides
                    )
                    if master_text is None:
                        continue
                    m_spec = _extract_text_layer_spec(master_text)
                    if m_spec is None:
                        continue
                    scale_w = float(inst_frame.get("width", m_spec["width"])) - (
                        float(m_frame.get("width", m_spec["width"])) - m_spec["width"]
                    )
                    ov_id = f"{node.get('do_objectID')}::{ov_name}"
                    ov_spec = dict(m_spec)
                    ov_spec.pop("runs", None)
                    ov_spec["id"] = ov_id
                    ov_spec["text"] = str(ov.get("value", ""))
                    ov_spec["width"] = max(1.0, scale_w)
                    measure_queue.append(ov_spec)
                    override_entries.append(
                        {
                            "overrideName": ov_name,
                            "spec": ov_spec,
                            "masterTextBaseHeight": float(m_spec["currentHeight"]),
                        }
                    )
                if override_entries:
                    targets_meta.append(
                        {
                            "kind": "symbolInstanceOverride",
                            "pageFile": page_file,
                            "artboard": cur_artboard,
                            "node": node,
                            "ancestors": list(ancestors),
                            "overrides": override_entries,
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

    batch_report = measure_specs(measure_queue, swift_bin=swift_bin)
    measured_by_id = {item["id"]: item for item in batch_report.get("results", [])}

    drifts: List[Dict[str, Any]] = []
    rebaked_layers: List[Dict[str, Any]] = []
    dirty_pages: set[str] = set()

    for meta in targets_meta:
        node = meta["node"]
        frame = node.get("frame") or {}
        current_h = float(frame.get("height", 0.0))
        if meta["kind"] == "textLayer":
            spec = meta["spec"]
            m_res = measured_by_id.get(spec["id"])
            if m_res is None:
                continue
            expected_h = float(m_res["bakedHeight"])
            spec_id = spec["id"]
            line_count = m_res["lineCount"]
            resolved_ps = m_res["resolvedPostScriptName"]
            ov_details = None
        else:
            total_delta_text = 0.0
            ov_details = []
            resolved_ps = ""
            total_lines = 0
            for ov_entry in meta["overrides"]:
                ov_spec = ov_entry["spec"]
                m_res = measured_by_id.get(ov_spec["id"])
                if m_res is None:
                    continue
                delta_text = float(m_res["bakedHeight"]) - float(
                    ov_entry["masterTextBaseHeight"]
                )
                total_delta_text += delta_text
                total_lines += int(m_res["lineCount"])
                resolved_ps = m_res["resolvedPostScriptName"]
                ov_details.append(
                    {
                        "overrideName": ov_entry["overrideName"],
                        "specID": ov_spec["id"],
                        "masterTextBaseHeight": ov_entry["masterTextBaseHeight"],
                        "measuredTextHeight": float(m_res["bakedHeight"]),
                        "deltaTextHeight": round(delta_text, 2),
                    }
                )
            if not ov_details:
                continue
            expected_h = round(
                max(1.0, float(meta["masterBaseHeight"]) + total_delta_text), 2
            )
            spec_id = (
                ov_details[0]["specID"]
                if len(ov_details) == 1
                else f"{node.get('do_objectID')}::merged({len(ov_details)})"
            )
            line_count = total_lines

        delta_h = round(expected_h - current_h, 2)
        if abs(delta_h) > 0.01:
            drift_record: Dict[str, Any] = {
                "code": "NATIVE-LAYOUT-HOTSPOT-DESYNC",
                "kind": meta["kind"],
                "pageFile": meta["pageFile"],
                "artboardID": (meta["artboard"] or {}).get("do_objectID"),
                "artboardName": (meta["artboard"] or {}).get("name"),
                "layerID": node.get("do_objectID"),
                "layerName": node.get("name"),
                "specID": spec_id,
                "currentHeight": current_h,
                "bakedHeight": expected_h,
                "deltaHeight": delta_h,
                "lineCount": line_count,
                "resolvedPostScriptName": resolved_ps,
            }
            if ov_details is not None:
                drift_record["overrides"] = ov_details
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
                                    ax, ay, aw, ah = after_rects.get(
                                        oid, (bx, by, bw, bh)
                                    )
                                    hs_frame["x"] = round(ax + (hx - bx), 2)
                                    hs_frame["y"] = round(ay + (hy - by), 2)
                                    hs_frame["width"] = round(aw + (hw - bw), 2)
                                    hs_frame["height"] = round(ah + (hh - bh), 2)
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
        "--swift-bin",
        help="Optional path to the swift executable (default: cached compiled binary or 'swift').",
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
                swift_bin=args.swift_bin,
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
            report = measure_specs(items, swift_bin=args.swift_bin)
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
