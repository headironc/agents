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
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


SCRIPT_DIR = Path(__file__).resolve().parent
SWIFT_SOURCE = SCRIPT_DIR / "measure-coretext.swift"


def _open_pinned_parent_dir(
    target_path: Path,
    create: bool = False,
    require_user_owned_parent: bool = False,
) -> Tuple[int, str]:
    """Walk from '/' with O_DIRECTORY | O_NOFOLLOW to pin the parent directory fd and reject untrusted ancestors."""
    abs_path = Path(os.path.abspath(str(target_path)))
    parts = [p for p in abs_path.parts if p not in ("", "/")]
    if not parts:
        raise RuntimeError(f"Invalid target path: {target_path}")
    parent_parts, leaf_name = parts[:-1], parts[-1]
    uid = os.getuid() if hasattr(os, "getuid") else 0
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    dir_flag = getattr(os, "O_DIRECTORY", 0)
    cur_fd = os.open("/", os.O_RDONLY | dir_flag | nofollow)
    try:
        for idx, part in enumerate(parent_parts):
            if idx == 0 and part in ("tmp", "var", "etc"):
                try:
                    st_link = os.stat(part, dir_fd=cur_fd, follow_symlinks=False)
                except FileNotFoundError:
                    st_link = None
                if (
                    st_link is not None
                    and stat.S_ISLNK(st_link.st_mode)
                    and st_link.st_uid == 0
                ):
                    priv_fd = os.open(
                        "private", os.O_RDONLY | dir_flag | nofollow, dir_fd=cur_fd
                    )
                    os.close(cur_fd)
                    cur_fd = priv_fd
                    st_priv = os.fstat(cur_fd)
                    if st_priv.st_uid != 0 or (
                        st_priv.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
                    ):
                        raise RuntimeError("Untrusted /private root directory")
            try:
                next_fd = os.open(
                    part, os.O_RDONLY | dir_flag | nofollow, dir_fd=cur_fd
                )
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(part, 0o700, dir_fd=cur_fd)
                next_fd = os.open(
                    part, os.O_RDONLY | dir_flag | nofollow, dir_fd=cur_fd
                )
            os.close(cur_fd)
            cur_fd = next_fd
            st_dir = os.fstat(cur_fd)
            if not stat.S_ISDIR(st_dir.st_mode):
                raise RuntimeError(f"Ancestor is not a directory: {part}")
            if hasattr(os, "getuid") and st_dir.st_uid not in (0, uid):
                raise RuntimeError(
                    f"Refusing path with ancestor owned by another user (uid={st_dir.st_uid}): {target_path}"
                )
            if (st_dir.st_mode & (stat.S_IWGRP | stat.S_IWOTH)) and not (
                st_dir.st_mode & stat.S_ISVTX
            ):
                raise RuntimeError(
                    f"Refusing path with group/world-writable ancestor directory: {target_path}"
                )
        st_parent = os.fstat(cur_fd)
        if hasattr(os, "getuid"):
            if require_user_owned_parent and st_parent.st_uid != uid:
                raise RuntimeError(
                    f"Refusing operation inside directory not owned by current user: {target_path.parent}"
                )
            if st_parent.st_uid != uid and not (st_parent.st_mode & stat.S_ISVTX):
                raise RuntimeError(
                    f"Refusing to write inside directory not owned by current user: {target_path.parent}"
                )
        return cur_fd, leaf_name
    except Exception:
        os.close(cur_fd)
        raise


