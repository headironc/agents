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

from sketch_archive import (
    MAX_ZIP_JSON_MEMBER_BYTES,
    MAX_ZIP_TOTAL_JSON_BYTES,
    parse_archive_json as _loads_json_bounded,
)
from sketch_layers import is_artboard
from sketch_json import (
    MAX_JSON_BYTES,
    new_budget as _new_dom_budget,
    read_json,
)

from sketch_text import (
    index_shared_text_styles as _index_shared_text_styles,
    resolve_text_style,
)


SCRIPT_DIR = Path(__file__).resolve().parent
SWIFT_SOURCE = SCRIPT_DIR / "measure-coretext.swift"
MAX_MEASURE_SPECS = 8192
MAX_SYMBOL_EXPANSION_STEPS = 50000
# A one-unit line can produce one result record. Bound total result cardinality,
# rich-text line/run comparisons, and JSON storage independently of DOM size.
MAX_MEASURE_TEXT_UNITS = 128 * 1024
MAX_MEASURE_RUNS = 16384
MAX_MEASURE_STYLE_WORK = 8 * 1024 * 1024
MAX_MEASURE_JSON_BYTES = MAX_JSON_BYTES
MAX_MEASURE_LINES = 32768


class MeasurementBudget:
    def __init__(self) -> None:
        self.specs = 0
        self.text_units = 0
        self.runs = 0
        self.style_work = 0
        self.json_bytes = 0
        self.minimum_lines = 0

    def reserve(self, text: str, run_count: int) -> None:
        # Check before encoding or constructing per-instance rich-text runs.
        if len(text) > MAX_MEASURE_TEXT_UNITS:
            raise RuntimeError("CoreText measurement text exceeds UTF-16 unit budget")
        units = len(text.encode("utf-16-le")) // 2
        self.specs += 1
        self.text_units += units
        self.runs += run_count
        self.minimum_lines += text.count("\n") + 1
        self.style_work += max(1, units) * max(1, run_count)
        if self.specs > MAX_MEASURE_SPECS:
            raise RuntimeError("CoreText measurement spec count exceeds limit")
        if self.text_units > MAX_MEASURE_TEXT_UNITS:
            raise RuntimeError("CoreText measurement text exceeds UTF-16 unit budget")
        if self.runs > MAX_MEASURE_RUNS:
            raise RuntimeError("CoreText measurement rich-text run count exceeds limit")
        if self.minimum_lines > MAX_MEASURE_LINES:
            raise RuntimeError("CoreText measurement line count exceeds limit")
        if self.style_work > MAX_MEASURE_STYLE_WORK:
            raise RuntimeError("CoreText measurement line/run workload exceeds limit")

    def reserve_json(self, spec: Dict[str, Any]) -> None:
        # A JSON character needs at most six escaped bytes. Account for repeated
        # references each time they will be serialized; never use identity dedup.
        pending: List[Any] = [spec]
        while pending:
            value = pending.pop()
            self.json_bytes += 64
            if isinstance(value, str):
                self.json_bytes += 6 * len(value)
            elif isinstance(value, dict):
                pending.extend(value.keys())
                pending.extend(value.values())
            elif isinstance(value, list):
                pending.extend(value)
            if self.json_bytes > MAX_MEASURE_JSON_BYTES:
                raise RuntimeError("CoreText measurement JSON payload exceeds byte budget")


