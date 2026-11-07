#!/usr/bin/env python3
"""5-second non-activating native Sketch MCP roundtrip verifier.

Executes the 6-step crash-free verification protocol against `http://localhost:31126/mcp`:
1. Pre-check open documents on `:31126/mcp`: confirm persistent `--anchor-id` is open
   and no stray working documents remain (`matching: []`).
2. Background non-activating open: `open -g -a /Applications/Sketch.app <copy.sketch>`,
   polling until `doc.id` is ready.
3. Capture pre-edit `get_screenshot`, then run lightweight multiline JS `run_code`
   (`{"title": "...", "script": "..."}`, reading only top-level counts + locating 1-3
   target layers by ID on a target page to apply override/focus-border edits +
   `doc.processPendingChanges()` + zero-arg `doc.save()`).
4. Capture post-edit `get_screenshot` and call `doc.close()` on the disposable copy
   (never closing `--anchor-id`).
5. Offline Python `zipfile` diff between pre-save and post-save `.sketch` archives,
   asserting `0` unexpected drift across all artboards, Flex Stacks, HotSpots, flows,
   and font descriptors outside the expected test mutations.
6. Re-open `<copy.sketch>` via `open -g -a /Applications/Sketch.app <copy.sketch>`,
   verify persisted mutations via lightweight JS readback, capture reopen `get_screenshot`
   and compare SHA-256 with the post-edit screenshot, close `<copy.sketch>`, and assert
   final `matching: []` with the anchor document intact.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


DEFAULT_MCP_URL = "http://localhost:31126/mcp"
DEFAULT_SKETCH_APP = "/Applications/Sketch.app"


def _ensure_private_dir(dir_path: Path, enforce_private_mode: bool = True) -> None:
    """Create or validate an output directory, rejecting symlinked target directories."""
    try:
        st = os.lstat(dir_path)
        if stat.S_ISLNK(st.st_mode):
            raise RuntimeError(f"Refusing to use symlinked directory: {dir_path}")
        if not stat.S_ISDIR(st.st_mode):
            raise RuntimeError(f"Output directory path is not a directory: {dir_path}")
        if (
            enforce_private_mode
            and hasattr(os, "getuid")
            and st.st_uid == os.getuid()
            and not (st.st_mode & stat.S_ISVTX)
            and (st.st_mode & (stat.S_IWGRP | stat.S_IWOTH))
        ):
            os.chmod(dir_path, 0o700)
    except FileNotFoundError:
        if dir_path.parent != dir_path and dir_path.parent.is_symlink():
            # Allow standard macOS system symlinks (/tmp -> /private/tmp, /var -> /private/var)
            if str(dir_path.parent) not in ("/tmp", "/var"):
                raise RuntimeError(
                    f"Refusing to create directory under symlinked parent: {dir_path.parent}"
                )
        dir_path.mkdir(parents=True, exist_ok=True, mode=0o700)
        if enforce_private_mode:
            os.chmod(dir_path, 0o700)


def _write_bytes_nofollow(file_path: Path, data: bytes, mode: int = 0o600) -> None:
    """Write bytes to file_path without following symlinks on parent or target file."""
    if str(file_path.parent) not in ("/tmp", "/var") and file_path.parent.is_symlink():
        raise RuntimeError(f"Refusing to write inside symlinked directory: {file_path.parent}")
    _ensure_private_dir(file_path.parent, enforce_private_mode=False)
    try:
        st = os.lstat(file_path)
        if stat.S_ISLNK(st.st_mode):
            raise RuntimeError(f"Refusing to write to symlinked file: {file_path}")
        if not stat.S_ISREG(st.st_mode):
            raise RuntimeError(f"Refusing to overwrite non-regular file: {file_path}")
    except FileNotFoundError:
        pass

    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(str(file_path), flags, mode)
    try:
        view = memoryview(data)
        total = 0
        while total < len(view):
            written = os.write(fd, view[total:])
            if written <= 0:
                raise RuntimeError(f"Short write to {file_path}")
            total += written
    finally:
        os.close(fd)


class SketchMCPClient:
    """Minimal JSON-RPC 2.0 HTTP/SSE client for Sketch 2026.3 MCP server."""

    def __init__(self, endpoint: str = DEFAULT_MCP_URL, timeout: float = 10.0) -> None:
        self.endpoint = endpoint
        self.timeout = timeout
        self.session_id: Optional[str] = None
        self._req_id = 0
        self._initialized = False

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def _post_rpc(
        self, method: str, params: Optional[Dict[str, Any]] = None, is_notification: bool = False
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if not is_notification:
            payload["id"] = self._next_id()
        if params is not None:
            payload["params"] = params

        raw_body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id

        req = urllib.request.Request(
            self.endpoint, data=raw_body, headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id")
            if sid:
                self.session_id = sid
            ctype = (resp.headers.get("Content-Type") or "").lower()
            body_text = resp.read().decode("utf-8", errors="replace").strip()

        if is_notification or not body_text:
            return {}

        if "text/event-stream" in ctype or body_text.startswith("event:") or body_text.startswith("data:"):
            last_json: Dict[str, Any] = {}
            for line in body_text.splitlines():
                line_s = line.strip()
                if line_s.startswith("data:"):
                    data_str = line_s[len("data:") :].strip()
                    if data_str:
                        last_json = json.loads(data_str)
            return last_json

        return json.loads(body_text)

    def ensure_initialized(self) -> None:
        if self._initialized:
            return
        self._post_rpc(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "sketch-native-roundtrip", "version": "1.0.0"},
            },
        )
        try:
            self._post_rpc("notifications/initialized", {}, is_notification=True)
        except Exception:
            pass
        self._initialized = True

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        self.ensure_initialized()
        rpc_resp = self._post_rpc(
            "tools/call", {"name": name, "arguments": arguments}
        )
        if "error" in rpc_resp:
            raise RuntimeError(f"MCP tool '{name}' RPC error: {rpc_resp['error']}")
        result = rpc_resp.get("result") or {}
        if result.get("isError"):
            raise RuntimeError(f"MCP tool '{name}' execution error: {result}")
        return result

    def run_code(self, title: str, script: str) -> Dict[str, Any]:
        res = self.call_tool("run_code", {"title": title, "script": script})
        for block in res.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text":
                txt = str(block.get("text", "")).strip()
                if txt:
                    for line in reversed(txt.splitlines()):
                        candidate = line.strip()
                        if candidate.startswith("{") and candidate.endswith("}"):
                            return json.loads(candidate)
                    return {"rawText": txt}
        if isinstance(res.get("structuredContent"), dict):
            return res["structuredContent"]
        return res

    def get_screenshot(
        self,
        *,
        artboard_id: Optional[str] = None,
        layer_id: Optional[str] = None,
        scale: int = 1,
    ) -> bytes:
        args: Dict[str, Any] = {"scale": scale}
        if artboard_id:
            args["artboard_id"] = artboard_id
        if layer_id:
            args["layer_id"] = layer_id
        res = self.call_tool("get_screenshot", args)
        for block in res.get("content") or []:
            if isinstance(block, dict):
                if block.get("type") == "image" and block.get("data"):
                    return base64.b64decode(block["data"])
                if block.get("type") == "text":
                    txt = str(block.get("text", "")).strip()
                    if txt.startswith("{"):
                        parsed = json.loads(txt)
                        if parsed.get("imageBase64"):
                            return base64.b64decode(parsed["imageBase64"])
        raise RuntimeError(f"get_screenshot returned no image bytes: {res}")


def _build_slot_check_js(anchor_id: str) -> str:
    anchor_json = json.dumps(anchor_id)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const anchorId = {anchor_json}",
            "const docs = sketch.getDocuments()",
            "const allIds = docs.map(d => String(d.id))",
            "const anchorPresent = allIds.includes(anchorId)",
            "const matching = docs.filter(d => String(d.id) !== anchorId).map(d => ({ id: String(d.id), path: d.path ? String(d.path) : '' }))",
            "console.log(JSON.stringify({ anchorId, anchorPresent, totalOpen: docs.length, matching }))",
        ]
    )


def _build_wait_open_js(anchor_id: str, target_filename: str) -> str:
    anchor_json = json.dumps(anchor_id)
    fname_json = json.dumps(target_filename)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const anchorId = {anchor_json}",
            f"const targetName = {fname_json}",
            "const docs = sketch.getDocuments()",
            "const candidates = docs.filter(d => String(d.id) !== anchorId && (!d.path || String(d.path).endsWith(targetName)))",
            "const doc = candidates.length > 0 ? candidates[0] : null",
            "if (!doc) {",
            "  console.log(JSON.stringify({ ready: false }))",
            "} else {",
            "  console.log(JSON.stringify({ ready: true, docId: String(doc.id), pagesCount: doc.pages.length }))",
            "}",
        ]
    )


def _build_lightweight_mutate_js(doc_id: str, edits: List[Dict[str, Any]], page_id: Optional[str]) -> str:
    doc_id_json = json.dumps(doc_id)
    page_id_json = json.dumps(page_id or "")
    edits_json = json.dumps(edits[:3], ensure_ascii=False)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const targetDocId = {doc_id_json}",
            f"const targetPageId = {page_id_json}",
            f"const edits = {edits_json}",
            "const docs = sketch.getDocuments()",
            "const doc = docs.find(d => String(d.id) === targetDocId)",
            "if (!doc) { throw new Error('Working document not found: ' + targetDocId) }",
            "const topCounts = {",
            "  docId: String(doc.id),",
            "  pagesCount: doc.pages.length,",
            "  pageTopLayerCounts: doc.pages.map(p => ({ id: String(p.id), name: String(p.name), topLayers: p.layers.length })),",
            "  swatchesCount: doc.swatches ? doc.swatches.length : 0,",
            "  sharedTextStylesCount: doc.sharedTextStyles ? doc.sharedTextStyles.length : 0,",
            "  sharedLayerStylesCount: doc.sharedLayerStyles ? doc.sharedLayerStyles.length : 0",
            "}",
            "const scopePage = targetPageId ? doc.pages.find(p => String(p.id) === targetPageId) : doc.pages[0]",
            "const applied = []",
            "for (const edit of edits) {",
            "  const matches = sketch.find('#' + edit.layerID, scopePage || doc)",
            "  const layer = matches && matches.length > 0 ? matches[0] : doc.getLayerWithID(edit.layerID)",
            "  if (!layer) { throw new Error('Target layer not found: ' + edit.layerID) }",
            "  if (typeof edit.text === 'string') {",
            "    layer.text = edit.text",
            "  }",
            "  if (edit.overrideID && typeof edit.overrideValue !== 'undefined' && layer.overrides) {",
            "    const ov = layer.overrides.find(o => String(o.id) === String(edit.overrideID))",
            "    if (ov) { ov.value = edit.overrideValue }",
            "  }",
            "  if (edit.focusBorderColor) {",
            "    layer.style.borders = [{ color: edit.focusBorderColor, thickness: edit.focusBorderThickness || 2, position: sketch.Style.BorderPosition.Outside, enabled: true }]",
            "  }",
            "  applied.push({ layerID: String(layer.id), name: String(layer.name) })",
            "}",
            "if (typeof doc.processPendingChanges === 'function') {",
            "  doc.processPendingChanges()",
            "}",
            "doc.save()",
            "console.log(JSON.stringify({ ok: true, topCounts, applied }))",
        ]
    )


def _build_lightweight_readback_js(doc_id: str, edits: List[Dict[str, Any]], page_id: Optional[str]) -> str:
    doc_id_json = json.dumps(doc_id)
    page_id_json = json.dumps(page_id or "")
    edits_json = json.dumps(edits[:3], ensure_ascii=False)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const targetDocId = {doc_id_json}",
            f"const targetPageId = {page_id_json}",
            f"const edits = {edits_json}",
            "const docs = sketch.getDocuments()",
            "const doc = docs.find(d => String(d.id) === targetDocId)",
            "if (!doc) { throw new Error('Reopened document not found: ' + targetDocId) }",
            "const scopePage = targetPageId ? doc.pages.find(p => String(p.id) === targetPageId) : doc.pages[0]",
            "const readbacks = []",
            "for (let editIndex = 0; editIndex < edits.length; editIndex++) {",
            "  const edit = edits[editIndex]",
            "  const matches = sketch.find('#' + edit.layerID, scopePage || doc)",
            "  const layer = matches && matches.length > 0 ? matches[0] : doc.getLayerWithID(edit.layerID)",
            "  if (!layer) { throw new Error('Target layer missing on reopen: ' + edit.layerID) }",
            "  let ovVal = null",
            "  if (edit.overrideID && layer.overrides) {",
            "    const ov = layer.overrides.find(o => String(o.id) === String(edit.overrideID))",
            "    ovVal = (ov && ov.value !== undefined && ov.value !== null) ? String(ov.value) : null",
            "  }",
            "  const borderThickness = (layer.style && layer.style.borders && layer.style.borders.length > 0) ? layer.style.borders[0].thickness : null",
            "  const layerText = typeof layer.text === 'string' ? layer.text : null",
            "  readbacks.push({ editIndex, layerID: String(layer.id), overrideID: edit.overrideID || null, text: layerText, overrideValue: ovVal, borderThickness })",
            "}",
            "console.log(JSON.stringify({ ok: true, docId: String(doc.id), readbacks }))",
        ]
    )


def _build_close_doc_js(doc_id: str, anchor_id: str) -> str:
    doc_id_json = json.dumps(doc_id)
    anchor_json = json.dumps(anchor_id)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const targetDocId = {doc_id_json}",
            f"const anchorId = {anchor_json}",
            "if (targetDocId === anchorId) { throw new Error('Refusing to close anchor document') }",
            "const docs = sketch.getDocuments()",
            "const doc = docs.find(d => String(d.id) === targetDocId)",
            "if (doc) { doc.close() }",
            "const remaining = sketch.getDocuments().filter(d => String(d.id) !== anchorId).map(d => String(d.id))",
            "console.log(JSON.stringify({ closed: true, remainingNonAnchor: remaining }))",
        ]
    )


def _build_close_all_non_anchor_js(anchor_id: str) -> str:
    anchor_json = json.dumps(anchor_id)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const anchorId = {anchor_json}",
            "const docs = sketch.getDocuments()",
            "for (const d of docs) {",
            "  if (String(d.id) !== anchorId) { d.close() }",
            "}",
            "const remaining = sketch.getDocuments().filter(d => String(d.id) !== anchorId).map(d => String(d.id))",
            "console.log(JSON.stringify({ closed: true, remainingNonAnchor: remaining }))",
        ]
    )


def _extract_archive_snapshot(sketch_path: Path) -> Dict[str, Dict[str, Any]]:
    """Extract per-object structural snapshot from a .sketch ZIP archive offline."""
    snapshot: Dict[str, Dict[str, Any]] = {}
    with zipfile.ZipFile(sketch_path, "r") as zf:
        for member in sorted(zf.namelist()):
            if not (member == "document.json" or (member.startswith("pages/") and member.endswith(".json"))):
                continue
            data = json.loads(zf.read(member).decode("utf-8"))

            if member == "document.json":
                for st in (data.get("layerTextStyles") or {}).get("objects") or []:
                    if not isinstance(st, dict):
                        continue
                    sid = str(st.get("do_objectID", ""))
                    if not sid:
                        continue
                    enc_attrs = (
                        ((st.get("value") or {}).get("textStyle") or {}).get("encodedAttributes")
                        or {}
                    )
                    font_desc = (
                        (enc_attrs.get("MSAttributedStringFontAttribute") or {}).get("attributes")
                        if isinstance(enc_attrs.get("MSAttributedStringFontAttribute"), dict)
                        else None
                    )
                    snapshot[f"sharedTextStyle:{sid}"] = {
                        "_class": st.get("_class", "sharedStyle"),
                        "name": st.get("name"),
                        "fontDescriptor": font_desc,
                        "paragraphStyle": enc_attrs.get("paragraphStyle"),
                    }
                for fst in data.get("foreignTextStyles") or []:
                    if not isinstance(fst, dict):
                        continue
                    local_st = fst.get("localSharedStyle") or {}
                    sid = str(local_st.get("do_objectID", ""))
                    if not sid:
                        continue
                    enc_attrs = (
                        ((local_st.get("value") or {}).get("textStyle") or {}).get(
                            "encodedAttributes"
                        )
                        or {}
                    )
                    font_desc = (
                        (enc_attrs.get("MSAttributedStringFontAttribute") or {}).get("attributes")
                        if isinstance(enc_attrs.get("MSAttributedStringFontAttribute"), dict)
                        else None
                    )
                    snapshot[f"foreignTextStyle:{sid}"] = {
                        "_class": local_st.get("_class", "sharedStyle"),
                        "name": local_st.get("name"),
                        "fontDescriptor": font_desc,
                        "paragraphStyle": enc_attrs.get("paragraphStyle"),
                    }
                for lst in (data.get("layerStyles") or {}).get("objects") or []:
                    if not isinstance(lst, dict):
                        continue
                    sid = str(lst.get("do_objectID", ""))
                    if sid:
                        snapshot[f"sharedLayerStyle:{sid}"] = {
                            "_class": lst.get("_class", "sharedStyle"),
                            "name": lst.get("name"),
                            "borders": ((lst.get("value") or {}).get("borders")),
                            "fills": ((lst.get("value") or {}).get("fills")),
                        }
                for sw in (data.get("sharedSwatches") or {}).get("objects") or []:
                    if not isinstance(sw, dict):
                        continue
                    sw_id = str(sw.get("do_objectID", ""))
                    if sw_id:
                        snapshot[f"swatch:{sw_id}"] = {
                            "_class": sw.get("_class", "swatch"),
                            "name": sw.get("name"),
                            "value": sw.get("value"),
                        }

            def walk(node: Dict[str, Any]) -> None:
                oid = str(node.get("do_objectID", ""))
                if oid:
                    frame = node.get("frame") or {}
                    attr_str = node.get("attributedString") or {}
                    attrs = attr_str.get("attributes") or []
                    first_font = (
                        ((attrs[0].get("attributes") or {}).get("MSAttributedStringFontAttribute") or {}).get("attributes")
                        if attrs and isinstance(attrs[0], dict)
                        else None
                    )
                    snapshot[oid] = {
                        "_class": node.get("_class"),
                        "name": node.get("name"),
                        "frame": {
                            "x": round(float(frame.get("x", 0.0)), 2),
                            "y": round(float(frame.get("y", 0.0)), 2),
                            "width": round(float(frame.get("width", 0.0)), 2),
                            "height": round(float(frame.get("height", 0.0)), 2),
                        }
                        if frame
                        else None,
                        "groupLayout": node.get("groupLayout"),
                        "flow": node.get("flow"),
                        "text": attr_str.get("string") if attr_str else None,
                        "fontDescriptor": first_font,
                        "overrideValues": node.get("overrideValues"),
                        "borders": (node.get("style") or {}).get("borders"),
                    }
                for child in node.get("layers") or []:
                    if isinstance(child, dict):
                        walk(child)

            walk(data)
    return snapshot


def diff_sketch_archives_offline(
    before_sketch: Path,
    after_sketch: Path,
    allowed_layer_ids: Set[str],
) -> Dict[str, Any]:
    before_snap = _extract_archive_snapshot(before_sketch)
    after_snap = _extract_archive_snapshot(after_sketch)

    expected_changes: List[Dict[str, Any]] = []
    unexpected_drifts: List[Dict[str, Any]] = []

    all_ids = sorted(set(before_snap.keys()) | set(after_snap.keys()))
    for oid in all_ids:
        b_item = before_snap.get(oid)
        a_item = after_snap.get(oid)
        if b_item == a_item:
            continue
        diff_entry = {
            "layerID": oid,
            "class": (a_item or b_item or {}).get("_class"),
            "name": (a_item or b_item or {}).get("name"),
            "before": b_item,
            "after": a_item,
        }
        if oid in allowed_layer_ids:
            expected_changes.append(diff_entry)
        else:
            unexpected_drifts.append(diff_entry)

    return {
        "totalObjectsCompared": len(all_ids),
        "expectedChangedCount": len(expected_changes),
        "unexpectedDriftCount": len(unexpected_drifts),
        "expectedChanges": expected_changes,
        "unexpectedDrifts": unexpected_drifts,
    }


def _launch_sketch_background(
    sketch_path: Path, sketch_app: str, open_bin: str
) -> List[str]:
    cmd = [open_bin, "-g", "-a", sketch_app, str(sketch_path)]
    subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=15)
    return cmd


def run_mcp_roundtrip(
    sketch_path: Path,
    anchor_id: str,
    edit_spec: Dict[str, Any],
    screenshots_dir: Path,
    mcp_url: str = DEFAULT_MCP_URL,
    sketch_app: str = DEFAULT_SKETCH_APP,
    open_bin: str = "open",
    poll_timeout: float = 8.0,
) -> Dict[str, Any]:
    start_ts = time.perf_counter()
    if not sketch_path.exists():
        raise FileNotFoundError(f"Disposable .sketch copy not found: {sketch_path}")

    _ensure_private_dir(screenshots_dir)
    edits = edit_spec.get("edits") or []
    if len(edits) > 3:
        raise ValueError(
            f"Edit spec contains {len(edits)} edits; maximum 3 targeted layer edits allowed per slot."
        )
    target_page_id = edit_spec.get("pageID")
    target_artboard_id = edit_spec.get("artboardID") or (
        edits[0].get("layerID") if edits else None
    )
    allowed_ids: Set[str] = {
        str(e["layerID"]) for e in edits if isinstance(e, dict) and e.get("layerID")
    }
    for extra_id in edit_spec.get("allowedChangedIDs") or []:
        allowed_ids.add(str(extra_id))

    with tempfile.TemporaryDirectory(prefix="sketch-roundtrip-baseline-") as tmpdir:
        baseline_copy = Path(tmpdir) / "baseline-before-save.sketch"
        shutil.copy2(sketch_path, baseline_copy)

        client = SketchMCPClient(endpoint=mcp_url)

        # Step 1: Pre-check :31126/mcp open documents
        precheck = client.run_code(
            "roundtrip-step1-precheck", _build_slot_check_js(anchor_id)
        )
        if not precheck.get("anchorPresent"):
            return {
                "tool": "sketch_mcp_roundtrip.py",
                "passed": False,
                "failedStep": "step1_precheck",
                "reason": f"Anchor document {anchor_id} is not open in Sketch",
                "precheck": precheck,
            }
        if precheck.get("matching"):
            return {
                "tool": "sketch_mcp_roundtrip.py",
                "passed": False,
                "failedStep": "step1_precheck",
                "reason": "Stray non-anchor document(s) open before acquiring slot (matching != [])",
                "precheck": precheck,
            }

        # Step 2: Open disposable copy with `open -g -a /Applications/Sketch.app`
        open_cmd_1 = _launch_sketch_background(sketch_path, sketch_app, open_bin)
        doc_id: Optional[str] = None
        close_res_1: Optional[Dict[str, Any]] = None
        try:
            deadline = time.perf_counter() + poll_timeout
            while time.perf_counter() < deadline:
                probe = client.run_code(
                    "roundtrip-step2-wait-open",
                    _build_wait_open_js(anchor_id, sketch_path.name),
                )
                if probe.get("ready") and probe.get("docId"):
                    doc_id = str(probe["docId"])
                    break
                time.sleep(0.15)
            if not doc_id:
                return {
                    "tool": "sketch_mcp_roundtrip.py",
                    "passed": False,
                    "failedStep": "step2_open_copy",
                    "reason": f"Timed out waiting for {sketch_path.name} to open in background",
                }

            # Step 3 & Step 4: Pre-edit screenshot -> lightweight JS edit + processPendingChanges + save -> post-edit screenshot -> doc.close()
            before_png_bytes = client.get_screenshot(artboard_id=target_artboard_id)
            before_png_path = screenshots_dir / "before.png"
            _write_bytes_nofollow(before_png_path, before_png_bytes)
            before_sha256 = hashlib.sha256(before_png_bytes).hexdigest()

            mutate_res = client.run_code(
                "roundtrip-step3-mutate-and-save",
                _build_lightweight_mutate_js(doc_id, edits, target_page_id),
            )

            after_png_bytes = client.get_screenshot(artboard_id=target_artboard_id)
            after_png_path = screenshots_dir / "after.png"
            _write_bytes_nofollow(after_png_path, after_png_bytes)
            after_sha256 = hashlib.sha256(after_png_bytes).hexdigest()

            close_res_1 = client.run_code(
                "roundtrip-step4-close-copy",
                _build_close_doc_js(doc_id, anchor_id),
            )
        finally:
            if close_res_1 is None:
                try:
                    if doc_id:
                        client.run_code(
                            "roundtrip-step4-emergency-close",
                            _build_close_doc_js(doc_id, anchor_id),
                        )
                    else:
                        client.run_code(
                            "roundtrip-step4-emergency-close-all",
                            _build_close_all_non_anchor_js(anchor_id),
                        )
                except Exception:
                    pass

        # Step 5: Offline Python zipfile diff between pre-save and post-save .sketch
        offline_diff = diff_sketch_archives_offline(
            baseline_copy, sketch_path, allowed_ids
        )

        # Step 6: Reopen copy via `open -g -a /Applications/Sketch.app`, readback, screenshot SHA-256, close, assert matching: []
        open_cmd_2 = _launch_sketch_background(sketch_path, sketch_app, open_bin)
        reopen_doc_id: Optional[str] = None
        close_res_2: Optional[Dict[str, Any]] = None
        try:
            deadline2 = time.perf_counter() + poll_timeout
            while time.perf_counter() < deadline2:
                probe2 = client.run_code(
                    "roundtrip-step6-wait-reopen",
                    _build_wait_open_js(anchor_id, sketch_path.name),
                )
                if probe2.get("ready") and probe2.get("docId"):
                    reopen_doc_id = str(probe2["docId"])
                    break
                time.sleep(0.15)
            if not reopen_doc_id:
                return {
                    "tool": "sketch_mcp_roundtrip.py",
                    "passed": False,
                    "failedStep": "step6_reopen",
                    "reason": f"Timed out waiting for {sketch_path.name} to reopen",
                }

            readback_res = client.run_code(
                "roundtrip-step6-readback",
                _build_lightweight_readback_js(reopen_doc_id, edits, target_page_id),
            )
            reopen_png_bytes = client.get_screenshot(artboard_id=target_artboard_id)
            reopen_png_path = screenshots_dir / "reopen.png"
            _write_bytes_nofollow(reopen_png_path, reopen_png_bytes)
            reopen_sha256 = hashlib.sha256(reopen_png_bytes).hexdigest()

            close_res_2 = client.run_code(
                "roundtrip-step6-close-reopen",
                _build_close_doc_js(reopen_doc_id, anchor_id),
            )
        finally:
            if close_res_2 is None:
                try:
                    if reopen_doc_id:
                        client.run_code(
                            "roundtrip-step6-emergency-close",
                            _build_close_doc_js(reopen_doc_id, anchor_id),
                        )
                    else:
                        client.run_code(
                            "roundtrip-step6-emergency-close-all",
                            _build_close_all_non_anchor_js(anchor_id),
                        )
                except Exception:
                    pass

        final_slot_check = client.run_code(
            "roundtrip-step6-final-slot-check",
            _build_slot_check_js(anchor_id),
        )

    persistence_verified = True
    raw_readbacks = [
        r for r in (readback_res.get("readbacks") or []) if isinstance(r, dict)
    ]
    readbacks_by_index: Dict[int, Dict[str, Any]] = {}
    readbacks_by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for pos, r in enumerate(raw_readbacks):
        e_idx = r.get("editIndex")
        if isinstance(e_idx, int):
            readbacks_by_index[e_idx] = r
        else:
            readbacks_by_index[pos] = r
        lid_key = str(r.get("layerID", ""))
        ov_key = str(r.get("overrideID") or "")
        readbacks_by_key[(lid_key, ov_key)] = r

    for edit_idx, edit in enumerate(edits):
        lid = str(edit.get("layerID", ""))
        ov_id = str(edit.get("overrideID") or "")
        rb = readbacks_by_index.get(edit_idx) or readbacks_by_key.get((lid, ov_id))
        if not rb or str(rb.get("layerID", "")) != lid:
            persistence_verified = False
            break
        if "text" in edit and rb.get("text") != edit["text"]:
            persistence_verified = False
        if "overrideValue" in edit and rb.get("overrideValue") != edit["overrideValue"]:
            persistence_verified = False
        if "borderThickness" in edit and rb.get("borderThickness") != edit["borderThickness"]:
            persistence_verified = False

    screenshot_sha_match = after_sha256 == reopen_sha256
    zero_unexpected_drift = offline_diff["unexpectedDriftCount"] == 0
    final_slot_clean = (
        bool(final_slot_check.get("anchorPresent"))
        and final_slot_check.get("matching") == []
    )
    passed = (
        persistence_verified
        and screenshot_sha_match
        and zero_unexpected_drift
        and final_slot_clean
    )

    return {
        "tool": "sketch_mcp_roundtrip.py",
        "sketch": str(sketch_path),
        "anchorID": anchor_id,
        "passed": passed,
        "elapsedMs": round((time.perf_counter() - start_ts) * 1000.0, 2),
        "launchCommands": [open_cmd_1, open_cmd_2],
        "steps": {
            "step1Precheck": precheck,
            "step2OpenDocID": doc_id,
            "step3MutateAndSave": mutate_res,
            "step4ScreenshotsAndClose": {
                "beforeScreenshot": str(before_png_path),
                "beforeSha256": before_sha256,
                "afterScreenshot": str(after_png_path),
                "afterSha256": after_sha256,
                "closeResult": close_res_1,
            },
            "step5OfflineZipDiff": offline_diff,
            "step6ReopenVerifyAndRelease": {
                "reopenDocID": reopen_doc_id,
                "readback": readback_res,
                "persistenceVerified": persistence_verified,
                "reopenScreenshot": str(reopen_png_path),
                "reopenSha256": reopen_sha256,
                "screenshotSha256Match": screenshot_sha_match,
                "closeResult": close_res_2,
                "finalSlotCheck": final_slot_check,
                "finalSlotClean": final_slot_clean,
            },
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sketch_mcp_roundtrip.py",
        description=(
            "5-second non-activating native Sketch MCP roundtrip verifier. "
            "Opens a disposable .sketch copy via `open -g -a /Applications/Sketch.app`, "
            "executes lightweight ID-targeted JS edits + `doc.processPendingChanges()` + "
            "zero-arg `doc.save()`, diffs archives offline via Python zipfile, and "
            "verifies persistence + screenshot SHA-256 on reopen while protecting the anchor doc."
        ),
    )
    parser.add_argument(
        "--sketch",
        required=True,
        help="Path to the disposable .sketch copy to verify.",
    )
    parser.add_argument(
        "--anchor-id",
        required=True,
        help="UUID of the persistent background anchor .sketch document that must never be closed.",
    )
    parser.add_argument(
        "--edit-spec",
        required=True,
        help="Path to JSON edit specification (or inline JSON object string).",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to write the output JSON roundtrip report.",
    )
    parser.add_argument(
        "--screenshots-dir",
        required=True,
        help="Directory to write before.png, after.png, and reopen.png.",
    )
    parser.add_argument(
        "--mcp-url",
        default=DEFAULT_MCP_URL,
        help=f"Sketch MCP HTTP endpoint (default: {DEFAULT_MCP_URL}).",
    )
    parser.add_argument(
        "--sketch-app",
        default=DEFAULT_SKETCH_APP,
        help=f"Path to Sketch.app bundle (default: {DEFAULT_SKETCH_APP}).",
    )
    parser.add_argument(
        "--open-bin",
        default="open",
        help="macOS open binary (default: open; always invoked with -g -a).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=8.0,
        help="Polling timeout in seconds for document open/reopen (default: 8.0).",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        spec_arg = args.edit_spec.strip()
        if spec_arg.startswith("{"):
            edit_spec = json.loads(spec_arg)
        else:
            edit_spec = json.loads(Path(spec_arg).read_text(encoding="utf-8"))

        report = run_mcp_roundtrip(
            sketch_path=Path(args.sketch),
            anchor_id=args.anchor_id,
            edit_spec=edit_spec,
            screenshots_dir=Path(args.screenshots_dir),
            mcp_url=args.mcp_url,
            sketch_app=args.sketch_app,
            open_bin=args.open_bin,
            poll_timeout=args.timeout,
        )
        exit_code = 0 if report.get("passed", False) else 1
    except Exception as exc:
        report = {
            "tool": "sketch_mcp_roundtrip.py",
            "sketch": args.sketch,
            "anchorID": args.anchor_id,
            "passed": False,
            "error": str(exc),
        }
        exit_code = 1

    out_str = json.dumps(report, ensure_ascii=False, indent=2)
    out_path = Path(args.output)
    _write_bytes_nofollow(out_path, (out_str + "\n").encode("utf-8"))
    print(out_str)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
