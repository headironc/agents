#!/usr/bin/env python3
"""Unsandboxed batch export, PDF font subset verifier, and manifest synchronizer.

Wraps `/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool` to:
1. Verify read access to macOS system font assets (`/System/Library/AssetsV2/.../PingFang.ttc`)
   so `PingFang SC` never silently falls back to `Heiti SC`.
2. Concurrently export artboards/pages at `1x`/`2x` PNG and lossless WebP.
3. Export status-bar clock / system UI text layers as PDF (`sketchtool export layers --formats=pdf`)
   and verify that embedded font subsets resolve to `.SFNS-Regular` (`/Subtype /TrueType`).
4. Compute exact pixel dimensions (`width`, `height`) and `sha256` digests, and synchronize
   or verify `manifest.json` and `renders.json`.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_SKETCHTOOL = (
    "/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool"
)
PINGFANG_ASSET_ROOT = Path("/System/Library/AssetsV2")
CLOCK_TEXT_RE = re.compile(r"^\d{1,2}:\d{2}$")


def _can_read_font_file(path: Path) -> bool:
    try:
        if not os.access(path, os.R_OK):
            return False
        with path.open("rb") as fh:
            return len(fh.read(4)) == 4
    except OSError:
        return False


def check_pingfang_font_access() -> Dict[str, Any]:
    """Verify that an actual PingFang.ttc font asset is readable to avoid PingFang SC -> Heiti SC fallback."""
    if platform.system() != "Darwin":
        return {
            "platform": platform.system(),
            "accessible": True,
            "pingfangPaths": [],
            "note": "Non-macOS environment",
        }
    if not PINGFANG_ASSET_ROOT.exists():
        return {
            "platform": "Darwin",
            "accessible": False,
            "pingfangPaths": [],
            "reason": f"{PINGFANG_ASSET_ROOT} does not exist",
        }
    try:
        found: List[str] = []
        for font_dir in PINGFANG_ASSET_ROOT.glob("com_apple_MobileAsset_Font*"):
            if not os.access(font_dir, os.R_OK):
                continue
            for ttc in font_dir.rglob("PingFang.ttc"):
                if _can_read_font_file(ttc):
                    found.append(str(ttc))
                    break
            if found:
                break
        accessible = len(found) > 0
        result: Dict[str, Any] = {
            "platform": "Darwin",
            "accessible": accessible,
            "pingfangPaths": found,
        }
        if not accessible:
            result["reason"] = (
                f"No readable PingFang.ttc found under {PINGFANG_ASSET_ROOT}/com_apple_MobileAsset_Font*"
            )
        return result
    except OSError as exc:
        return {
            "platform": "Darwin",
            "accessible": False,
            "pingfangPaths": [],
            "reason": f"Sandbox blocked read access to {PINGFANG_ASSET_ROOT}: {exc}",
        }


def parse_png_dimensions(png_path: Path) -> Tuple[int, int]:
    """Read pixel width and height directly from a PNG IHDR chunk."""
    with png_path.open("rb") as fh:
        header = fh.read(24)
    if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR":
        width, height = struct.unpack(">II", header[16:24])
        return int(width), int(height)
    return 0, 0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _is_valid_webp_file(webp_path: Path) -> bool:
    """Verify RIFF....WEBP container and ensure payload is not raw PNG bytes."""
    if not webp_path.exists():
        return False
    header = webp_path.read_bytes()[:32]
    if len(header) < 21:
        return False
    if header[:4] != b"RIFF" or header[8:12] != b"WEBP":
        return False
    chunk_tag = header[12:16]
    if chunk_tag not in (b"VP8L", b"VP8 ", b"VP8X"):
        return False
    # VP8L lossless bitstream starts with signature byte 0x2f ('/'), never PNG magic (\x89PNG)
    if chunk_tag == b"VP8L" and (header[20:21] != b"\x2f" or header[20:24] == b"\x89PNG"):
        return False
    return True


def convert_png_to_lossless_webp(
    png_path: Path, webp_path: Path, cwebp_bin: str = "cwebp"
) -> bool:
    """Convert PNG to lossless WebP using cwebp. Fails explicitly if unavailable or invalid."""
    resolved = shutil.which(cwebp_bin)
    if not resolved and Path(cwebp_bin).exists():
        resolved = str(Path(cwebp_bin))
    if not resolved:
        raise RuntimeError(
            f"Lossless WebP encoder '{cwebp_bin}' not found in PATH; install webp (cwebp) or pass --no-webp."
        )

    proc = subprocess.run(
        [resolved, "-lossless", "-q", "100", str(png_path), "-o", str(webp_path)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"cwebp lossless conversion failed (exit {proc.returncode}): {proc.stderr.strip()}"
        )
    if not _is_valid_webp_file(webp_path):
        raise RuntimeError(
            f"cwebp output at {webp_path} is missing or is not a valid WebP bitstream"
        )
    return True


def inspect_sketch_artboards_and_clocks(
    sketch_path: Path,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    artboards: List[Dict[str, Any]] = []
    clock_layers: List[Dict[str, Any]] = []

    with zipfile.ZipFile(sketch_path, "r") as zf:
        for member in sorted(zf.namelist()):
            if not (member.startswith("pages/") and member.endswith(".json")):
                continue
            page = json.loads(zf.read(member).decode("utf-8"))
            page_id = str(page.get("do_objectID", ""))
            page_name = str(page.get("name", ""))

            for top in page.get("layers") or []:
                if not isinstance(top, dict) or top.get("_class") != "artboard":
                    continue
                ab_id = str(top.get("do_objectID", ""))
                ab_name = str(top.get("name", ""))
                ab_frame = top.get("frame") or {}
                artboards.append(
                    {
                        "pageID": page_id,
                        "pageName": page_name,
                        "artboardID": ab_id,
                        "artboardName": ab_name,
                        "width": int(round(float(ab_frame.get("width", 0.0)))),
                        "height": int(round(float(ab_frame.get("height", 0.0)))),
                    }
                )

                def walk(node: Dict[str, Any]) -> None:
                    if node.get("_class") == "text":
                        attr_str = node.get("attributedString") or {}
                        txt = str(attr_str.get("string", "")).strip()
                        if CLOCK_TEXT_RE.match(txt):
                            clock_layers.append(
                                {
                                    "pageID": page_id,
                                    "artboardID": ab_id,
                                    "layerID": str(node.get("do_objectID", "")),
                                    "layerName": str(node.get("name", "")),
                                    "text": txt,
                                }
                            )
                    for ch in node.get("layers") or []:
                        if isinstance(ch, dict):
                            walk(ch)

                walk(top)

    return artboards, clock_layers


def verify_pdf_sfns_regular(pdf_path: Path) -> Dict[str, Any]:
    raw = pdf_path.read_bytes()
    text_latin = raw.decode("latin-1", errors="ignore")
    has_sfns = ".SFNS-Regular" in text_latin or "SFNS-Regular" in text_latin
    has_truetype = "/Subtype /TrueType" in text_latin or "/Subtype/TrueType" in text_latin
    has_heiti_fallback = "Heiti" in text_latin or "STHeiti" in text_latin
    return {
        "pdfPath": str(pdf_path),
        "sha256": sha256_file(pdf_path),
        "hasSFNSRegular": has_sfns,
        "hasTrueTypeSubtype": has_truetype,
        "hasHeitiFallback": has_heiti_fallback,
        "valid": has_sfns and has_truetype and not has_heiti_fallback,
    }


def _export_one_artboard_scale(
    sketchtool: str,
    sketch_path: Path,
    artboard: Dict[str, Any],
    scale: str,
    out_dir: Path,
    export_webp: bool,
    cwebp_bin: str = "cwebp",
) -> Dict[str, Any]:
    ab_id = artboard["artboardID"]
    scale_dir = out_dir / f"{scale}x"
    scale_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sketchtool,
        "export",
        "artboards",
        str(sketch_path),
        f"--item={ab_id}",
        f"--scales={scale}",
        "--formats=png",
        "--use-id-for-name=YES",
        f"--output={scale_dir}",
    ]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=60, check=False
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sketchtool export artboards failed for {ab_id}@{scale}x: {proc.stderr.strip()}"
        )

    candidates = sorted(scale_dir.glob(f"{ab_id}*.png"))
    if not candidates:
        raise FileNotFoundError(
            f"sketchtool produced no PNG for artboard {ab_id} in {scale_dir}"
        )
    png_path = candidates[0]
    w, h = parse_png_dimensions(png_path)
    png_sha = sha256_file(png_path)

    entry: Dict[str, Any] = {
        "artboardID": ab_id,
        "artboardName": artboard["artboardName"],
        "pageID": artboard["pageID"],
        "scale": f"{scale}x",
        "pngPath": str(png_path),
        "width": w,
        "height": h,
        "sha256": png_sha,
    }
    if export_webp:
        webp_path = png_path.with_suffix(".webp")
        convert_png_to_lossless_webp(png_path, webp_path, cwebp_bin=cwebp_bin)
        entry["webpPath"] = str(webp_path)
        entry["webpSha256"] = sha256_file(webp_path)
    return entry


def run_export_and_manifest(
    sketch_path: Path,
    output_dir: Path,
    sketchtool: str = DEFAULT_SKETCHTOOL,
    scales: List[str] = ["1", "2"],
    export_webp: bool = True,
    cwebp_bin: str = "cwebp",
    verify_clock_pdf: bool = True,
    manifest_path: Optional[Path] = None,
    renders_path: Optional[Path] = None,
    verify_only: bool = False,
    jobs: int = 4,
) -> Dict[str, Any]:
    if not sketch_path.exists():
        raise FileNotFoundError(f".sketch file not found: {sketch_path}")

    font_access = check_pingfang_font_access()
    artboards, clock_layers = inspect_sketch_artboards_and_clocks(sketch_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    tasks: List[Tuple[Dict[str, Any], str]] = [
        (ab, sc) for ab in artboards for sc in scales
    ]
    exported_renders: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        futures = [
            pool.submit(
                _export_one_artboard_scale,
                sketchtool,
                sketch_path,
                ab,
                sc,
                output_dir,
                export_webp,
                cwebp_bin,
            )
            for ab, sc in tasks
        ]
        for fut in futures:
            exported_renders.append(fut.result())

    clock_pdf_checks: List[Dict[str, Any]] = []
    if verify_clock_pdf and clock_layers:
        pdf_dir = output_dir / "pdf_layers"
        pdf_dir.mkdir(parents=True, exist_ok=True)
        for clock in clock_layers:
            lid = clock["layerID"]
            cmd = [
                sketchtool,
                "export",
                "layers",
                str(sketch_path),
                f"--item={lid}",
                "--formats=pdf",
                "--use-id-for-name=YES",
                f"--output={pdf_dir}",
            ]
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=60, check=False
            )
            if proc.returncode != 0:
                clock_pdf_checks.append(
                    {
                        **clock,
                        "valid": False,
                        "error": proc.stderr.strip(),
                    }
                )
                continue
            pdf_candidates = sorted(pdf_dir.glob(f"{lid}*.pdf"))
            if not pdf_candidates:
                clock_pdf_checks.append(
                    {
                        **clock,
                        "valid": False,
                        "error": f"No PDF exported for layer {lid}",
                    }
                )
                continue
            pdf_info = verify_pdf_sfns_regular(pdf_candidates[0])
            clock_pdf_checks.append({**clock, **pdf_info})

    manifest_mismatches: List[Dict[str, Any]] = []
    manifest_payload = {
        "sketch": str(sketch_path),
        "sketchSha256": sha256_file(sketch_path),
        "artboards": [
            {
                "id": ab["artboardID"],
                "name": ab["artboardName"],
                "pageID": ab["pageID"],
                "width": ab["width"],
                "height": ab["height"],
            }
            for ab in artboards
        ],
        "renders": exported_renders,
        "clockPdfChecks": clock_pdf_checks,
    }

    target_json_paths = [p for p in (manifest_path, renders_path) if p is not None]
    if verify_only and not target_json_paths:
        manifest_mismatches.append(
            {
                "type": "missing_baseline_argument",
                "message": "--verify-only requires --manifest and/or --renders baseline file path",
            }
        )

    for target_json_path in target_json_paths:
        if verify_only:
            if not target_json_path.exists():
                manifest_mismatches.append(
                    {
                        "type": "missing_baseline_file",
                        "path": str(target_json_path),
                    }
                )
                continue
            existing = json.loads(target_json_path.read_text(encoding="utf-8"))
            existing_by_key = {
                (r.get("artboardID"), r.get("scale")): r
                for r in (existing.get("renders") or [])
            }
            current_by_key = {
                (cur["artboardID"], cur["scale"]): cur
                for cur in exported_renders
            }
            for cur in exported_renders:
                key = (cur["artboardID"], cur["scale"])
                prev = existing_by_key.get(key)
                if not prev:
                    manifest_mismatches.append(
                        {"type": "missing_in_manifest", "key": list(key)}
                    )
                elif (
                    prev.get("sha256") != cur["sha256"]
                    or prev.get("width") != cur["width"]
                    or prev.get("height") != cur["height"]
                ):
                    manifest_mismatches.append(
                        {
                            "type": "render_mismatch",
                            "key": list(key),
                            "expected": prev,
                            "actual": cur,
                        }
                    )
            for key, prev in existing_by_key.items():
                if key not in current_by_key:
                    manifest_mismatches.append(
                        {
                            "type": "missing_in_export",
                            "key": list(key),
                            "expected": prev,
                        }
                    )
            current_artboard_ids = {ab["artboardID"] for ab in artboards}
            for prev_ab in existing.get("artboards") or []:
                if isinstance(prev_ab, dict):
                    prev_ab_id = prev_ab.get("id") or prev_ab.get("artboardID")
                    if prev_ab_id and str(prev_ab_id) not in current_artboard_ids:
                        manifest_mismatches.append(
                            {
                                "type": "missing_artboard_in_export",
                                "artboardID": str(prev_ab_id),
                                "expected": prev_ab,
                            }
                        )
        else:
            target_json_path.parent.mkdir(parents=True, exist_ok=True)
            target_json_path.write_text(
                json.dumps(manifest_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    clock_pdfs_all_valid = all(c.get("valid", False) for c in clock_pdf_checks)
    passed = (
        bool(font_access.get("accessible", True))
        and clock_pdfs_all_valid
        and len(manifest_mismatches) == 0
    )

    return {
        "tool": "sketch_export_manifest.py",
        "sketch": str(sketch_path),
        "outputDir": str(output_dir),
        "passed": passed,
        "fontAssetAccess": font_access,
        "artboardsExported": len(artboards),
        "rendersCount": len(exported_renders),
        "clockPdfChecks": clock_pdf_checks,
        "manifestMismatches": manifest_mismatches,
        "renders": exported_renders,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sketch_export_manifest.py",
        description=(
            "Unsandboxed batch exporter and manifest/PDF font verifier wrapping "
            "sketchtool (1x/2x PNG, lossless WebP, and .SFNS-Regular PDF verification)."
        ),
    )
    parser.add_argument(
        "--sketch",
        "-s",
        required=True,
        help="Path to the .sketch file to export.",
    )
    parser.add_argument(
        "--output-dir",
        "-d",
        required=True,
        help="Output directory for exported PNG, WebP, and PDF files.",
    )
    parser.add_argument(
        "--sketchtool",
        default=DEFAULT_SKETCHTOOL,
        help=f"Path to sketchtool binary (default: {DEFAULT_SKETCHTOOL}).",
    )
    parser.add_argument(
        "--scales",
        default="1,2",
        help="Comma-separated export scales (default: 1,2).",
    )
    parser.add_argument(
        "--webp",
        action="store_true",
        default=True,
        help="Also generate lossless WebP alongside each PNG (default: enabled).",
    )
    parser.add_argument(
        "--no-webp",
        action="store_false",
        dest="webp",
        help="Disable lossless WebP conversion.",
    )
    parser.add_argument(
        "--cwebp",
        default="cwebp",
        help="Path or name of cwebp encoder binary (default: cwebp).",
    )
    parser.add_argument(
        "--verify-clock-pdf",
        action="store_true",
        default=True,
        help="Export status-bar clock layers as PDF and verify .SFNS-Regular TrueType embedding.",
    )
    parser.add_argument(
        "--no-verify-clock-pdf",
        action="store_false",
        dest="verify_clock_pdf",
        help="Skip status-bar clock PDF export and font verification.",
    )
    parser.add_argument(
        "--manifest",
        help="Path to manifest.json to write or verify.",
    )
    parser.add_argument(
        "--renders",
        help="Path to renders.json to write or verify.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Verify existing manifest.json / renders.json digests without overwriting.",
    )
    parser.add_argument(
        "--jobs",
        "-j",
        type=int,
        default=4,
        help="Concurrent sketchtool worker threads (default: 4).",
    )
    parser.add_argument(
        "--output",
        "-o",
        help="Optional path to write the JSON export report.",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    scales = [s.strip() for s in args.scales.split(",") if s.strip()]

    try:
        report = run_export_and_manifest(
            sketch_path=Path(args.sketch),
            output_dir=Path(args.output_dir),
            sketchtool=args.sketchtool,
            scales=scales,
            export_webp=args.webp,
            cwebp_bin=args.cwebp,
            verify_clock_pdf=args.verify_clock_pdf,
            manifest_path=Path(args.manifest) if args.manifest else None,
            renders_path=Path(args.renders) if args.renders else None,
            verify_only=args.verify_only,
            jobs=args.jobs,
        )
        exit_code = 0 if report.get("passed", False) else 1
    except Exception as exc:
        report = {
            "tool": "sketch_export_manifest.py",
            "sketch": args.sketch,
            "passed": False,
            "error": str(exc),
        }
        exit_code = 1

    out_str = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(out_str + "\n", encoding="utf-8")
    print(out_str)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