def _charge_expansion_step(
    expansion_budget: Optional[Dict[str, int]],
    count: int = 1,
) -> None:
    if expansion_budget is None:
        return
    expansion_budget["steps"] = int(expansion_budget.get("steps", 0)) + count
    if expansion_budget["steps"] > MAX_SYMBOL_EXPANSION_STEPS:
        raise RuntimeError(
            f"Symbol instance expansion step count ({expansion_budget['steps']}) exceeds limit ({MAX_SYMBOL_EXPANSION_STEPS})"
        )


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
    if len(items) > MAX_MEASURE_SPECS:
        raise RuntimeError(
            f"CoreText measurement spec count ({len(items)}) exceeds limit ({MAX_MEASURE_SPECS})"
        )
    if not items:
        return {
            "tool": "coretext_measure.py",
            "engine": "macOS-CoreText-CTTypesetter",
            "count": 0,
            "results": [],
        }

    unique_items: List[Dict[str, Any]] = []
    key_to_canon_id: Dict[str, str] = {}
    item_id_to_canon_id: List[Tuple[str, str]] = []
    budget = MeasurementBudget()
    for idx, spec in enumerate(items):
        budget.reserve(str(spec.get("text", "")), len(spec.get("runs") or []))
        budget.reserve_json(spec)
        spec_id = str(spec.get("id", f"item-{idx}"))
        dedup_payload = {
            "text": spec.get("text", ""),
            "fontName": spec.get("fontName"),
            "uiUsage": spec.get("uiUsage"),
            "fontSize": spec.get("fontSize"),
            "lineHeight": spec.get("lineHeight"),
            "width": spec.get("width"),
            "paragraphSpacing": spec.get("paragraphSpacing"),
            "kerning": spec.get("kerning"),
            "textBehaviour": spec.get("textBehaviour"),
            "runs": spec.get("runs"),
        }
        dedup_key = json.dumps(dedup_payload, sort_keys=True, ensure_ascii=False)
        canon_id = key_to_canon_id.get(dedup_key)
        if canon_id is None:
            canon_id = f"__canon_{len(unique_items)}__"
            key_to_canon_id[dedup_key] = canon_id
            canon_spec = dict(spec)
            canon_spec["id"] = canon_id
            unique_items.append(canon_spec)
        item_id_to_canon_id.append((spec_id, canon_id))

    if swift_bin:
        cmd = [swift_bin, str(SWIFT_SOURCE)]
    else:
        binary = _get_or_compile_swift_binary()
        cmd = [str(binary)] if binary else ["swift", str(SWIFT_SOURCE)]

    proc = subprocess.run(
        cmd + ["--input", "-"],
        input=json.dumps(unique_items, ensure_ascii=False),
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
    canon_by_id = {
        str(res.get("id", "")): res
        for res in parsed["results"]
        if isinstance(res, dict)
    }
    expected_ids = {str(item["id"]) for item in unique_items}
    if (
        set(canon_by_id) != expected_ids
        or len(parsed["results"]) != len(expected_ids)
        or parsed.get("count") != len(expected_ids)
    ):
        raise RuntimeError("Native macOS CoreText returned incomplete or duplicate measurements.")
    expanded_results: List[Dict[str, Any]] = []
    for spec_id, canon_id in item_id_to_canon_id:
        canon_res = canon_by_id.get(canon_id)
        if canon_res is not None:
            cloned = dict(canon_res)
            cloned["id"] = spec_id
            expanded_results.append(cloned)
    parsed["count"] = len(expanded_results)
    parsed["results"] = expanded_results
    return parsed


def _extract_text_layer_spec(
    layer: Dict[str, Any],
    shared_text_styles: Optional[Dict[str, Dict[str, Any]]] = None,
    override_style_id: Optional[str] = None,
    text_override: Optional[str] = None,
    budget: Optional[MeasurementBudget] = None,
) -> Optional[Dict[str, Any]]:
    if layer.get("_class") != "text" or int(layer.get("textBehaviour", 0)) != 1:
        return None
    frame = layer.get("frame") or {}
    width = float(frame.get("width", 0.0))
    if width <= 0:
        return None
    attr_str = layer.get("attributedString") or {}
    text = str(attr_str.get("string", "")) if text_override is None else text_override
    include_runs = text_override is None and not override_style_id
    if budget is not None:
        budget.reserve(text, len(attr_str.get("attributes") or []) if include_runs else 0)
    spec = {
        "id": str(layer.get("do_objectID", "")),
        "name": str(layer.get("name", "")),
        "text": text,
        "width": width,
        "currentHeight": float(frame.get("height", 0.0)),
        **resolve_text_style(layer, shared_text_styles, override_style_id, include_runs),
    }
    if budget is not None:
        budget.reserve_json(spec)
    return spec


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
    root: Dict[str, Any],
    target_id: str,
    ox: float = 0.0,
    oy: float = 0.0,
    expansion_budget: Optional[Dict[str, int]] = None,
) -> Optional[Tuple[Dict[str, Any], float, float]]:
    _charge_expansion_step(expansion_budget, 1)
    is_root = root.get("_class") in ("page", "artboard", "symbolMaster")
    frame = root.get("frame") or {}
    cur_x = 0.0 if is_root else ox + float(frame.get("x", 0.0))
    cur_y = 0.0 if is_root else oy + float(frame.get("y", 0.0))
    if str(root.get("do_objectID", "")) == target_id:
        return root, cur_x, cur_y
    for child in root.get("layers") or []:
        if isinstance(child, dict):
            found = _find_layer_by_id(
                child, target_id, cur_x, cur_y, expansion_budget=expansion_budget
            )
            if found is not None:
                return found
    return None


