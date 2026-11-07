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
import stat
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


DEFAULT_SKETCHTOOL = (
    "/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool"
)
PINGFANG_ASSET_ROOT = Path("/System/Library/AssetsV2")
PINGFANG_FALLBACK_PATHS = [
    Path(
        "/System/Library/PrivateFrameworks/FontServices.framework/Versions/A/Resources/Reserved/PingFangUI.ttc"
    ),
    Path("/System/Library/Fonts/PingFang.ttc"),
]
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


def _validate_regular_owned_file(file_path: Path) -> None:
    st = os.lstat(file_path)
    if stat.S_ISLNK(st.st_mode):
        raise RuntimeError(f"Refusing to read symlinked file: {file_path}")
    if not stat.S_ISREG(st.st_mode):
        raise RuntimeError(f"Refusing to read non-regular file: {file_path}")
    if hasattr(os, "getuid") and st.st_uid != os.getuid():
        raise RuntimeError(
            f"Refusing to read file not owned by current user: {file_path}"
        )
    if st.st_nlink > 1:
        raise RuntimeError(f"Refusing to read hard-linked file: {file_path}")


def _validate_pinned_dir_fd(dir_fd: int, display_path: Path) -> None:
    uid = os.getuid() if hasattr(os, "getuid") else 0
    st = os.fstat(dir_fd)
    if not stat.S_ISDIR(st.st_mode):
        raise RuntimeError(f"Export path is not a regular directory: {display_path}")
    if hasattr(os, "getuid") and st.st_uid != uid:
        raise RuntimeError(
            f"Refusing export directory not owned by current user: {display_path}"
        )
    if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise RuntimeError(
            f"Refusing non-private (group/world accessible) export directory: {display_path}"
        )
    dup_fd = os.dup(dir_fd)
    try:
        with os.scandir(dup_fd) as it:
            for entry in it:
                try:
                    cst = entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue
                child_disp = display_path / entry.name
                if stat.S_ISLNK(cst.st_mode):
                    raise RuntimeError(
                        f"Refusing export directory containing symlink entry: {child_disp}"
                    )
                if hasattr(os, "getuid") and cst.st_uid != uid:
                    raise RuntimeError(
                        f"Refusing export directory containing foreign-owned entry: {child_disp}"
                    )
                if stat.S_ISREG(cst.st_mode) and cst.st_nlink > 1:
                    raise RuntimeError(
                        f"Refusing export directory containing hard-linked entry: {child_disp}"
                    )
                if cst.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
                    raise RuntimeError(
                        f"Refusing export directory containing non-private entry: {child_disp}"
                    )
    finally:
        try:
            os.close(dup_fd)
        except OSError:
            pass


def _open_pinned_export_dir(dir_path: Path) -> int:
    parent_fd, leaf_name = _open_pinned_parent_dir(dir_path, create=True)
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    dir_flag = getattr(os, "O_DIRECTORY", 0)
    created = False
    try:
        try:
            os.mkdir(leaf_name, 0o700, dir_fd=parent_fd)
            created = True
        except FileExistsError:
            pass
        try:
            dir_fd = os.open(
                leaf_name, os.O_RDONLY | dir_flag | nofollow, dir_fd=parent_fd
            )
        except OSError as exc:
            raise RuntimeError(
                f"Refusing symlinked or non-directory export path: {dir_path}"
            ) from exc
    finally:
        os.close(parent_fd)
    try:
        if created:
            os.fchmod(dir_fd, 0o700)
        _validate_pinned_dir_fd(dir_fd, dir_path)
        return dir_fd
    except Exception:
        os.close(dir_fd)
        raise


def _open_pinned_subdir(
    parent_dir_fd: int, sub_name: str, display_path: Path
) -> int:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    dir_flag = getattr(os, "O_DIRECTORY", 0)
    created = False
    try:
        os.mkdir(sub_name, 0o700, dir_fd=parent_dir_fd)
        created = True
    except FileExistsError:
        pass
    try:
        sub_fd = os.open(
            sub_name, os.O_RDONLY | dir_flag | nofollow, dir_fd=parent_dir_fd
        )
    except OSError as exc:
        raise RuntimeError(
            f"Refusing symlinked or non-directory export subdirectory: {display_path}"
        ) from exc
    try:
        if created:
            os.fchmod(sub_fd, 0o700)
        _validate_pinned_dir_fd(sub_fd, display_path)
        return sub_fd
    except Exception:
        os.close(sub_fd)
        raise