def _validate_existing_in_dir_fd(
    dir_fd: int, leaf_name: str, display_path: Path
) -> Optional[os.stat_result]:
    try:
        st = os.stat(leaf_name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(st.st_mode):
        raise RuntimeError(f"Refusing to write to symlinked file: {display_path}")
    if not stat.S_ISREG(st.st_mode):
        raise RuntimeError(f"Refusing to overwrite non-regular file: {display_path}")
    if hasattr(os, "getuid") and st.st_uid != os.getuid():
        raise RuntimeError(
            f"Refusing to overwrite file not owned by current user: {display_path}"
        )
    if st.st_nlink > 1:
        raise RuntimeError(f"Refusing to overwrite hard-linked file: {display_path}")
    return st


def _create_temp_in_dir_fd(
    dir_fd: int, prefix: str, suffix: str, mode: int = 0o600
) -> Tuple[int, str]:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    for _ in range(64):
        token = os.urandom(8).hex()
        tmp_name = f"{prefix}{token}{suffix}"
        try:
            fd = os.open(
                tmp_name,
                os.O_RDWR | os.O_CREAT | os.O_EXCL | nofollow,
                mode,
                dir_fd=dir_fd,
            )
            os.fchmod(fd, mode)
            return fd, tmp_name
        except FileExistsError:
            continue
    raise RuntimeError("Failed to allocate exclusive temporary file in pinned directory")


def _write_text_nofollow(file_path: Path, text: str, mode: int = 0o600) -> None:
    """Atomically write text to file_path via a pinned parent directory descriptor and renameat."""
    dir_fd, leaf_name = _open_pinned_parent_dir(file_path, create=True)
    tmp_name: Optional[str] = None
    try:
        _validate_existing_in_dir_fd(dir_fd, leaf_name, file_path)
        fd, tmp_name = _create_temp_in_dir_fd(
            dir_fd, f".{leaf_name}.", ".tmp", mode=mode
        )
        try:
            data = text.encode("utf-8")
            view = memoryview(data)
            total = 0
            while total < len(view):
                written = os.write(fd, view[total:])
                if written <= 0:
                    raise RuntimeError(f"Short write to {tmp_name}")
                total += written
            os.fsync(fd)
        finally:
            os.close(fd)
        _validate_existing_in_dir_fd(dir_fd, leaf_name, file_path)
        os.replace(tmp_name, leaf_name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        tmp_name = None
    finally:
        if tmp_name is not None:
            try:
                os.unlink(tmp_name, dir_fd=dir_fd)
            except OSError:
                pass
        os.close(dir_fd)


def _get_or_compile_swift_binary() -> Optional[Path]:
    if platform.system() != "Darwin" or not SWIFT_SOURCE.exists():
        return None
    swiftc = shutil.which("swiftc")
    if not swiftc:
        return None
    source_bytes = SWIFT_SOURCE.read_bytes()
    digest = hashlib.sha256(source_bytes).hexdigest()[:16]
    uid = os.getuid() if hasattr(os, "getuid") else 0
    cache_base = Path.home() / ".cache" if Path.home().exists() else Path(tempfile.gettempdir())
    cache_dir = cache_base / f"sketch-native-coretext-cache-{uid}"
    cache_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    st_cache = os.lstat(cache_dir)
    if stat.S_ISLNK(st_cache.st_mode) or not stat.S_ISDIR(st_cache.st_mode):
        return None
    if hasattr(os, "getuid") and st_cache.st_uid != uid:
        return None
    os.chmod(cache_dir, 0o700)
    binary_path = cache_dir / f"measure-coretext-{digest}"
    if binary_path.exists() and not binary_path.is_symlink() and os.access(binary_path, os.X_OK):
        return binary_path

    fd, tmp_bin_str = tempfile.mkstemp(
        prefix=f".measure-coretext-{digest}-", suffix=".tmp", dir=str(cache_dir)
    )
    os.close(fd)
    tmp_bin = Path(tmp_bin_str)
    try:
        proc = subprocess.run(
            [swiftc, "-O", str(SWIFT_SOURCE), "-o", str(tmp_bin)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if proc.returncode == 0 and tmp_bin.exists() and not tmp_bin.is_symlink():
            tmp_bin.chmod(0o700)
            tmp_bin.replace(binary_path)
            return binary_path
    except Exception:
        pass
    finally:
        if tmp_bin.exists() or tmp_bin.is_symlink():
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


def _extract_style_encoded_attrs(style_container: Dict[str, Any]) -> Dict[str, Any]:
    """Extract encodedAttributes dict from a sharedStyle, style, or textStyle dict."""
    if not isinstance(style_container, dict):
        return {}
    val = style_container.get("value")
    if isinstance(val, dict):
        ts = val.get("textStyle")
        if isinstance(ts, dict) and isinstance(ts.get("encodedAttributes"), dict):
            return ts["encodedAttributes"]
        if isinstance(val.get("encodedAttributes"), dict):
            return val["encodedAttributes"]
        attr_str = val.get("attributedString")
        if isinstance(attr_str, dict) and isinstance(attr_str.get("attributes"), list) and attr_str["attributes"]:
            first = attr_str["attributes"][0]
            if isinstance(first, dict) and isinstance(first.get("attributes"), dict):
                return first["attributes"]
    ts = style_container.get("textStyle")
    if isinstance(ts, dict) and isinstance(ts.get("encodedAttributes"), dict):
        return ts["encodedAttributes"]
    if isinstance(style_container.get("encodedAttributes"), dict):
        return style_container["encodedAttributes"]
    return {}


def _index_shared_text_styles(
    doc_data: Optional[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    styles: Dict[str, Dict[str, Any]] = {}
    if not isinstance(doc_data, dict):
        return styles
    for obj in (doc_data.get("layerTextStyles") or {}).get("objects") or []:
        if isinstance(obj, dict) and obj.get("do_objectID"):
            styles[str(obj["do_objectID"])] = _extract_style_encoded_attrs(obj)
    for fts in doc_data.get("foreignTextStyles") or []:
        if not isinstance(fts, dict):
            continue
        local_ss = fts.get("localSharedStyle")
        if isinstance(local_ss, dict) and local_ss.get("do_objectID"):
            styles[str(local_ss["do_objectID"])] = _extract_style_encoded_attrs(local_ss)
        if fts.get("do_objectID") and str(fts["do_objectID"]) not in styles:
            styles[str(fts["do_objectID"])] = _extract_style_encoded_attrs(
                local_ss if isinstance(local_ss, dict) else fts
            )
    return styles


def _extract_font_and_para_from_attrs(
    attr_dict: Dict[str, Any],
) -> Tuple[Dict[str, Any], Dict[str, Any], Optional[float]]:
    if not isinstance(attr_dict, dict):
        return {}, {}, None
    raw_font = (
        attr_dict.get("MSAttributedStringFontAttribute")
        or attr_dict.get("fontDescriptor")
        or {}
    )
    if isinstance(raw_font, dict) and isinstance(raw_font.get("attributes"), dict):
        f_desc = dict(raw_font["attributes"])
    elif isinstance(raw_font, dict):
        f_desc = dict(raw_font)
    else:
        f_desc = {}
    p_style = (
        dict(attr_dict["paragraphStyle"])
        if isinstance(attr_dict.get("paragraphStyle"), dict)
        else {}
    )
    kern = (
        float(attr_dict["kerning"])
        if attr_dict.get("kerning") is not None
        else None
    )
    return f_desc, p_style, kern


def _extract_text_layer_spec(
    layer: Dict[str, Any],
    shared_text_styles: Optional[Dict[str, Dict[str, Any]]] = None,
    override_style_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
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

    style_encoded = _extract_style_encoded_attrs(layer.get("style") or {})
    shared_sid = str(layer.get("sharedStyleID", "") or "")
    shared_encoded = (
        (shared_text_styles or {}).get(shared_sid, {}) if shared_sid else {}
    )
    override_encoded = (
        (shared_text_styles or {}).get(str(override_style_id), {})
        if override_style_id
        else {}
    )

    font_desc: Dict[str, Any] = {}
    para_style: Dict[str, Any] = {}
    kerning_val: float = 0.0
    # Priority: sharedStyle default -> inline layer.style -> attributedString[0] -> override_style_id
    for candidate_attrs in (shared_encoded, style_encoded, first_attr, override_encoded):
        if not candidate_attrs:
            continue
        fd, ps, kn = _extract_font_and_para_from_attrs(candidate_attrs)
        if fd:
            if fd.get("name") and not fd.get("NSCTFontUIUsageAttribute"):
                font_desc.pop("NSCTFontUIUsageAttribute", None)
            elif fd.get("NSCTFontUIUsageAttribute") and not fd.get("name"):
                font_desc.pop("name", None)
            font_desc.update({k: v for k, v in fd.items() if v is not None})
        if ps:
            para_style.update({k: v for k, v in ps.items() if v is not None})
        if kn is not None:
            kerning_val = kn

    font_name = font_desc.get("name")
    ui_usage = font_desc.get("NSCTFontUIUsageAttribute")
    font_size = float(font_desc.get("size", 14.0))
    line_height = para_style.get("maximumLineHeight") or para_style.get(
        "minimumLineHeight"
    )
    para_spacing = float(para_style.get("paragraphSpacing", 0.0) or 0.0)
    kerning = kerning_val

    runs: List[Dict[str, Any]] = []
    if not override_encoded:
        for attr_entry in attrs_list:
            if not isinstance(attr_entry, dict):
                continue
            loc = int(attr_entry.get("location", 0) or 0)
            length = int(attr_entry.get("length", 0) or 0)
            if length <= 0:
                continue
            sub_attrs = attr_entry.get("attributes") or {}
            sub_font, sub_para, sub_kern = _extract_font_and_para_from_attrs(sub_attrs)
            sub_lh = sub_para.get("maximumLineHeight") or sub_para.get(
                "minimumLineHeight"
            )
            sub_has_name = bool(sub_font.get("name"))
            sub_has_usage = bool(sub_font.get("NSCTFontUIUsageAttribute"))
            if sub_has_name or sub_has_usage:
                run_font_name = sub_font.get("name")
                run_ui_usage = sub_font.get("NSCTFontUIUsageAttribute")
            else:
                run_font_name = font_name
                run_ui_usage = ui_usage
            runs.append(
                {
                    "location": loc,
                    "length": length,
                    "fontName": run_font_name,
                    "uiUsage": run_ui_usage,
                    "fontSize": float(sub_font.get("size", font_size)),
                    "lineHeight": (
                        float(sub_lh)
                        if sub_lh is not None
                        else (float(line_height) if line_height is not None else None)
                    ),
                    "paragraphSpacing": float(
                        sub_para.get("paragraphSpacing", para_spacing) or 0.0
                    ),
                    "kerning": float(sub_kern if sub_kern is not None else kerning),
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
    pages_data: Dict[str, Dict[str, Any]],
    doc_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    masters: Dict[str, Dict[str, Any]] = {}

    def walk(node: Dict[str, Any]) -> None:
        if node.get("_class") == "symbolMaster" and node.get("symbolID"):
            masters[str(node["symbolID"])] = node
        for child in node.get("layers") or []:
            if isinstance(child, dict):
                walk(child)

    if isinstance(doc_data, dict):
        for fsym in doc_data.get("foreignSymbols") or []:
            if not isinstance(fsym, dict):
                continue
            sm = fsym.get("symbolMaster") or fsym.get("originalMaster") or {}
            if isinstance(sm, dict):
                walk(sm)

    for page in pages_data.values():
        walk(page)
    return masters


def _find_layer_by_id(
    root: Dict[str, Any], target_id: str, ox: float = 0.0, oy: float = 0.0
) -> Optional[Tuple[Dict[str, Any], float, float]]:
    is_root = root.get("_class") in ("page", "artboard", "symbolMaster")
    frame = root.get("frame") or {}
    cur_x = 0.0 if is_root else ox + float(frame.get("x", 0.0))
    cur_y = 0.0 if is_root else oy + float(frame.get("y", 0.0))
    if str(root.get("do_objectID", "")) == target_id:
        return root, cur_x, cur_y
    for child in root.get("layers") or []:
        if isinstance(child, dict):
            found = _find_layer_by_id(child, target_id, cur_x, cur_y)
            if found is not None:
                return found
    return None


def _merge_nested_instance_overrides(
    root_master: Dict[str, Any],
    symbol_masters: Dict[str, Dict[str, Any]],
    outer_overrides: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Merge nested symbolInstance default overrideValues under root_master with outer_overrides taking precedence."""
    merged_by_name: Dict[str, Dict[str, Any]] = {}
    swap_map: Dict[str, str] = {}

    for ov in outer_overrides:
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if not ov_name:
            continue
        merged_by_name[ov_name] = ov
        if (
            ov_name.endswith("_symbolID")
            and isinstance(ov.get("value"), str)
            and ov.get("value")
        ):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    def walk_master(
        node: Dict[str, Any],
        prefix: str,
        visited: set[str],
    ) -> None:
        for ch in node.get("layers") or []:
            if not isinstance(ch, dict) or not _participates_in_flex_flow(ch):
                continue
            ch_id = str(ch.get("do_objectID", ""))
            if not ch_id:
                continue
            ch_path = f"{prefix}/{ch_id}" if prefix else ch_id
            ch_cls = ch.get("_class")
            if ch_cls == "symbolInstance":
                eff_sym = swap_map.get(ch_path, str(ch.get("symbolID", "")))
                if not eff_sym or eff_sym.lower() == "none":
                    continue
                for nested_ov in ch.get("overrideValues") or []:
                    if not isinstance(nested_ov, dict):
                        continue
                    raw_name = str(nested_ov.get("overrideName", ""))
                    if not raw_name:
                        continue
                    scoped_name = f"{ch_path}/{raw_name}"
                    if scoped_name not in merged_by_name:
                        scoped_entry = dict(nested_ov)
                        scoped_entry["overrideName"] = scoped_name
                        merged_by_name[scoped_name] = scoped_entry
                        if (
                            scoped_name.endswith("_symbolID")
                            and isinstance(scoped_entry.get("value"), str)
                            and scoped_entry.get("value")
                        ):
                            swap_map[scoped_name[: -len("_symbolID")]] = str(
                                scoped_entry["value"]
                            )
                nested_m = symbol_masters.get(eff_sym)
                if nested_m is not None and eff_sym not in visited:
                    walk_master(nested_m, ch_path, visited | {eff_sym})
            elif ch.get("layers"):
                walk_master(ch, prefix, visited)

    root_sym_id = str(
        root_master.get("symbolID") or root_master.get("do_objectID") or ""
    )
    walk_master(root_master, "", {root_sym_id} if root_sym_id else set())
    return list(merged_by_name.values())


def _collect_master_auto_text_paths(
    master: Dict[str, Any],
    symbol_masters: Dict[str, Dict[str, Any]],
    inst_overrides: List[Dict[str, Any]],
) -> List[str]:
    """Collect override paths for all participating auto-height (textBehaviour == 1) text layers in master."""
    swap_map: Dict[str, str] = {}
    for ov in inst_overrides:
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if ov_name.endswith("_symbolID") and isinstance(ov.get("value"), str):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    auto_paths: List[str] = []

    def walk_master(
        node: Dict[str, Any],
        prefix: str,
        visited: set[str],
    ) -> None:
        for ch in node.get("layers") or []:
            if not isinstance(ch, dict) or not _participates_in_flex_flow(ch):
                continue
            ch_id = str(ch.get("do_objectID", ""))
            if not ch_id:
                continue
            ch_path = f"{prefix}/{ch_id}" if prefix else ch_id
            ch_cls = ch.get("_class")
            if ch_cls == "text" and int(ch.get("textBehaviour", 0) or 0) == 1:
                auto_paths.append(ch_path)
            elif ch_cls == "symbolInstance":
                eff_sym = swap_map.get(ch_path, str(ch.get("symbolID", "")))
                if not eff_sym or eff_sym.lower() == "none":
                    continue
                nested_m = symbol_masters.get(eff_sym)
                if nested_m is not None and eff_sym not in visited:
                    walk_master(nested_m, ch_path, visited | {eff_sym})
            elif ch.get("layers"):
                walk_master(ch, prefix, visited)

    root_sym_id = str(master.get("symbolID") or master.get("do_objectID") or "")
    walk_master(master, "", {root_sym_id} if root_sym_id else set())
    return auto_paths


def _collect_master_static_leaf_intervals(
    master: Dict[str, Any],
    overridden_paths: set[str],
    symbol_masters: Dict[str, Dict[str, Any]],
    inst_overrides: List[Dict[str, Any]],
) -> List[Tuple[float, float, float]]:
    """Collect (abs_y, height, height) for unmodified visible leaf layers in master."""
    swap_map: Dict[str, str] = {}
    for ov in inst_overrides:
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if ov_name.endswith("_symbolID") and isinstance(ov.get("value"), str):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    intervals: List[Tuple[float, float, float]] = []

    def walk_master(
        node: Dict[str, Any],
        prefix: str,
        abs_y: float,
        visited: set[str],
    ) -> None:
        for ch in node.get("layers") or []:
            if not isinstance(ch, dict) or not _participates_in_flex_flow(ch):
                continue
            ch_id = str(ch.get("do_objectID", ""))
            ch_path = f"{prefix}/{ch_id}" if prefix else ch_id
            if ch_path in overridden_paths:
                continue
            ch_frame = ch.get("frame") or {}
            ch_y = abs_y + float(ch_frame.get("y", 0.0))
            ch_h = float(ch_frame.get("height", 0.0))
            ch_cls = ch.get("_class")
            if ch_cls == "symbolInstance":
                eff_sym = swap_map.get(ch_path, str(ch.get("symbolID", "")))
                if not eff_sym or eff_sym.lower() == "none":
                    continue
                nested_m = symbol_masters.get(eff_sym)
                if nested_m is not None and eff_sym not in visited:
                    walk_master(nested_m, ch_path, ch_y, visited | {eff_sym})
                elif ch_h > 0.0:
                    intervals.append((ch_y, ch_h, ch_h))
            elif ch.get("layers"):
                walk_master(ch, prefix, ch_y, visited)
            elif ch_h > 0.0:
                intervals.append((ch_y, ch_h, ch_h))

    root_sym_id = str(master.get("symbolID") or master.get("do_objectID") or "")
    walk_master(master, "", 0.0, {root_sym_id} if root_sym_id else set())
    return intervals


def _simulate_master_tree_height(
    root_master: Dict[str, Any],
    symbol_masters: Dict[str, Dict[str, Any]],
    inst_overrides: List[Dict[str, Any]],
    base_heights_by_path: Dict[str, float],
    target_heights_by_path: Dict[str, float],
) -> Tuple[float, float]:
    """Recursively evaluate (old_height, simulated_height) across root_master's hierarchy, stopping at fixed-height containers."""
    swap_map: Dict[str, str] = {}
    for ov in inst_overrides:
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if (
            ov_name.endswith("_symbolID")
            and isinstance(ov.get("value"), str)
            and ov.get("value")
        ):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    def eval_node(
        node: Dict[str, Any],
        prefix: str,
        visited: set[str],
        is_root: bool = False,
    ) -> Tuple[float, float]:
        frame = node.get("frame") or {}
        node_h = float(frame.get("height", 0.0))
        node_id = str(node.get("do_objectID", ""))
        node_path = (
            ""
            if is_root
            else (f"{prefix}/{node_id}" if (prefix and node_id) else node_id)
        )
        cls = node.get("_class")

        if cls == "text":
            if node_path in target_heights_by_path:
                b_h = float(base_heights_by_path.get(node_path, node_h))
                t_h = float(target_heights_by_path[node_path])
                return b_h, t_h
            return node_h, node_h

        if cls == "symbolInstance":
            eff_sym = swap_map.get(node_path, str(node.get("symbolID", "")))
            if not eff_sym or eff_sym.lower() == "none":
                return node_h, node_h
            nested_m = symbol_masters.get(eff_sym)
            if nested_m is None or eff_sym in visited:
                return node_h, node_h
            m_old_h, m_sim_h = eval_node(
                nested_m, node_path, visited | {eff_sym}, is_root=True
            )
            return node_h, node_h + (m_sim_h - m_old_h)

        raw_children = node.get("layers") or []
        if raw_children:
            layout = node.get("groupLayout") or {}
            is_flex = layout.get("_class") == "MSImmutableFlexGroupLayout"
            if is_flex and int(layout.get("verticalSizing", 1)) == 0:
                return node_h, node_h

            flow_children = [
                ch
                for ch in raw_children
                if isinstance(ch, dict) and _participates_in_flex_flow(ch)
            ]
            if not flow_children:
                return node_h, node_h

            if is_flex:
                flex_dir = int(layout.get("flexDirection", 1))
                child_pairs = [
                    eval_node(ch, prefix, visited, is_root=False)
                    for ch in flow_children
                ]
                if flex_dir == 0:
                    old_c = max(p[0] for p in child_pairs)
                    sim_c = max(p[1] for p in child_pairs)
                else:
                    old_c = sum(p[0] for p in child_pairs)
                    sim_c = sum(p[1] for p in child_pairs)
                return node_h, node_h + (sim_c - old_c)

            iv: List[Tuple[float, float, float]] = []
            for ch in flow_children:
                ch_y = float((ch.get("frame") or {}).get("y", 0.0))
                c_old, c_sim = eval_node(ch, prefix, visited, is_root=False)
                iv.append((ch_y, c_old, c_sim))
            sorted_iv = sorted(iv, key=lambda t: (t[0], -(t[0] + t[1])))
            bands: List[List[Tuple[float, float, float]]] = []
            for y0, old_h, new_h in sorted_iv:
                if not bands:
                    bands.append([(y0, old_h, new_h)])
                    continue
                prev_old_bottom = max(py + p_old for py, p_old, _ in bands[-1])
                if y0 < prev_old_bottom - 0.5:
                    bands[-1].append((y0, old_h, new_h))
                else:
                    bands.append([(y0, old_h, new_h)])
            delta_free = 0.0
            for band in bands:
                old_b = max(py + p_old for py, p_old, _ in band)
                new_b = max(py + p_new for py, _, p_new in band)
                delta_free += new_b - old_b
            return node_h, node_h + delta_free

        return node_h, node_h

    root_sym_id = str(
        root_master.get("symbolID") or root_master.get("do_objectID") or ""
    )
    return eval_node(
        root_master, "", {root_sym_id} if root_sym_id else set(), is_root=True
    )


def _resolve_nested_override_text_target(
    root_master: Dict[str, Any],
    override_path: str,
    symbol_masters: Dict[str, Dict[str, Any]],
    instance_overrides: List[Dict[str, Any]],
    seen_height_prefixes: Optional[set[str]] = None,
) -> Optional[Tuple[Dict[str, Any], float, float, float]]:
    """Resolve a potentially nested override path (<inst-id>/.../<text-id>) to (target_text_layer, abs_y_in_root_master, width_adjust, height_adjust)."""
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
    accum_y = 0.0
    width_adjust = 0.0
    height_adjust = 0.0
    for idx, seg_id in enumerate(segments):
        found_res = _find_layer_by_id(cur_master, seg_id)
        if found_res is None:
            return None
        found, _seg_x, seg_y = found_res
        accum_y += seg_y
        if idx < len(segments) - 1:
            if found.get("_class") != "symbolInstance":
                return None
            prefix = "/".join(segments[: idx + 1])
            next_sym_id = swap_map.get(prefix) or str(found.get("symbolID", ""))
            if not next_sym_id or next_sym_id.lower() == "none":
                return None
            next_master = symbol_masters.get(next_sym_id)
            if next_master is None:
                return None
            found_frame = found.get("frame") or {}
            next_m_frame = next_master.get("frame") or {}
            inst_w = float(found_frame.get("width", next_m_frame.get("width", 0.0)))
            next_m_w = float(next_m_frame.get("width", inst_w))
            width_adjust += inst_w - next_m_w
            if seen_height_prefixes is None or prefix not in seen_height_prefixes:
                if seen_height_prefixes is not None:
                    seen_height_prefixes.add(prefix)
                inst_h = float(
                    found_frame.get("height", next_m_frame.get("height", 0.0))
                )
                next_m_h = float(next_m_frame.get("height", inst_h))
                height_adjust += inst_h - next_m_h
            cur_master = next_master
        else:
            return found, accum_y, width_adjust, height_adjust
    return None


def _resolve_nested_override_text_layer(
    root_master: Dict[str, Any],
    override_path: str,
    symbol_masters: Dict[str, Dict[str, Any]],
    instance_overrides: List[Dict[str, Any]],
) -> Optional[Tuple[Dict[str, Any], float]]:
    """Resolve a potentially nested override path (<inst-id>/.../<text-id>) to (target_text_layer, abs_y_in_root_master)."""
    res = _resolve_nested_override_text_target(
        root_master, override_path, symbol_masters, instance_overrides
    )
    if res is None:
        return None
    found, accum_y, _w_adj, _h_adj = res
    return found, accum_y


def _participates_in_flex_flow(child: Dict[str, Any]) -> bool:
    flex_item = child.get("flexItem") or {}
    if bool(flex_item.get("ignoresStackLayout", False)):
        return False
    if bool(child.get("isVisible", True)):
        return True
    return bool(flex_item.get("preserveSpaceWhenHidden", False))


def _reflow_vertical_flex_group(group: Dict[str, Any]) -> float:
    """Re-pack a vertical or horizontal MSImmutableFlexGroupLayout in Sketch's reversed index order."""
    layout = group.get("groupLayout") or {}
    if layout.get("_class") != "MSImmutableFlexGroupLayout":
        return 0.0
    flex_dir = int(layout.get("flexDirection", 1))
    if flex_dir not in (0, 1):
        return 0.0

    has_ind = bool(layout.get("hasIndividualPadding", False))
    base_pad = float(layout.get("padding", 0.0) or 0.0)
    top_pad = float(layout.get("topPadding", base_pad) if has_ind else base_pad)
    bottom_pad = float(layout.get("bottomPadding", base_pad) if has_ind else base_pad)
    gap = float(layout.get("allGuttersGap", 0.0) or 0.0)
    justify = int(layout.get("justifyContent", 0) or 0)
    align_items = int(layout.get("alignItems", 0) or 0)
    vertical_sizing = int(layout.get("verticalSizing", 1))

    children = [
        ch
        for ch in (group.get("layers") or [])
        if isinstance(ch, dict) and _participates_in_flex_flow(ch)
    ]
    visual_children = list(reversed(children))
    n = len(visual_children)
    if n == 0:
        return 0.0

    g_frame = group.get("frame")
    if flex_dir == 0:
        max_child_h = max(
            float((ch.get("frame") or {}).get("height", 0.0)) for ch in visual_children
        )
        new_row_h = round(top_pad + max_child_h + bottom_pad, 2)
        old_row_h = float((g_frame or {}).get("height", 0.0))
        if isinstance(g_frame, dict) and vertical_sizing == 1:
            g_frame["height"] = new_row_h
        container_h = float((g_frame or {}).get("height", new_row_h))
        inner_h = max(0.0, container_h - top_pad - bottom_pad)
        for child in visual_children:
            c_frame = child.get("frame")
            if isinstance(c_frame, dict):
                ch_h = float(c_frame.get("height", 0.0))
                if align_items == 0:
                    c_frame["y"] = round(top_pad, 2)
                elif align_items == 1:
                    c_frame["y"] = round(top_pad + (inner_h - ch_h) / 2.0, 2)
                elif align_items == 2:
                    c_frame["y"] = round(container_h - bottom_pad - ch_h, 2)
                elif align_items == 3:
                    c_frame["y"] = round(top_pad, 2)
                    is_auto_text = child.get("_class") == "text" and int(
                        child.get("textBehaviour", 0) or 0
                    ) in (0, 1)
                    if not is_auto_text:
                        c_frame["height"] = round(inner_h, 2)
                        if (child.get("groupLayout") or {}).get(
                            "_class"
                        ) == "MSImmutableFlexGroupLayout":
                            _reflow_vertical_flex_group(child)
        if isinstance(g_frame, dict) and vertical_sizing == 1:
            return new_row_h - old_row_h
        return 0.0

    children_total_h = sum(
        float((ch.get("frame") or {}).get("height", 0.0)) for ch in visual_children
    )
    content_h = children_total_h + gap * max(0, n - 1)

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


def _reflow_freeform_group_for_child(
    group: Dict[str, Any],
    target_child: Dict[str, Any],
    old_child_h: float,
    new_child_h: float,
) -> Tuple[float, float]:
    """Update a non-Flex group's child vertical coordinates and bounding height to match _simulate_master_tree_height."""
    g_frame = group.get("frame")
    if not isinstance(g_frame, dict):
        return 0.0, 0.0
    old_group_h = float(g_frame.get("height", 0.0))
    if abs(new_child_h - old_child_h) <= 0.01:
        return old_group_h, old_group_h

    flow_children = [
        ch
        for ch in (group.get("layers") or [])
        if isinstance(ch, dict) and _participates_in_flex_flow(ch)
    ]
    if not flow_children:
        return old_group_h, old_group_h

    iv: List[Tuple[Dict[str, Any], float, float, float]] = []
    for ch in flow_children:
        cf = ch.get("frame") or {}
        cy = float(cf.get("y", 0.0))
        if ch is target_child:
            iv.append((ch, cy, old_child_h, new_child_h))
        else:
            ch_h = float(cf.get("height", 0.0))
            iv.append((ch, cy, ch_h, ch_h))

    sorted_iv = sorted(iv, key=lambda t: (t[1], -(t[1] + t[2])))
    bands: List[List[Tuple[Dict[str, Any], float, float, float]]] = []
    for item in sorted_iv:
        _, y0, old_h, _ = item
        if not bands:
            bands.append([item])
            continue
        prev_old_bottom = max(py + p_old for _, py, p_old, _ in bands[-1])
        if y0 < prev_old_bottom - 0.5:
            bands[-1].append(item)
        else:
            bands.append([item])

    accum_shift = 0.0
    for band in bands:
        if abs(accum_shift) > 0.01:
            for ch, _, _, _ in band:
                cf = ch.get("frame")
                if isinstance(cf, dict):
                    cf["y"] = round(float(cf.get("y", 0.0)) + accum_shift, 2)
        old_b = max(py + p_old for _, py, p_old, _ in band)
        new_b = max(py + p_new for _, py, _, p_new in band)
        accum_shift += new_b - old_b

    new_group_h = round(max(1.0, old_group_h + accum_shift), 2)
    g_frame["height"] = new_group_h
    return old_group_h, new_group_h


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


MAX_ZIP_MEMBERS = 4096
MAX_ZIP_SINGLE_MEMBER_BYTES = 64 * 1024 * 1024
MAX_ZIP_JSON_MEMBER_BYTES = 32 * 1024 * 1024
MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
MAX_ZIP_COMPRESSION_RATIO = 100.0


def _validate_zip_archive_budget(zf: zipfile.ZipFile) -> List[zipfile.ZipInfo]:
    """Validate ZIP member count, per-member size, total uncompressed size, and compression ratio before reading."""
    infolist = zf.infolist()
    if len(infolist) > MAX_ZIP_MEMBERS:
        raise RuntimeError(
            f"Archive exceeds maximum member count ({len(infolist)} > {MAX_ZIP_MEMBERS})"
        )
    total_uncompressed = 0
    for info in infolist:
        parts = Path(info.filename).parts
        if ".." in parts or info.filename.startswith("/"):
            raise RuntimeError(f"Unsafe ZIP member path in archive: {info.filename}")
        fsize = int(info.file_size or 0)
        csize = int(info.compress_size or 0)
        if fsize < 0 or fsize > MAX_ZIP_SINGLE_MEMBER_BYTES:
            raise RuntimeError(
                f"ZIP member '{info.filename}' exceeds single-member size limit ({fsize} > {MAX_ZIP_SINGLE_MEMBER_BYTES})"
            )
        if fsize > 65536 and fsize > max(1, csize) * MAX_ZIP_COMPRESSION_RATIO:
            raise RuntimeError(
                f"ZIP member '{info.filename}' exceeds compression ratio limit ({fsize} / {max(1, csize)} > {MAX_ZIP_COMPRESSION_RATIO})"
            )
        total_uncompressed += fsize
        if total_uncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES:
            raise RuntimeError(
                f"Archive exceeds total uncompressed size budget ({total_uncompressed} > {MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES})"
            )
    return infolist


def _read_zip_member_bounded(
    zf: zipfile.ZipFile,
    member_name: str,
    max_bytes: int = MAX_ZIP_JSON_MEMBER_BYTES,
) -> bytes:
    """Stream-read a ZIP member with strict uncompressed size and compression-ratio enforcement."""
    info = zf.getinfo(member_name)
    csize = max(1, int(info.compress_size or 0))
    if int(info.file_size or 0) > max_bytes:
        raise RuntimeError(
            f"ZIP member '{member_name}' declared size ({info.file_size}) exceeds limit ({max_bytes})"
        )
    chunks: List[bytes] = []
    total = 0
    with zf.open(info, "r") as mfh:
        while True:
            chunk = mfh.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(
                    f"ZIP member '{member_name}' decompressed size exceeds limit ({max_bytes})"
                )
            if total > 65536 and total > csize * MAX_ZIP_COMPRESSION_RATIO:
                raise RuntimeError(
                    f"ZIP member '{member_name}' decompressed ratio exceeds limit ({MAX_ZIP_COMPRESSION_RATIO}x)"
                )
            chunks.append(chunk)
    return b"".join(chunks)


def _read_sketch_json_members(zf: zipfile.ZipFile) -> Dict[str, bytes]:
    """Validate archive budget and load only required JSON members (document.json and pages/*.json)."""
    infolist = _validate_zip_archive_budget(zf)
    members: Dict[str, bytes] = {}
    for info in infolist:
        name = info.filename
        if name == "document.json" or (
            name.startswith("pages/") and name.endswith(".json")
        ):
            members[name] = _read_zip_member_bounded(
                zf, name, max_bytes=MAX_ZIP_JSON_MEMBER_BYTES
            )
    return members


def _stream_copy_zip_member_bounded(
    zf_in: zipfile.ZipFile,
    info: zipfile.ZipInfo,
    zout: zipfile.ZipFile,
    running_total: int,
) -> int:
    """Stream-copy an unmodified ZIP member into zout with strict size and compression-ratio limits."""
    csize = max(1, int(info.compress_size or 0))
    member_total = 0
    with zf_in.open(info, "r") as src_m, zout.open(info.filename, "w") as dst_m:
        while True:
            buf = src_m.read(65536)
            if not buf:
                break
            member_total += len(buf)
            running_total += len(buf)
            if member_total > MAX_ZIP_SINGLE_MEMBER_BYTES:
                raise RuntimeError(
                    f"ZIP member '{info.filename}' exceeds single-member size limit during stream copy"
                )
            if (
                member_total > 65536
                and member_total > csize * MAX_ZIP_COMPRESSION_RATIO
            ):
                raise RuntimeError(
                    f"ZIP member '{info.filename}' exceeds compression ratio limit during stream copy"
                )
            if running_total > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES:
                raise RuntimeError(
                    "Archive exceeds total uncompressed size budget during stream copy"
                )
            dst_m.write(buf)
    return running_total


def audit_and_rebake_sketch(
    sketch_path: Path,
    rebake: bool = False,
    swift_bin: Optional[str] = None,
) -> Dict[str, Any]:
    if not sketch_path.exists():
        raise FileNotFoundError(f".sketch file not found: {sketch_path}")

    rebake_dir_fd: Optional[int] = None
    sketch_leaf: str = sketch_path.name
    initial_sketch_stat: Optional[os.stat_result] = None
    try:
        if rebake:
            rebake_dir_fd, sketch_leaf = _open_pinned_parent_dir(
                sketch_path, create=False, require_user_owned_parent=True
            )
            initial_sketch_stat = _validate_existing_in_dir_fd(
                rebake_dir_fd, sketch_leaf, sketch_path
            )
            if initial_sketch_stat is None:
                raise FileNotFoundError(f".sketch file not found: {sketch_path}")
            src_fd = os.open(
                sketch_leaf,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=rebake_dir_fd,
            )
            with os.fdopen(src_fd, "rb") as src_fh:
                with zipfile.ZipFile(src_fh, "r") as zf:
                    members = _read_sketch_json_members(zf)
        else:
            with zipfile.ZipFile(sketch_path, "r") as zf:
                members = _read_sketch_json_members(zf)
        return _audit_and_rebake_members(
            sketch_path=sketch_path,
            members=members,
            rebake=rebake,
            swift_bin=swift_bin,
            rebake_dir_fd=rebake_dir_fd,
            sketch_leaf=sketch_leaf,
            initial_sketch_stat=initial_sketch_stat,
        )
    finally:
        if rebake_dir_fd is not None:
            try:
                os.close(rebake_dir_fd)
            except OSError:
                pass


def _audit_and_rebake_members(
    sketch_path: Path,
    members: Dict[str, bytes],
    rebake: bool = False,
    swift_bin: Optional[str] = None,
    rebake_dir_fd: Optional[int] = None,
    sketch_leaf: str = "",
    initial_sketch_stat: Optional[os.stat_result] = None,
) -> Dict[str, Any]:
    doc_data: Dict[str, Any] = {}
    if "document.json" in members:
        doc_data = json.loads(members["document.json"].decode("utf-8"))

    pages_data: Dict[str, Dict[str, Any]] = {}
    for name, raw in members.items():
        if name.startswith("pages/") and name.endswith(".json"):
            pages_data[name] = json.loads(raw.decode("utf-8"))

    symbol_masters = _index_symbol_masters(pages_data, doc_data)
    shared_text_styles = _index_shared_text_styles(doc_data)

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
        spec = _extract_text_layer_spec(node, shared_text_styles)
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
                raw_inst_overrides = node.get("overrideValues") or []
                inst_overrides = _merge_nested_instance_overrides(
                    master, symbol_masters, raw_inst_overrides
                )
                inst_frame = node.get("frame") or {}
                m_frame = master.get("frame") or {}
                override_entries: List[Dict[str, Any]] = []
                path_overrides: Dict[str, Dict[str, Any]] = {}
                for ov in inst_overrides:
                    if not isinstance(ov, dict):
                        continue
                    ov_name = str(ov.get("overrideName", ""))
                    if ov_name.endswith("_stringValue"):
                        ov_path = ov_name[: -len("_stringValue")]
                        entry = path_overrides.setdefault(ov_path, {})
                        entry["stringValue"] = str(ov.get("value", ""))
                        entry.setdefault("primaryOverrideName", ov_name)
                    elif ov_name.endswith("_textStyle"):
                        ov_path = ov_name[: -len("_textStyle")]
                        entry = path_overrides.setdefault(ov_path, {})
                        entry["textStyleID"] = str(ov.get("value", ""))
                        entry.setdefault("primaryOverrideName", ov_name)

                for auto_path in _collect_master_auto_text_paths(
                    master, symbol_masters, inst_overrides
                ):
                    if auto_path not in path_overrides:
                        path_overrides[auto_path] = {
                            "primaryOverrideName": f"{auto_path}_defaultText"
                        }

                seen_height_prefixes: set[str] = set()
                for override_path, ov_info in path_overrides.items():
                    resolved_target = _resolve_nested_override_text_target(
                        master,
                        override_path,
                        symbol_masters,
                        inst_overrides,
                        seen_height_prefixes=seen_height_prefixes,
                    )
                    if resolved_target is None:
                        continue
                    master_text, master_text_y, width_adjust, height_adjust = (
                        resolved_target
                    )
                    m_spec = _extract_text_layer_spec(
                        master_text,
                        shared_text_styles,
                        override_style_id=ov_info.get("textStyleID"),
                    )
                    if m_spec is None:
                        continue
                    eff_text_w_in_master = max(
                        1.0, float(m_spec["width"]) + width_adjust
                    )
                    scale_w = float(
                        inst_frame.get("width", eff_text_w_in_master)
                    ) - (
                        float(m_frame.get("width", eff_text_w_in_master))
                        - eff_text_w_in_master
                    )
                    ov_name = str(ov_info["primaryOverrideName"])
                    ov_id = f"{node.get('do_objectID')}::{ov_name}"
                    ov_spec = dict(m_spec)
                    if "stringValue" in ov_info or "textStyleID" in ov_info:
                        ov_spec.pop("runs", None)
                    ov_spec["id"] = ov_id
                    if "stringValue" in ov_info:
                        ov_spec["text"] = str(ov_info["stringValue"])
                    ov_spec["width"] = max(1.0, scale_w)
                    measure_queue.append(ov_spec)
                    override_entries.append(
                        {
                            "overridePath": override_path,
                            "overrideName": ov_name,
                            "spec": ov_spec,
                            "masterTextY": float(master_text_y),
                            "masterTextBaseHeight": max(
                                1.0, float(m_spec["currentHeight"]) + height_adjust
                            ),
                        }
                    )
                if override_entries:
                    m_layout = master.get("groupLayout") or {}
                    master_fixed_vert = (
                        m_layout.get("_class") == "MSImmutableFlexGroupLayout"
                        and int(m_layout.get("verticalSizing", 1)) == 0
                    )
                    master_fit_vert = (
                        m_layout.get("_class") == "MSImmutableFlexGroupLayout"
                        and int(m_layout.get("verticalSizing", 1)) == 1
                    )
                    master_is_horiz_flex = (
                        m_layout.get("_class") == "MSImmutableFlexGroupLayout"
                        and int(m_layout.get("flexDirection", 0)) == 0
                    )
                    static_intervals = _collect_master_static_leaf_intervals(
                        master,
                        set(path_overrides.keys()),
                        symbol_masters,
                        inst_overrides,
                    )
                    targets_meta.append(
                        {
                            "kind": "symbolInstanceOverride",
                            "pageFile": page_file,
                            "artboard": cur_artboard,
                            "node": node,
                            "master": master,
                            "instOverrides": inst_overrides,
                            "ancestors": list(ancestors),
                            "overrides": override_entries,
                            "staticIntervals": static_intervals,
                            "masterFixedVertical": master_fixed_vert,
                            "masterFitVertical": master_fit_vert,
                            "masterIsHorizontalFlex": master_is_horiz_flex,
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
    for fsym in doc_data.get("foreignSymbols") or []:
        if not isinstance(fsym, dict):
            continue
        sm = fsym.get("symbolMaster") or fsym.get("originalMaster")
        if isinstance(sm, dict):
            scan_node("document.json", sm, sm, [doc_data, fsym])

    batch_report = measure_specs(measure_queue, swift_bin=swift_bin)
    measured_by_id = {item["id"]: item for item in batch_report.get("results", [])}

    drifts: List[Dict[str, Any]] = []
    rebaked_layers: List[Dict[str, Any]] = []
    dirty_pages: set[str] = set()
    pending_rebakes: List[Tuple[Dict[str, Any], Dict[str, Any], float]] = []

    # Phase 1: Compute all expected heights against the unmodified initial master tree
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
            ov_details = []
            resolved_ps = ""
            total_lines = 0
            base_heights_by_path: Dict[str, float] = {}
            measured_heights_by_path: Dict[str, float] = {}
            for ov_entry in meta["overrides"]:
                ov_spec = ov_entry["spec"]
                m_res = measured_by_id.get(ov_spec["id"])
                if m_res is None:
                    continue
                base_h = float(ov_entry["masterTextBaseHeight"])
                meas_h = float(m_res["bakedHeight"])
                delta_text = meas_h - base_h
                ov_path = str(ov_entry.get("overridePath") or "")
                if ov_path:
                    base_heights_by_path[ov_path] = base_h
                    measured_heights_by_path[ov_path] = meas_h
                total_lines += int(m_res["lineCount"])
                resolved_ps = m_res["resolvedPostScriptName"]
                ov_details.append(
                    {
                        "overrideName": ov_entry["overrideName"],
                        "specID": ov_spec["id"],
                        "masterTextBaseHeight": base_h,
                        "measuredTextHeight": meas_h,
                        "deltaTextHeight": round(delta_text, 2),
                    }
                )
            if not ov_details:
                continue
            if meta.get("masterFixedVertical"):
                expected_h = round(current_h, 2)
            else:
                master_node = meta.get("master")
                if isinstance(master_node, dict):
                    sim_old_h, sim_new_h = _simulate_master_tree_height(
                        master_node,
                        symbol_masters,
                        meta.get("instOverrides") or [],
                        base_heights_by_path,
                        measured_heights_by_path,
                    )
                    total_delta_text = sim_new_h - sim_old_h
                else:
                    total_delta_text = 0.0
                if not meta.get("masterFitVertical") and abs(total_delta_text) <= 0.01:
                    expected_h = round(current_h, 2)
                else:
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
            pending_rebakes.append((meta, drift_record, expected_h))

    # Phase 2: Apply rebake mutations after all heights have been simulated
    if rebake:
        for meta, drift_record, expected_h in pending_rebakes:
            node = meta["node"]
            frame = node.get("frame") or {}
            old_node_h = float(frame.get("height", 0.0))
            artboard = meta["artboard"]
            before_rects = (
                _collect_artboard_rects(artboard) if artboard is not None else {}
            )
            frame["height"] = expected_h
            cur_child = node
            cur_old_h = old_node_h
            cur_new_h = expected_h
            for anc in reversed(meta["ancestors"]):
                anc_layout = anc.get("groupLayout") or {}
                if anc_layout.get("_class") == "MSImmutableFlexGroupLayout":
                    anc_frame = anc.get("frame") or {}
                    old_anc_h = float(anc_frame.get("height", 0.0))
                    _reflow_vertical_flex_group(anc)
                    new_anc_h = float(anc_frame.get("height", old_anc_h))
                    cur_child = anc
                    cur_old_h = old_anc_h
                    cur_new_h = new_anc_h
                elif anc.get("_class") == "group":
                    old_anc_h, new_anc_h = _reflow_freeform_group_for_child(
                        anc, cur_child, cur_old_h, cur_new_h
                    )
                    cur_child = anc
                    cur_old_h = old_anc_h
                    cur_new_h = new_anc_h
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

    if rebake and dirty_pages and rebake_dir_fd is not None:
        for page_file in dirty_pages:
            if page_file == "document.json":
                members["document.json"] = (
                    json.dumps(doc_data, ensure_ascii=False, indent=2) + "\n"
                ).encode("utf-8")
            elif page_file in pages_data:
                members[page_file] = (
                    json.dumps(pages_data[page_file], ensure_ascii=False, indent=2)
                    + "\n"
                ).encode("utf-8")
        fd, tmp_name = _create_temp_in_dir_fd(
            rebake_dir_fd, f".{sketch_leaf}.rebake-", ".tmp", mode=0o600
        )
        try:
            src_copy_fd = os.open(
                sketch_leaf,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=rebake_dir_fd,
            )
            with os.fdopen(src_copy_fd, "rb") as src_copy_fh, os.fdopen(
                fd, "w+b"
            ) as tmp_fh:
                with zipfile.ZipFile(src_copy_fh, "r") as zf_in, zipfile.ZipFile(
                    tmp_fh, "w", compression=zipfile.ZIP_DEFLATED
                ) as zout:
                    infolist = _validate_zip_archive_budget(zf_in)
                    running_total = 0
                    for info in infolist:
                        name = info.filename
                        if name in members:
                            raw = members[name]
                            running_total += len(raw)
                            if running_total > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES:
                                raise RuntimeError(
                                    "Archive exceeds total uncompressed size budget during rebake write"
                                )
                            zout.writestr(name, raw)
                        else:
                            running_total = _stream_copy_zip_member_bounded(
                                zf_in, info, zout, running_total
                            )
                tmp_fh.flush()
                os.fsync(tmp_fh.fileno())
                tmp_fh.seek(0)
                with zipfile.ZipFile(tmp_fh, "r") as zcheck:
                    _validate_zip_archive_budget(zcheck)
                    if zcheck.testzip() is not None:
                        raise RuntimeError(
                            "Rebaked temporary archive failed ZIP integrity check"
                        )
            cur_stat = _validate_existing_in_dir_fd(
                rebake_dir_fd, sketch_leaf, sketch_path
            )
            if (
                cur_stat is None
                or initial_sketch_stat is None
                or (cur_stat.st_dev, cur_stat.st_ino)
                != (initial_sketch_stat.st_dev, initial_sketch_stat.st_ino)
            ):
                raise RuntimeError(
                    f"Target .sketch file changed during rebake: {sketch_path}"
                )
            os.replace(
                tmp_name,
                sketch_leaf,
                src_dir_fd=rebake_dir_fd,
                dst_dir_fd=rebake_dir_fd,
            )
            tmp_name = ""
        finally:
            if tmp_name:
                try:
                    os.unlink(tmp_name, dir_fd=rebake_dir_fd)
                except OSError:
                    pass

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
            _write_text_nofollow(Path(args.output), out_str + "\n")
        print(out_str)
        return 2

    out_str = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        _write_text_nofollow(Path(args.output), out_str + "\n")
    print(out_str)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