def _merge_nested_instance_overrides(
    root_master: Dict[str, Any],
    symbol_masters: Dict[str, Dict[str, Any]],
    outer_overrides: List[Dict[str, Any]],
    expansion_budget: Optional[Dict[str, int]] = None,
) -> List[Dict[str, Any]]:
    """Merge nested symbolInstance default overrideValues under root_master with outer_overrides taking precedence."""
    merged_by_name: Dict[str, Dict[str, Any]] = {}
    swap_map: Dict[str, str] = {}

    for ov in outer_overrides:
        _charge_expansion_step(expansion_budget, 1)
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if not ov_name:
            continue
        merged_by_name[ov_name] = ov
        if ov_name.endswith("_symbolID") and isinstance(ov.get("value"), str):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    def walk_master(
        node: Dict[str, Any],
        prefix: str,
        visited: set[str],
    ) -> None:
        _charge_expansion_step(expansion_budget, 1)
        for ch in node.get("layers") or []:
            _charge_expansion_step(expansion_budget, 1)
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
                    _charge_expansion_step(expansion_budget, 1)
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
                        if scoped_name.endswith("_symbolID") and isinstance(
                            scoped_entry.get("value"), str
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
    expansion_budget: Optional[Dict[str, int]] = None,
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
        _charge_expansion_step(expansion_budget, 1)
        for ch in node.get("layers") or []:
            _charge_expansion_step(expansion_budget, 1)
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
    expansion_budget: Optional[Dict[str, int]] = None,
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
        _charge_expansion_step(expansion_budget, 1)
        for ch in node.get("layers") or []:
            _charge_expansion_step(expansion_budget, 1)
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
    expansion_budget: Optional[Dict[str, int]] = None,
) -> Tuple[float, float]:
    """Recursively evaluate (old_height, simulated_height) across root_master's hierarchy, stopping at non-Fit containers."""
    swap_map: Dict[str, str] = {}
    for ov in inst_overrides:
        if not isinstance(ov, dict):
            continue
        ov_name = str(ov.get("overrideName", ""))
        if ov_name.endswith("_symbolID") and isinstance(ov.get("value"), str):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    def is_child_active(ch: Dict[str, Any], prefix: str) -> Tuple[bool, bool]:
        if ch.get("_class") != "symbolInstance":
            return True, True
        ch_id = str(ch.get("do_objectID", ""))
        ch_path = f"{prefix}/{ch_id}" if (prefix and ch_id) else ch_id
        orig_sym = str(ch.get("symbolID", ""))
        eff_sym = swap_map.get(ch_path, orig_sym)
        old_act = bool(orig_sym) and orig_sym.lower() != "none"
        sim_act = bool(eff_sym) and eff_sym.lower() != "none"
        return old_act, sim_act

    def eval_node(
        node: Dict[str, Any],
        prefix: str,
        visited: set[str],
        is_root: bool = False,
    ) -> Tuple[float, float]:
        _charge_expansion_step(expansion_budget, 1)
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
            orig_sym = str(node.get("symbolID", ""))
            eff_sym = swap_map.get(node_path, orig_sym)
            old_h_eff = node_h if (orig_sym and orig_sym.lower() != "none") else 0.0
            if not eff_sym or eff_sym.lower() == "none":
                return old_h_eff, 0.0
            nested_m = symbol_masters.get(eff_sym)
            if nested_m is None or eff_sym in visited:
                return old_h_eff, node_h
            m_old_h, m_sim_h = eval_node(
                nested_m, node_path, visited | {eff_sym}, is_root=True
            )
            return old_h_eff, node_h + (m_sim_h - m_old_h)

        raw_children = node.get("layers") or []
        if raw_children:
            layout = node.get("groupLayout") or {}
            is_flex = layout.get("_class") == "MSImmutableFlexGroupLayout"
            if is_flex and int(layout.get("verticalSizing", 1)) != 1:
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
                gap = float(layout.get("allGuttersGap", 0.0) or 0.0)
                child_evals = [
                    (
                        eval_node(ch, prefix, visited, is_root=False),
                        *is_child_active(ch, prefix),
                    )
                    for ch in flow_children
                ]
                old_list = [p[0] for p, oa, _ in child_evals if oa]
                sim_list = [p[1] for p, _, sa in child_evals if sa]
                if flex_dir == 0:
                    old_c = max(old_list, default=0.0)
                    sim_c = max(sim_list, default=0.0)
                else:
                    old_c = (
                        sum(old_list) + gap * max(0, len(old_list) - 1)
                        if old_list
                        else 0.0
                    )
                    sim_c = (
                        sum(sim_list) + gap * max(0, len(sim_list) - 1)
                        if sim_list
                        else 0.0
                    )
                return node_h, node_h + (sim_c - old_c)

            iv: List[Tuple[float, float, float]] = []
            for ch in flow_children:
                ch_y = float((ch.get("frame") or {}).get("y", 0.0))
                c_old, c_sim = eval_node(ch, prefix, visited, is_root=False)
                iv.append((ch_y, c_old, c_sim))
            _, delta_free = _freeform_offsets(iv)
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
    expansion_budget: Optional[Dict[str, int]] = None,
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
        if ov_name.endswith("_symbolID") and isinstance(ov.get("value"), str):
            swap_map[ov_name[: -len("_symbolID")]] = str(ov["value"])

    cur_master = root_master
    accum_y = 0.0
    width_adjust = 0.0
    height_adjust = 0.0
    for idx, seg_id in enumerate(segments):
        found_res = _find_layer_by_id(
            cur_master, seg_id, expansion_budget=expansion_budget
        )
        if found_res is None:
            return None
        found, _seg_x, seg_y = found_res
        accum_y += seg_y
        if idx < len(segments) - 1:
            if found.get("_class") != "symbolInstance":
                return None
            prefix = "/".join(segments[: idx + 1])
            next_sym_id = swap_map.get(prefix, str(found.get("symbolID", "")))
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