def _create_pinned_stage_dir(
    parent_dir_fd: int, prefix: str, display_parent: Path
) -> Tuple[int, str]:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    dir_flag = getattr(os, "O_DIRECTORY", 0)
    for _ in range(64):
        stage_name = f"{prefix}{os.urandom(8).hex()}"
        try:
            os.mkdir(stage_name, 0o700, dir_fd=parent_dir_fd)
        except FileExistsError:
            continue
        try:
            stage_fd = os.open(
                stage_name, os.O_RDONLY | dir_flag | nofollow, dir_fd=parent_dir_fd
            )
            os.fchmod(stage_fd, 0o700)
            _validate_pinned_dir_fd(stage_fd, display_parent / stage_name)
            return stage_fd, stage_name
        except Exception:
            try:
                os.rmdir(stage_name, dir_fd=parent_dir_fd)
            except OSError:
                pass
            raise
    raise RuntimeError(
        f"Failed to allocate staging directory under {display_parent}"
    )


def _cleanup_pinned_stage_dir(
    parent_dir_fd: int, stage_fd: int, stage_name: str
) -> None:
    dup_fd: Optional[int] = None
    try:
        dup_fd = os.dup(stage_fd)
        with os.scandir(dup_fd) as it:
            for entry in it:
                try:
                    os.unlink(entry.name, dir_fd=stage_fd)
                except OSError:
                    pass
    except OSError:
        pass
    finally:
        if dup_fd is not None:
            try:
                os.close(dup_fd)
            except OSError:
                pass
        try:
            os.close(stage_fd)
        except OSError:
            pass
        try:
            os.rmdir(stage_name, dir_fd=parent_dir_fd)
        except OSError:
            pass


def _read_regular_owned_bytes_at(
    dir_fd: int,
    leaf_name: str,
    display_path: Path,
    max_bytes: Optional[int] = None,
    enforce_private_mode: bool = False,
) -> bytes:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    uid = os.getuid() if hasattr(os, "getuid") else 0
    try:
        fd = os.open(leaf_name, os.O_RDONLY | nofollow, dir_fd=dir_fd)
    except OSError as exc:
        raise RuntimeError(
            f"Refusing to read missing or symlinked file: {display_path}"
        ) from exc
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise RuntimeError(
                f"Refusing to read non-regular file: {display_path}"
            )
        if hasattr(os, "getuid") and st.st_uid != uid:
            raise RuntimeError(
                f"Refusing to read file not owned by current user: {display_path}"
            )
        if st.st_nlink > 1:
            raise RuntimeError(
                f"Refusing to read hard-linked file: {display_path}"
            )
        if enforce_private_mode:
            os.fchmod(fd, 0o600)
        elif st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise RuntimeError(
                f"Refusing to read non-private file: {display_path}"
            )
        chunks: List[bytes] = []
        remaining = max_bytes
        while True:
            to_read = 65536 if remaining is None else min(65536, remaining)
            if to_read <= 0:
                break
            buf = os.read(fd, to_read)
            if not buf:
                break
            chunks.append(buf)
            if remaining is not None:
                remaining -= len(buf)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _sha256_at(dir_fd: int, leaf_name: str, display_path: Path) -> str:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    uid = os.getuid() if hasattr(os, "getuid") else 0
    try:
        fd = os.open(leaf_name, os.O_RDONLY | nofollow, dir_fd=dir_fd)
    except OSError as exc:
        raise RuntimeError(
            f"Refusing to hash missing or symlinked file: {display_path}"
        ) from exc
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise RuntimeError(
                f"Refusing to hash non-regular file: {display_path}"
            )
        if hasattr(os, "getuid") and st.st_uid != uid:
            raise RuntimeError(
                f"Refusing to hash file not owned by current user: {display_path}"
            )
        if st.st_nlink > 1:
            raise RuntimeError(
                f"Refusing to hash hard-linked file: {display_path}"
            )
        h = hashlib.sha256()
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            h.update(chunk)
        return h.hexdigest()
    finally:
        os.close(fd)


def _ensure_private_export_dir(dir_path: Path) -> None:
    dir_fd = _open_pinned_export_dir(dir_path)
    os.close(dir_fd)


def _open_pinned_parent_dir(target_path: Path, create: bool = False) -> Tuple[int, str]:
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
        if hasattr(os, "getuid") and st_parent.st_uid != uid and not (
            st_parent.st_mode & stat.S_ISVTX
        ):
            raise RuntimeError(
                f"Refusing to write inside directory not owned by current user: {target_path.parent}"
            )
        return cur_fd, leaf_name
    except Exception:
        os.close(cur_fd)
        raise