def _freeform_offsets(
    intervals: List[Tuple[float, float, float]],
) -> Tuple[List[float], float]:
    """Compute shifts from original overlap bands, independent of edit order."""
    bands: List[List[int]] = []
    band_bottom = float("-inf")
    for idx in sorted(range(len(intervals)), key=lambda i: (intervals[i][0], -(intervals[i][0] + intervals[i][1]))):
        y, old_height, _ = intervals[idx]
        if bands and y < band_bottom - 0.5:
            bands[-1].append(idx)
            band_bottom = max(band_bottom, y + old_height)
        else:
            bands.append([idx])
            band_bottom = y + old_height
    shifts = [0.0] * len(intervals)
    delta = 0.0
    for band in bands:
        for idx in band:
            shifts[idx] = delta
        old_bottom = max(intervals[i][0] + intervals[i][1] for i in band)
        new_bottom = max(intervals[i][0] + intervals[i][2] for i in band)
        delta += new_bottom - old_bottom
    return shifts, delta


def _reflow_freeform_group(
    group: Dict[str, Any],
    original_frames: Dict[int, Dict[str, Any]],
) -> None:
    children = [
        ch for ch in group.get("layers") or []
        if isinstance(ch, dict) and _participates_in_flex_flow(ch)
    ]
    intervals = [
        (
            float(original_frames[id(ch)].get("y", 0.0)),
            float(original_frames[id(ch)].get("height", 0.0)),
            float((ch.get("frame") or {}).get("height", 0.0)),
        )
        for ch in children
    ]
    shifts, delta = _freeform_offsets(intervals)
    for child, (y, _, _), shift in zip(children, intervals, shifts):
        if isinstance(child.get("frame"), dict):
            child["frame"]["y"] = round(y + shift, 2)
    frame = group.get("frame")
    if isinstance(frame, dict):
        frame["height"] = round(max(1.0, float(original_frames[id(group)].get("height", 0.0)) + delta), 2)


def _collect_artboard_rects(
    node: Dict[str, Any], offset_x: float = 0.0, offset_y: float = 0.0,
    *, root: bool = True,
) -> Dict[str, Tuple[float, float, float, float]]:
    rects: Dict[str, Tuple[float, float, float, float]] = {}
    frame = node.get("frame") or {}
    abs_x = offset_x + float(frame.get("x", 0.0))
    abs_y = offset_y + float(frame.get("y", 0.0))
    w = float(frame.get("width", 0.0))
    h = float(frame.get("height", 0.0))
    oid = str(node.get("do_objectID", ""))
    is_origin = root or node.get("_class") in ("page", "artboard", "symbolMaster")
    if oid and not is_origin and node.get("_class") != "MSImmutableHotspotLayer":
        rects[oid] = (abs_x, abs_y, w, h)
    next_x = 0.0 if is_origin else abs_x
    next_y = 0.0 if is_origin else abs_y
    for child in node.get("layers") or []:
        if isinstance(child, dict):
            rects.update(_collect_artboard_rects(child, next_x, next_y, root=False))
    return rects


MAX_ZIP_MEMBERS = 4096
MAX_ZIP_SINGLE_MEMBER_BYTES = 64 * 1024 * 1024
MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
MAX_ZIP_COMPRESSION_RATIO = 100.0
MAX_ARCHIVE_PAGES = 64


def _validate_zip_archive_budget(zf: zipfile.ZipFile) -> List[zipfile.ZipInfo]:
    """Validate ZIP member count, duplicate entries, per-member size, total uncompressed size, and compression ratio before reading."""
    infolist = zf.infolist()
    if len(infolist) > MAX_ZIP_MEMBERS:
        raise RuntimeError(
            f"Archive exceeds maximum member count ({len(infolist)} > {MAX_ZIP_MEMBERS})"
        )
    total_uncompressed = 0
    seen_names: set[str] = set()
    for info in infolist:
        if "\\" in info.filename:
            raise RuntimeError(f"Unsafe ZIP member path in archive: {info.filename}")
        parts = Path(info.filename).parts
        if ".." in parts or info.filename.startswith("/"):
            raise RuntimeError(f"Unsafe ZIP member path in archive: {info.filename}")
        canon_path = "/".join(
            p for p in info.filename.split("/") if p and p != "."
        )
        canon_key = f"{'dir' if info.is_dir() else 'file'}:{canon_path}"
        if info.filename in seen_names or canon_key in seen_names:
            raise RuntimeError(
                f"Sketch archive contains duplicate ZIP member entry: {info.filename}"
            )
        seen_names.add(info.filename)
        seen_names.add(canon_key)
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
    member_or_info: Any,
    max_bytes: int = MAX_ZIP_JSON_MEMBER_BYTES,
) -> bytes:
    """Stream-read a ZIP member with strict uncompressed size and compression-ratio enforcement."""
    info = (
        member_or_info
        if isinstance(member_or_info, zipfile.ZipInfo)
        else zf.getinfo(str(member_or_info))
    )
    member_name = info.filename
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
    page_count = 0
    total_json_bytes = 0
    for info in infolist:
        name = info.filename
        if name == "document.json" or (
            name.startswith("pages/") and name.endswith(".json")
        ):
            if name.startswith("pages/"):
                page_count += 1
                if page_count > MAX_ARCHIVE_PAGES:
                    raise RuntimeError(
                        f"Archive page count ({page_count}) exceeds limit ({MAX_ARCHIVE_PAGES})"
                    )
            raw = _read_zip_member_bounded(
                zf, info, max_bytes=MAX_ZIP_JSON_MEMBER_BYTES
            )
            total_json_bytes += len(raw)
            if total_json_bytes > MAX_ZIP_TOTAL_JSON_BYTES:
                raise RuntimeError(
                    f"Archive JSON total size ({total_json_bytes}) exceeds limit ({MAX_ZIP_TOTAL_JSON_BYTES})"
                )
            members[name] = raw
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
    dom_budget = _new_dom_budget()
    doc_data: Dict[str, Any] = {}
    if "document.json" in members:
        doc_data = _loads_json_bounded(
            members["document.json"], "document.json", dom_budget=dom_budget
        )

    pages_data: Dict[str, Dict[str, Any]] = {}
    for name, raw in members.items():
        if name.startswith("pages/") and name.endswith(".json"):
            dom_budget["pages"] += 1
            if dom_budget["pages"] > MAX_ARCHIVE_PAGES:
                raise RuntimeError(
                    f"Archive page count ({dom_budget['pages']}) exceeds limit ({MAX_ARCHIVE_PAGES})"
                )
            pages_data[name] = _loads_json_bounded(
                raw, name, dom_budget=dom_budget
            )

    symbol_masters = _index_symbol_masters(pages_data, doc_data)
    shared_text_styles = _index_shared_text_styles(doc_data)

    measure_queue: List[Dict[str, Any]] = []
    targets_meta: List[Dict[str, Any]] = []
    expansion_budget: Dict[str, int] = {"steps": 0}
    measurement_budget = MeasurementBudget()

    def scan_node(
        page_file: str,
        artboard: Optional[Dict[str, Any]],
        node: Dict[str, Any],
        ancestors: List[Dict[str, Any]],
    ) -> None:
        cur_artboard = (
            node
            if is_artboard(node, ancestors[-1] if ancestors else None)
            or node.get("_class") == "symbolMaster"
            else artboard
        )
        spec = _extract_text_layer_spec(node, shared_text_styles, budget=measurement_budget)
        if spec is not None:
            if len(measure_queue) >= MAX_MEASURE_SPECS:
                raise RuntimeError(
                    f"CoreText measurement spec count ({len(measure_queue) + 1}) exceeds limit ({MAX_MEASURE_SPECS})"
                )
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
                    master,
                    symbol_masters,
                    raw_inst_overrides,
                    expansion_budget=expansion_budget,
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
                    master,
                    symbol_masters,
                    inst_overrides,
                    expansion_budget=expansion_budget,
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
                        expansion_budget=expansion_budget,
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
                        text_override=ov_info.get("stringValue"),
                        budget=measurement_budget,
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
                    measurement_budget.reserve_json(
                        {"instanceID": str(node.get("do_objectID", "")), "overrideName": ov_name}
                    )
                    ov_id = f"{node.get('do_objectID')}::{ov_name}"
                    ov_spec = dict(m_spec)
                    if "stringValue" in ov_info or "textStyleID" in ov_info:
                        ov_spec.pop("runs", None)
                    ov_spec["id"] = ov_id
                    if "stringValue" in ov_info:
                        ov_spec["text"] = str(ov_info["stringValue"])
                    ov_spec["width"] = max(1.0, scale_w)
                    if len(measure_queue) >= MAX_MEASURE_SPECS:
                        raise RuntimeError(
                            f"CoreText measurement spec count ({len(measure_queue) + 1}) exceeds limit ({MAX_MEASURE_SPECS})"
                        )
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
                        and int(m_layout.get("verticalSizing", 1)) != 1
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
                        expansion_budget=expansion_budget,
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
                        expansion_budget=expansion_budget,
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

    # Phase 2: Apply one plan against the same original geometry used by simulation.
    if rebake:
        groups: Dict[int, Tuple[int, Dict[str, Any]]] = {}
        artboards: Dict[int, Tuple[Dict[str, Any], Dict[str, Tuple[float, float, float, float]]]] = {}
        original_frames: Dict[int, Dict[str, Any]] = {}
        for meta, _, _ in pending_rebakes:
            artboard = meta["artboard"]
            if artboard is not None and id(artboard) not in artboards:
                artboards[id(artboard)] = (artboard, _collect_artboard_rects(artboard))
            for depth, ancestor in enumerate(meta["ancestors"]):
                if (
                    (ancestor.get("groupLayout") or {}).get("_class") == "MSImmutableFlexGroupLayout"
                    or ancestor.get("_class") == "symbolMaster"
                    or (ancestor.get("_class") == "group" and ancestor is not artboard)
                ):
                    groups[id(ancestor)] = (depth, ancestor)
        for _, group in groups.values():
            for node in [group, *(group.get("layers") or [])]:
                if isinstance(node, dict):
                    original_frames[id(node)] = dict(node.get("frame") or {})
        for meta, drift_record, expected_h in pending_rebakes:
            meta["node"].setdefault("frame", {})["height"] = expected_h
            dirty_pages.add(meta["pageFile"])
            rebaked_layers.append(drift_record)
        for _, group in sorted(groups.values(), key=lambda entry: entry[0], reverse=True):
            if (group.get("groupLayout") or {}).get("_class") == "MSImmutableFlexGroupLayout":
                _reflow_vertical_flex_group(group)
            else:
                _reflow_freeform_group(group, original_frames)
        for artboard, before_rects in artboards.values():
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
                    explicit_tid = str(
                        top_child.get("targetLayerID")
                        or top_child.get("boundLayerID")
                        or ""
                    ).strip()
                    if explicit_tid:
                        if explicit_tid in before_rects:
                            bx, by, bw, bh = before_rects[explicit_tid]
                            ax, ay, aw, ah = after_rects.get(
                                explicit_tid, (bx, by, bw, bh)
                            )
                            hs_frame["x"] = round(ax + (hx - bx), 2)
                            hs_frame["y"] = round(ay + (hy - by), 2)
                            hs_frame["width"] = round(aw + (hw - bw), 2)
                            hs_frame["height"] = round(ah + (hh - bh), 2)
                    else:
                        for oid, (bx, by, bw, bh) in reversed(
                            list(before_rects.items())
                        ):
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
                parsed = read_json(sys.stdin.buffer, "stdin", max_bytes=MAX_MEASURE_JSON_BYTES)
            else:
                with Path(args.input).open("rb") as stream:
                    parsed = read_json(stream, args.input, max_bytes=MAX_MEASURE_JSON_BYTES)
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