def _validate_existing_in_dir_fd(
    dir_fd: int, leaf_name: str, display_path: Path
) -> None:
    try:
        st = os.stat(leaf_name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
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


def _write_text_nofollow(file_path: Path, text: str, mode: int = 0o600) -> None:
    """Atomically write text to file_path via a pinned parent directory descriptor and renameat."""
    dir_fd, leaf_name = _open_pinned_parent_dir(file_path, create=True)
    tmp_name: Optional[str] = None
    try:
        _validate_existing_in_dir_fd(dir_fd, leaf_name, file_path)
        nofollow = getattr(os, "O_NOFOLLOW", 0)
        fd: Optional[int] = None
        for _ in range(64):
            cand = f".{leaf_name}.{os.urandom(8).hex()}.tmp"
            try:
                fd = os.open(
                    cand,
                    os.O_RDWR | os.O_CREAT | os.O_EXCL | nofollow,
                    mode,
                    dir_fd=dir_fd,
                )
                tmp_name = cand
                break
            except FileExistsError:
                continue
        if fd is None or tmp_name is None:
            raise RuntimeError(f"Failed to allocate temp file for {file_path}")
        try:
            os.fchmod(fd, mode)
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


def _can_read_font_file(path: Path) -> bool:
    try:
        if not os.access(path, os.R_OK):
            return False
        with path.open("rb") as fh:
            return len(fh.read(4)) == 4
    except OSError:
        return False


def check_pingfang_font_access() -> Dict[str, Any]:
    """Verify that an actual PingFang font asset is readable and AssetsV2 is not sandbox-blocked."""
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
    if not os.access(PINGFANG_ASSET_ROOT, os.R_OK):
        return {
            "platform": "Darwin",
            "accessible": False,
            "pingfangPaths": [],
            "reason": f"Sandbox blocked read access to {PINGFANG_ASSET_ROOT}",
        }
    try:
        found: List[str] = []
        blocked_paths: List[str] = []
        for font_dir in PINGFANG_ASSET_ROOT.glob("com_apple_MobileAsset_Font*"):
            if not os.access(font_dir, os.R_OK):
                blocked_paths.append(str(font_dir))
                continue
            for ttc in font_dir.rglob("PingFang*.ttc"):
                if _can_read_font_file(ttc):
                    found.append(str(ttc))
                    break
                blocked_paths.append(str(ttc))
            if found:
                break
        if blocked_paths and not found:
            return {
                "platform": "Darwin",
                "accessible": False,
                "pingfangPaths": [],
                "reason": f"Sandbox blocked font asset path(s): {blocked_paths[0]}",
            }
        if not found:
            for fb in PINGFANG_FALLBACK_PATHS:
                if fb.exists() and _can_read_font_file(fb):
                    found.append(str(fb))
                    break
        accessible = len(found) > 0
        result: Dict[str, Any] = {
            "platform": "Darwin",
            "accessible": accessible,
            "pingfangPaths": found,
        }
        if not accessible:
            result["reason"] = (
                f"No readable PingFang font file found under {PINGFANG_ASSET_ROOT} or system font reserves"
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
    _validate_regular_owned_file(png_path)
    with png_path.open("rb") as fh:
        header = fh.read(24)
    if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR":
        width, height = struct.unpack(">II", header[16:24])
        return int(width), int(height)
    return 0, 0


def sha256_file(path: Path) -> str:
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        raise RuntimeError(f"Refusing to hash non-regular or symlinked file: {path}")
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _is_valid_webp_header(header: bytes) -> bool:
    if len(header) < 21:
        return False
    if header[:4] != b"RIFF" or header[8:12] != b"WEBP":
        return False
    chunk_tag = header[12:16]
    if chunk_tag not in (b"VP8L", b"VP8 ", b"VP8X"):
        return False
    if chunk_tag == b"VP8L" and (header[20:21] != b"\x2f" or header[20:24] == b"\x89PNG"):
        return False
    return True


def _is_valid_webp_file(webp_path: Path) -> bool:
    """Verify RIFF....WEBP container and ensure payload is not raw PNG bytes."""
    try:
        _validate_regular_owned_file(webp_path)
    except (FileNotFoundError, RuntimeError):
        return False
    return _is_valid_webp_header(webp_path.read_bytes()[:32])


def convert_png_to_lossless_webp(
    png_path: Path,
    webp_path: Path,
    cwebp_bin: str = "cwebp",
    dir_fd: Optional[int] = None,
) -> bool:
    """Convert PNG to lossless WebP using cwebp via a pinned parent directory descriptor and renameat."""
    resolved = shutil.which(cwebp_bin)
    if not resolved and Path(cwebp_bin).exists():
        resolved = os.path.abspath(str(Path(cwebp_bin)))
    if not resolved:
        raise RuntimeError(
            f"Lossless WebP encoder '{cwebp_bin}' not found in PATH; install webp (cwebp) or pass --no-webp."
        )
    resolved_abs = os.path.abspath(resolved) if os.path.sep in resolved else resolved

    owns_dir_fd = False
    if dir_fd is None:
        dir_fd, webp_leaf = _open_pinned_parent_dir(webp_path, create=False)
        owns_dir_fd = True
    else:
        webp_leaf = webp_path.name

    png_leaf = png_path.name
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    tmp_name: Optional[str] = None
    try:
        _read_regular_owned_bytes_at(dir_fd, png_leaf, png_path, max_bytes=24)
        _validate_existing_in_dir_fd(dir_fd, webp_leaf, webp_path)
        for _ in range(64):
            cand = f".{webp_leaf}.{os.urandom(8).hex()}.webp"
            try:
                tfd = os.open(
                    cand,
                    os.O_RDWR | os.O_CREAT | os.O_EXCL | nofollow,
                    0o600,
                    dir_fd=dir_fd,
                )
                os.fchmod(tfd, 0o600)
                os.close(tfd)
                tmp_name = cand
                break
            except FileExistsError:
                continue
        if tmp_name is None:
            raise RuntimeError(f"Failed to allocate temp WebP file for {webp_path}")

        proc = subprocess.run(
            [resolved_abs, "-lossless", "-q", "100", png_leaf, "-o", tmp_name],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            preexec_fn=lambda: os.fchdir(dir_fd),
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"cwebp lossless conversion failed (exit {proc.returncode}): {proc.stderr.strip()}"
            )
        header = _read_regular_owned_bytes_at(
            dir_fd,
            tmp_name,
            webp_path.parent / tmp_name,
            max_bytes=32,
            enforce_private_mode=True,
        )
        if not _is_valid_webp_header(header):
            raise RuntimeError(
                f"cwebp output at {webp_path} is missing or is not a valid WebP bitstream"
            )
        _validate_existing_in_dir_fd(dir_fd, webp_leaf, webp_path)
        os.replace(tmp_name, webp_leaf, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        tmp_name = None
    finally:
        if tmp_name is not None:
            try:
                os.unlink(tmp_name, dir_fd=dir_fd)
            except OSError:
                pass
        if owns_dir_fd:
            os.close(dir_fd)
    return True


def inspect_sketch_artboards_and_clocks(
    sketch_path: Path,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    artboards: List[Dict[str, Any]] = []
    clock_layers: List[Dict[str, Any]] = []

    with zipfile.ZipFile(sketch_path, "r") as zf:
        namelist = sorted(zf.namelist())
        symbol_masters: Dict[str, Dict[str, Any]] = {}

        if "document.json" in namelist:
            doc_data = json.loads(zf.read("document.json").decode("utf-8"))
            for fsym in doc_data.get("foreignSymbols") or []:
                if not isinstance(fsym, dict):
                    continue
                sm = fsym.get("symbolMaster") or fsym.get("originalMaster") or {}
                if isinstance(sm, dict) and sm:
                    sid = str(sm.get("symbolID") or sm.get("do_objectID") or "")
                    if sid:
                        symbol_masters[sid] = sm

        pages_list: List[Tuple[str, Dict[str, Any]]] = []
        for member in namelist:
            if not (member.startswith("pages/") and member.endswith(".json")):
                continue
            page = json.loads(zf.read(member).decode("utf-8"))
            pages_list.append((member, page))

            def index_masters(node: Dict[str, Any]) -> None:
                if node.get("_class") == "symbolMaster":
                    sid = str(node.get("symbolID") or node.get("do_objectID") or "")
                    if sid:
                        symbol_masters[sid] = node
                for ch in node.get("layers") or []:
                    if isinstance(ch, dict):
                        index_masters(ch)

            index_masters(page)

        for _, page in pages_list:
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

                def walk_symbol_master(
                    sm_node: Dict[str, Any],
                    root_instance_id: str,
                    ancestors: List[str],
                    ox: float,
                    oy: float,
                    path_prefix: str,
                    string_overrides: Dict[str, str],
                    symbol_id_overrides: Dict[str, str],
                    visited_syms: Set[str],
                ) -> None:
                    sm_name = str(sm_node.get("name", ""))
                    master_anc = ancestors + ([sm_name] if sm_name else [])

                    def walk_master_child(
                        mnode: Dict[str, Any],
                        cur_anc: List[str],
                        mx: float,
                        my: float,
                    ) -> None:
                        if not bool(mnode.get("isVisible", True)):
                            return
                        mcls = mnode.get("_class")
                        mf = mnode.get("frame") or {}
                        cx = mx + float(mf.get("x", 0.0))
                        cy = my + float(mf.get("y", 0.0))
                        mname = str(mnode.get("name", ""))
                        moid = str(mnode.get("do_objectID", ""))
                        full_key = f"{path_prefix}{moid}" if moid else ""

                        if mcls == "text":
                            attr_str = mnode.get("attributedString") or {}
                            raw_txt = str(attr_str.get("string", ""))
                            txt = str(
                                string_overrides.get(full_key, raw_txt)
                                if full_key
                                else raw_txt
                            ).strip()
                            if _is_statusbar_clock_layer(txt, mname, cur_anc, cy):
                                clock_layers.append(
                                    {
                                        "pageID": page_id,
                                        "artboardID": ab_id,
                                        "layerID": moid or root_instance_id,
                                        "instanceID": root_instance_id,
                                        "layerName": mname,
                                        "text": txt,
                                    }
                                )
                        elif mcls == "symbolInstance":
                            eff_sym_id = str(
                                symbol_id_overrides.get(
                                    full_key, mnode.get("symbolID", "")
                                )
                                if full_key
                                else mnode.get("symbolID", "")
                            )
                            if (
                                eff_sym_id
                                and eff_sym_id.lower() != "none"
                                and eff_sym_id not in visited_syms
                            ):
                                nested_sm = symbol_masters.get(eff_sym_id)
                                if nested_sm is not None:
                                    next_prefix = (
                                        f"{full_key}/" if full_key else path_prefix
                                    )
                                    merged_str_ovr = dict(string_overrides)
                                    merged_sym_ovr = dict(symbol_id_overrides)
                                    for nov in mnode.get("overrideValues") or []:
                                        if not isinstance(nov, dict):
                                            continue
                                        nov_name = str(nov.get("overrideName", ""))
                                        if "_" not in nov_name:
                                            continue
                                        nprefix, nprop = nov_name.rsplit("_", 1)
                                        nval = nov.get("value")
                                        scoped_key = f"{next_prefix}{nprefix}"
                                        if (
                                            nprop == "stringValue"
                                            and isinstance(nval, str)
                                        ):
                                            merged_str_ovr.setdefault(
                                                scoped_key, nval
                                            )
                                        elif (
                                            nprop == "symbolID"
                                            and isinstance(nval, str)
                                        ):
                                            merged_sym_ovr.setdefault(
                                                scoped_key, nval
                                            )
                                    walk_symbol_master(
                                        nested_sm,
                                        root_instance_id,
                                        cur_anc + ([mname] if mname else []),
                                        cx,
                                        cy,
                                        next_prefix,
                                        merged_str_ovr,
                                        merged_sym_ovr,
                                        visited_syms | {eff_sym_id},
                                    )

                        next_anc = cur_anc + ([mname] if mname else [])
                        for mch in mnode.get("layers") or []:
                            if isinstance(mch, dict):
                                walk_master_child(mch, next_anc, cx, cy)

                    for ch in sm_node.get("layers") or []:
                        if isinstance(ch, dict):
                            walk_master_child(ch, master_anc, ox, oy)

                def walk(
                    node: Dict[str, Any],
                    ancestors: List[str],
                    ox: float,
                    oy: float,
                ) -> None:
                    if not bool(node.get("isVisible", True)):
                        return
                    is_ab = node.get("_class") == "artboard"
                    nf = node.get("frame") or {}
                    cur_x = 0.0 if is_ab else ox + float(nf.get("x", 0.0))
                    cur_y = 0.0 if is_ab else oy + float(nf.get("y", 0.0))
                    lname = str(node.get("name", ""))
                    if node.get("_class") == "text":
                        attr_str = node.get("attributedString") or {}
                        txt = str(attr_str.get("string", "")).strip()
                        if _is_statusbar_clock_layer(txt, lname, ancestors, cur_y):
                            clock_layers.append(
                                {
                                    "pageID": page_id,
                                    "artboardID": ab_id,
                                    "layerID": str(node.get("do_objectID", "")),
                                    "layerName": lname,
                                    "text": txt,
                                }
                            )
                    elif node.get("_class") == "symbolInstance":
                        sym_id = str(node.get("symbolID", ""))
                        inst_id = str(node.get("do_objectID", ""))
                        string_ovr: Dict[str, str] = {}
                        sym_id_ovr: Dict[str, str] = {}
                        for ov in node.get("overrideValues") or []:
                            if not isinstance(ov, dict):
                                continue
                            ov_name = str(ov.get("overrideName", ""))
                            if "_" not in ov_name:
                                continue
                            prefix_key, prop = ov_name.rsplit("_", 1)
                            val = ov.get("value")
                            if prop == "stringValue" and isinstance(val, str):
                                string_ovr[prefix_key] = val
                            elif prop == "symbolID" and isinstance(val, str):
                                sym_id_ovr[prefix_key] = val
                        sm = symbol_masters.get(sym_id) if sym_id else None
                        if sm is not None and sym_id:
                            walk_symbol_master(
                                sm,
                                inst_id,
                                ancestors + ([lname] if lname else []),
                                cur_x,
                                cur_y,
                                "",
                                string_ovr,
                                sym_id_ovr,
                                {sym_id},
                            )
                    next_anc = ancestors + ([lname] if not is_ab else [])
                    for ch in node.get("layers") or []:
                        if isinstance(ch, dict):
                            walk(ch, next_anc, cur_x, cur_y)

                walk(top, [ab_name], 0.0, 0.0)

    return artboards, clock_layers


def _parse_png_dimensions_at(
    dir_fd: int, leaf_name: str, display_path: Path
) -> Tuple[int, int]:
    head = _read_regular_owned_bytes_at(
        dir_fd, leaf_name, display_path, max_bytes=24
    )
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise ValueError(f"Invalid PNG header in {display_path}")
    w, h = struct.unpack(">II", head[16:24])
    return int(w), int(h)


def _verify_pdf_sfns_regular_at(
    dir_fd: int, leaf_name: str, pdf_path: Path
) -> Dict[str, Any]:
    raw = _read_regular_owned_bytes_at(dir_fd, leaf_name, pdf_path)
    text_latin = raw.decode("latin-1", errors="ignore")
    has_sfns = ".SFNS-Regular" in text_latin or "SFNS-Regular" in text_latin
    has_truetype = "/Subtype /TrueType" in text_latin or "/Subtype/TrueType" in text_latin
    has_heiti_fallback = "Heiti" in text_latin or "STHeiti" in text_latin
    return {
        "pdfPath": str(pdf_path),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "hasSFNSRegular": has_sfns,
        "hasTrueTypeSubtype": has_truetype,
        "hasHeitiFallback": has_heiti_fallback,
        "valid": has_sfns and has_truetype and not has_heiti_fallback,
    }


def verify_pdf_sfns_regular(pdf_path: Path) -> Dict[str, Any]:
    dir_fd, leaf_name = _open_pinned_parent_dir(pdf_path, create=False)
    try:
        return _verify_pdf_sfns_regular_at(dir_fd, leaf_name, pdf_path)
    finally:
        os.close(dir_fd)


def _export_one_artboard_scale(
    sketchtool: str,
    sketch_path: Path,
    artboard: Dict[str, Any],
    scale: str,
    out_dir: Path,
    export_webp: bool,
    cwebp_bin: str = "cwebp",
    scale_dir_fd: Optional[int] = None,
) -> Dict[str, Any]:
    ab_id = artboard["artboardID"]
    scale_dir = out_dir / f"{scale}x"
    owns_scale_fd = False
    if scale_dir_fd is None:
        scale_dir_fd = _open_pinned_export_dir(scale_dir)
        owns_scale_fd = True

    sketchtool_bin = (
        os.path.abspath(sketchtool)
        if (os.path.sep in sketchtool or Path(sketchtool).exists())
        else sketchtool
    )
    sketch_abs = os.path.abspath(str(sketch_path))

    try:
        allowed_png_names = (f"{ab_id}.png", f"{ab_id}@{scale}x.png")
        allowed_webp_names = (f"{ab_id}.webp", f"{ab_id}@{scale}x.webp")
        dup_fd = os.dup(scale_dir_fd)
        try:
            with os.scandir(dup_fd) as it:
                for entry in it:
                    if entry.name.startswith(ab_id):
                        child_disp = scale_dir / entry.name
                        if (
                            entry.name not in allowed_png_names
                            and entry.name not in allowed_webp_names
                        ):
                            raise RuntimeError(
                                f"Refusing pre-existing unexpected render entry in export directory: {child_disp}"
                            )
                        _validate_existing_in_dir_fd(
                            scale_dir_fd, entry.name, child_disp
                        )
        finally:
            try:
                os.close(dup_fd)
            except OSError:
                pass

        stage_fd, stage_name = _create_pinned_stage_dir(
            scale_dir_fd, f".stage-{ab_id}-", scale_dir
        )
        staged_leaf: Optional[str] = None
        try:
            cmd = [
                sketchtool_bin,
                "export",
                "artboards",
                sketch_abs,
                f"--item={ab_id}",
                f"--scales={scale}",
                "--formats=png",
                "--use-id-for-name=YES",
                "--output=.",
            ]
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
                preexec_fn=lambda: os.fchdir(stage_fd),
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"sketchtool export artboards failed for {ab_id}@{scale}x: {proc.stderr.strip()}"
                )

            for candidate_name in allowed_png_names:
                try:
                    os.stat(
                        candidate_name, dir_fd=stage_fd, follow_symlinks=False
                    )
                except FileNotFoundError:
                    continue
                _read_regular_owned_bytes_at(
                    stage_fd,
                    candidate_name,
                    scale_dir / stage_name / candidate_name,
                    max_bytes=24,
                    enforce_private_mode=True,
                )
                staged_leaf = candidate_name
                break
            if staged_leaf is None:
                raise FileNotFoundError(
                    f"sketchtool produced no exact PNG ({allowed_png_names}) for artboard {ab_id} in {scale_dir / stage_name}"
                )
            png_path = scale_dir / staged_leaf
            _validate_existing_in_dir_fd(scale_dir_fd, staged_leaf, png_path)
            os.replace(
                staged_leaf,
                staged_leaf,
                src_dir_fd=stage_fd,
                dst_dir_fd=scale_dir_fd,
            )
        finally:
            _cleanup_pinned_stage_dir(scale_dir_fd, stage_fd, stage_name)

        w, h = _parse_png_dimensions_at(scale_dir_fd, staged_leaf, png_path)
        png_sha = _sha256_at(scale_dir_fd, staged_leaf, png_path)

        entry_res: Dict[str, Any] = {
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
            convert_png_to_lossless_webp(
                png_path,
                webp_path,
                cwebp_bin=cwebp_bin,
                dir_fd=scale_dir_fd,
            )
            entry_res["webpPath"] = str(webp_path)
            entry_res["webpSha256"] = _sha256_at(
                scale_dir_fd, webp_path.name, webp_path
            )
        return entry_res
    finally:
        if owns_scale_fd:
            os.close(scale_dir_fd)


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
    out_dir_fd = _open_pinned_export_dir(output_dir)
    scale_dir_fds: Dict[str, int] = {}
    pdf_dir_fd: Optional[int] = None
    sketchtool_bin = (
        os.path.abspath(sketchtool)
        if (os.path.sep in sketchtool or Path(sketchtool).exists())
        else sketchtool
    )
    sketch_abs = os.path.abspath(str(sketch_path))

    try:
        for sc in scales:
            if sc not in scale_dir_fds:
                scale_dir_fds[sc] = _open_pinned_subdir(
                    out_dir_fd, f"{sc}x", output_dir / f"{sc}x"
                )

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
                    scale_dir_fds[sc],
                )
                for ab, sc in tasks
            ]
            for fut in futures:
                exported_renders.append(fut.result())

        clock_pdf_checks: List[Dict[str, Any]] = []
        if verify_clock_pdf and clock_layers:
            pdf_dir = output_dir / "pdf_layers"
            pdf_dir_fd = _open_pinned_subdir(out_dir_fd, "pdf_layers", pdf_dir)
            for clock in clock_layers:
                lid = clock["layerID"]
                inst_id = str(clock.get("instanceID") or "")
                candidate_ids = [lid] + (
                    [inst_id] if inst_id and inst_id != lid else []
                )
                stage_pdf_fd, stage_pdf_name = _create_pinned_stage_dir(
                    pdf_dir_fd, f".stage-{lid}-", pdf_dir
                )
                try:
                    staged_pdf_leaf: Optional[str] = None
                    last_err = ""
                    for cid in candidate_ids:
                        cmd = [
                            sketchtool_bin,
                            "export",
                            "layers",
                            sketch_abs,
                            f"--item={cid}",
                            "--formats=pdf",
                            "--use-id-for-name=YES",
                            "--output=.",
                        ]
                        proc = subprocess.run(
                            cmd,
                            capture_output=True,
                            text=True,
                            timeout=60,
                            check=False,
                            preexec_fn=lambda: os.fchdir(stage_pdf_fd),
                        )
                        if proc.returncode != 0:
                            last_err = proc.stderr.strip()
                            continue
                        cand_leaf = f"{cid}.pdf"
                        try:
                            os.stat(
                                cand_leaf,
                                dir_fd=stage_pdf_fd,
                                follow_symlinks=False,
                            )
                            staged_pdf_leaf = cand_leaf
                            break
                        except FileNotFoundError:
                            last_err = (
                                f"No exact PDF ({cand_leaf}) exported for layer {cid}"
                            )

                    if staged_pdf_leaf is None:
                        clock_pdf_checks.append(
                            {
                                **clock,
                                "valid": False,
                                "error": last_err
                                or f"No exact PDF ({lid}.pdf) exported for layer {lid}",
                            }
                        )
                        continue
                    _read_regular_owned_bytes_at(
                        stage_pdf_fd,
                        staged_pdf_leaf,
                        pdf_dir / stage_pdf_name / staged_pdf_leaf,
                        max_bytes=16,
                        enforce_private_mode=True,
                    )
                    default_pdf_exists = False
                    if inst_id:
                        try:
                            os.stat(
                                f"{lid}.pdf",
                                dir_fd=pdf_dir_fd,
                                follow_symlinks=False,
                            )
                            default_pdf_exists = True
                        except FileNotFoundError:
                            default_pdf_exists = False
                    pdf_filename = (
                        f"{inst_id}_{lid}.pdf"
                        if inst_id and default_pdf_exists
                        else f"{lid}.pdf"
                    )
                    final_pdf = pdf_dir / pdf_filename
                    _validate_existing_in_dir_fd(
                        pdf_dir_fd, pdf_filename, final_pdf
                    )
                    os.replace(
                        staged_pdf_leaf,
                        pdf_filename,
                        src_dir_fd=stage_pdf_fd,
                        dst_dir_fd=pdf_dir_fd,
                    )
                finally:
                    _cleanup_pinned_stage_dir(
                        pdf_dir_fd, stage_pdf_fd, stage_pdf_name
                    )
                pdf_info = _verify_pdf_sfns_regular_at(
                    pdf_dir_fd, pdf_filename, final_pdf
                )
                clock_pdf_checks.append({**clock, **pdf_info})
    finally:
        if pdf_dir_fd is not None:
            try:
                os.close(pdf_dir_fd)
            except OSError:
                pass
        for sfd in scale_dir_fds.values():
            try:
                os.close(sfd)
            except OSError:
                pass
        try:
            os.close(out_dir_fd)
        except OSError:
            pass

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
                    or bool(prev.get("webpSha256") or prev.get("webpPath"))
                    != bool(cur.get("webpSha256") or cur.get("webpPath"))
                    or (
                        (
                            prev.get("webpSha256") is not None
                            or cur.get("webpSha256") is not None
                        )
                        and prev.get("webpSha256") != cur.get("webpSha256")
                    )
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
            current_artboards_by_id = {ab["artboardID"]: ab for ab in artboards}
            for prev_ab in existing.get("artboards") or []:
                if isinstance(prev_ab, dict):
                    prev_ab_id = prev_ab.get("id") or prev_ab.get("artboardID")
                    if prev_ab_id:
                        cur_ab = current_artboards_by_id.get(str(prev_ab_id))
                        if cur_ab is None:
                            manifest_mismatches.append(
                                {
                                    "type": "missing_artboard_in_export",
                                    "artboardID": str(prev_ab_id),
                                    "expected": prev_ab,
                                }
                            )
                        elif (
                            (
                                prev_ab.get("width") is not None
                                and prev_ab.get("width") != cur_ab["width"]
                            )
                            or (
                                prev_ab.get("height") is not None
                                and prev_ab.get("height") != cur_ab["height"]
                            )
                            or (
                                prev_ab.get("name") is not None
                                and prev_ab.get("name") != cur_ab["artboardName"]
                            )
                        ):
                            manifest_mismatches.append(
                                {
                                    "type": "artboard_metadata_mismatch",
                                    "artboardID": str(prev_ab_id),
                                    "expected": prev_ab,
                                    "actual": {
                                        "id": cur_ab["artboardID"],
                                        "name": cur_ab["artboardName"],
                                        "pageID": cur_ab["pageID"],
                                        "width": cur_ab["width"],
                                        "height": cur_ab["height"],
                                    },
                                }
                            )
        else:
            _write_text_nofollow(
                target_json_path,
                json.dumps(manifest_payload, ensure_ascii=False, indent=2) + "\n",
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
        _write_text_nofollow(Path(args.output), out_str + "\n")
    print(out_str)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
