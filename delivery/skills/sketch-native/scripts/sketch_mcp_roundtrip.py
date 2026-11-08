#!/usr/bin/env python3
"""Non-activating native Sketch MCP roundtrip verifier with save receipts.

Executes the verification protocol against `http://localhost:31126/mcp`:
1. Pre-check open documents on `:31126/mcp`: confirm persistent `--anchor-id` is open
   and no stray working documents remain (`matching: []`).
2. Background non-activating open: `open -g -a /Applications/Sketch.app <copy.sketch>`,
   polling until `doc.id` is ready.
3. Capture pre-edit `get_screenshot`, then run lightweight multiline JS `run_code`
   (`{"title": "...", "script": "..."}`, reading only top-level counts + locating 1-3
   target layers by ID on a target page to apply override/focus-border edits +
   `doc.processPendingChanges()`). Save once to the bound copy path and require
   the matching asynchronous completion receipt before proceeding.
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
import ast
import base64
import hashlib
import http.client
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from sketch_archive import (
    MAX_ZIP_JSON_MEMBER_BYTES,
    parse_archive_json as _loads_json_bounded,
)
from sketch_json import (
    new_budget as _new_dom_budget,
)


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


MAX_SKETCH_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_EDIT_SPEC_BYTES = 4 * 1024 * 1024
MAX_MCP_RESPONSE_BYTES = 32 * 1024 * 1024


def _open_regular_owned_fd_nofollow(
    file_path: Path, max_bytes: int = MAX_SKETCH_ARCHIVE_BYTES
) -> int:
    """Open a regular current-user-owned file via a pinned parent directory descriptor and O_NOFOLLOW with size cap."""
    dir_fd, leaf_name = _open_pinned_parent_dir(file_path, create=False)
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    try:
        try:
            st = os.stat(leaf_name, dir_fd=dir_fd, follow_symlinks=False)
        except FileNotFoundError as exc:
            raise FileNotFoundError(
                f"Disposable .sketch copy not found: {file_path}"
            ) from exc
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
        if st.st_size > max_bytes:
            raise RuntimeError(
                f"Input file exceeds size limit ({st.st_size} > {max_bytes}): {file_path}"
            )
        try:
            fd = os.open(leaf_name, os.O_RDONLY | nofollow, dir_fd=dir_fd)
        except OSError as exc:
            raise RuntimeError(f"Refusing to read symlinked file: {file_path}") from exc
        try:
            fst = os.fstat(fd)
            if (
                not stat.S_ISREG(fst.st_mode)
                or fst.st_ino != st.st_ino
                or fst.st_dev != st.st_dev
            ):
                raise RuntimeError(f"Race detected while opening file: {file_path}")
            if hasattr(os, "getuid") and fst.st_uid != os.getuid():
                raise RuntimeError(
                    f"Refusing to read file not owned by current user: {file_path}"
                )
            if fst.st_nlink > 1:
                raise RuntimeError(f"Refusing to read hard-linked file: {file_path}")
            if fst.st_size > max_bytes:
                raise RuntimeError(
                    f"Input file exceeds size limit ({fst.st_size} > {max_bytes}): {file_path}"
                )
            return fd
        except Exception:
            os.close(fd)
            raise
    finally:
        os.close(dir_fd)


def _read_regular_owned_bytes_nofollow(
    file_path: Path, max_bytes: int = MAX_SKETCH_ARCHIVE_BYTES
) -> bytes:
    """Read a regular current-user-owned file via a pinned parent directory descriptor and O_NOFOLLOW with size cap."""
    fd = _open_regular_owned_fd_nofollow(file_path, max_bytes=max_bytes)
    try:
        chunks: List[bytes] = []
        total = 0
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(
                    f"Input file exceeds size limit ({total} > {max_bytes}): {file_path}"
                )
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _stream_fd_to_file_nofollow(
    src_fd: int,
    file_path: Path,
    max_bytes: int = MAX_SKETCH_ARCHIVE_BYTES,
    mode: int = 0o600,
) -> None:
    """Stream-copy from a pinned source descriptor to file_path with strict byte limit and atomic rename."""
    os.lseek(src_fd, 0, os.SEEK_SET)
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
            total_copied = 0
            while True:
                chunk = os.read(src_fd, 65536)
                if not chunk:
                    break
                total_copied += len(chunk)
                if total_copied > max_bytes:
                    raise RuntimeError(
                        f"Source file exceeds size limit while streaming ({total_copied} > {max_bytes})"
                    )
                view = memoryview(chunk)
                off = 0
                while off < len(view):
                    written = os.write(fd, view[off:])
                    if written <= 0:
                        raise RuntimeError(f"Short write to {tmp_name}")
                    off += written
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


def _write_bytes_nofollow(file_path: Path, data: bytes, mode: int = 0o600) -> None:
    """Atomically write bytes to file_path via a pinned parent directory descriptor and renameat."""
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


def _verify_pid_matches_sketch(
    pid: int,
    uid: int,
    sketch_app: str,
    require_signed_sketch: bool,
) -> bool:
    ps_bin = "/bin/ps" if os.path.exists("/bin/ps") else shutil.which("ps")
    if not ps_bin:
        return True
    ps_proc = subprocess.run(
        [ps_bin, "-p", str(pid), "-o", "uid=,comm="],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    line = (ps_proc.stdout or "").strip()
    if not line:
        return False
    parts = line.split(None, 1)
    if len(parts) < 2:
        return False
    try:
        ps_uid = int(parts[0])
    except ValueError:
        return False
    if ps_uid != uid:
        return False
    comm_path = os.path.realpath(parts[1].strip())
    if require_signed_sketch:
        sketch_bundle_real = os.path.realpath(sketch_app)
        if not (
            comm_path == sketch_bundle_real
            or comm_path.startswith(sketch_bundle_real + os.sep)
        ):
            return False
        codesign_bin = (
            "/usr/bin/codesign"
            if os.path.exists("/usr/bin/codesign")
            else shutil.which("codesign")
        )
        if codesign_bin:
            cs_proc = subprocess.run(
                [
                    codesign_bin,
                    "--verify",
                    "--deep",
                    "--strict",
                    sketch_bundle_real,
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            if cs_proc.returncode != 0:
                raise RuntimeError(
                    f"Refusing MCP listener: Sketch bundle failed codesign verification ({sketch_bundle_real})"
                )
    return True


def _query_port_tcp_records(lsof_bin: str, port: int) -> List[Dict[str, Any]]:
    proc = subprocess.run(
        [lsof_bin, "-nP", f"-iTCP:{port}", "-F", "fucpnT"],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    records: List[Dict[str, Any]] = []
    cur_pid: Optional[int] = None
    cur_uid: Optional[int] = None
    cur_name: Optional[str] = None
    cur_state: Optional[str] = None

    def flush_fd() -> None:
        nonlocal cur_name, cur_state
        if cur_pid is not None and cur_uid is not None and cur_name is not None:
            records.append(
                {
                    "pid": cur_pid,
                    "uid": cur_uid,
                    "name": cur_name,
                    "state": cur_state or ("ESTABLISHED" if "->" in cur_name else "LISTEN"),
                }
            )
        cur_name = None
        cur_state = None

    for raw_line in (proc.stdout or "").splitlines():
        if raw_line.startswith("p"):
            flush_fd()
            try:
                cur_pid = int(raw_line[1:].strip())
            except ValueError:
                cur_pid = None
            cur_uid = None
        elif raw_line.startswith("u"):
            try:
                cur_uid = int(raw_line[1:].strip())
            except ValueError:
                cur_uid = None
        elif raw_line.startswith("f"):
            flush_fd()
        elif raw_line.startswith("n"):
            if cur_name is not None:
                flush_fd()
            cur_name = raw_line[1:].strip()
        elif raw_line.startswith("TST="):
            cur_state = raw_line[4:].strip()
    flush_fd()
    return records


def _format_lsof_endpoint(ip_str: str, port: int) -> str:
    clean_ip = str(ip_str).strip().strip("[]")
    if ":" in clean_ip:
        return f"[{clean_ip}]:{port}"
    return f"{clean_ip}:{port}"


def _verify_mcp_listener_peer(
    endpoint: str,
    sketch_app: str = DEFAULT_SKETCH_APP,
    require_signed_sketch: bool = True,
    connected_sock: Optional[socket.socket] = None,
) -> str:
    """Verify the loopback TCP listener and exact connected socket peer belong to the current user's signed Sketch."""
    parsed = urllib.parse.urlparse(endpoint)
    host_low = (parsed.hostname or "").lower()
    if parsed.scheme != "http" or host_low not in (
        "localhost",
        "127.0.0.1",
        "::1",
    ):
        raise RuntimeError(
            f"Refusing non-loopback or non-HTTP MCP endpoint: {endpoint}"
        )
    default_target_ip = "::1" if host_low == "::1" else "127.0.0.1"
    port = parsed.port or 80
    lsof_bin = (
        "/usr/sbin/lsof"
        if os.path.exists("/usr/sbin/lsof")
        else shutil.which("lsof")
    )
    if not lsof_bin or not hasattr(os, "getuid"):
        return default_target_ip
    uid = os.getuid()
    records = _query_port_tcp_records(lsof_bin, port)
    listen_records = [r for r in records if r["state"] == "LISTEN"]
    if not listen_records:
        raise RuntimeError(
            f"Refusing unauthenticated MCP listener on port {port}: no listener owned by current user (uid={uid})"
        )

    verified_Cache: Dict[int, bool] = {}

    def check_pid(pid_val: int, uid_val: int) -> bool:
        if uid_val != uid:
            return False
        if pid_val not in verified_Cache:
            verified_Cache[pid_val] = _verify_pid_matches_sketch(
                pid_val, uid, sketch_app, require_signed_sketch
            )
        return verified_Cache[pid_val]

    # Reject if ANY listener on this port across any loopback address is unverified or owned by another user
    verified_listen_ips: List[str] = []
    for rec in listen_records:
        if not check_pid(rec["pid"], rec["uid"]):
            raise RuntimeError(
                f"Refusing unauthenticated MCP listener on port {port}: listener process (pid={rec['pid']}, uid={rec['uid']}, addr={rec['name']}) does not match current user's signed Sketch bundle ({sketch_app})"
            )
        lname = rec["name"]
        if (
            lname.startswith("127.0.0.1:")
            or lname.startswith("*:")
            or lname.startswith("0.0.0.0:")
            or lname.startswith("[::]:")
            or lname.startswith("[::ffff:127.0.0.1]:")
        ):
            if "127.0.0.1" not in verified_listen_ips:
                verified_listen_ips.append("127.0.0.1")
        if (
            lname.startswith("[::1]:")
            or lname.startswith("*:")
            or lname.startswith("[::]:")
        ):
            if "::1" not in verified_listen_ips:
                verified_listen_ips.append("::1")

    if connected_sock is not None:
        local_ip, local_port = connected_sock.getsockname()[:2]
        remote_ip, remote_port = connected_sock.getpeername()[:2]
        remote_ep = _format_lsof_endpoint(str(remote_ip), int(remote_port))
        local_ep = _format_lsof_endpoint(str(local_ip), int(local_port))
        rport = int(remote_port)
        allowed_listen_eps = {
            remote_ep,
            f"*:{rport}",
            f"0.0.0.0:{rport}",
            f"[::]:{rport}",
            f"[::ffff:127.0.0.1]:{rport}",
        }

        covering_listeners = [
            r
            for r in listen_records
            if r["name"] in allowed_listen_eps
            and check_pid(r["pid"], r["uid"])
        ]
        if not covering_listeners:
            raise RuntimeError(
                f"Refusing unauthenticated MCP socket peer on {remote_ep}: no verified listener bound to connected address"
            )

        server_est = [
            r
            for r in records
            if r["state"] == "ESTABLISHED"
            and r["name"] == f"{remote_ep}->{local_ep}"
        ]
        for srec in server_est:
            if not check_pid(srec["pid"], srec["uid"]):
                raise RuntimeError(
                    f"Refusing unauthenticated MCP connected socket peer {remote_ep}->{local_ep} (pid={srec['pid']}, uid={srec['uid']})"
                )
        return str(remote_ip)

    if host_low == "127.0.0.1":
        if "127.0.0.1" not in verified_listen_ips:
            raise RuntimeError(
                f"Refusing unauthenticated MCP listener on 127.0.0.1:{port}"
            )
        return "127.0.0.1"
    if host_low == "::1":
        if "::1" not in verified_listen_ips:
            raise RuntimeError(
                f"Refusing unauthenticated MCP listener on [::1]:{port}"
            )
        return "::1"
    if verified_listen_ips:
        return verified_listen_ips[0]
    return default_target_ip


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        raise urllib.error.HTTPError(
            req.full_url,
            code,
            f"Refusing HTTP redirect on loopback MCP endpoint: {msg}",
            headers,
            fp,
        )


class _VerifiedLoopbackHTTPConnection(http.client.HTTPConnection):
    def __init__(
        self,
        host: str,
        port: Optional[int] = None,
        timeout: Any = socket._GLOBAL_DEFAULT_TIMEOUT,
        *,
        endpoint: str,
        sketch_app: str,
        require_signed_sketch: bool,
        **kwargs: Any,
    ) -> None:
        super().__init__(host, port=port, timeout=timeout, **kwargs)
        self._endpoint = endpoint
        self._sketch_app = sketch_app
        self._require_signed_sketch = require_signed_sketch

    def connect(self) -> None:
        target_ip = _verify_mcp_listener_peer(
            self._endpoint,
            sketch_app=self._sketch_app,
            require_signed_sketch=self._require_signed_sketch,
        )
        self.sock = socket.create_connection(
            (target_ip, self.port), self.timeout, self.source_address
        )
        try:
            _verify_mcp_listener_peer(
                self._endpoint,
                sketch_app=self._sketch_app,
                require_signed_sketch=self._require_signed_sketch,
                connected_sock=self.sock,
            )
        except Exception:
            self.close()
            raise


class _VerifiedLoopbackHTTPHandler(urllib.request.HTTPHandler):
    def __init__(
        self,
        endpoint: str,
        sketch_app: str,
        require_signed_sketch: bool,
    ) -> None:
        super().__init__()
        self._endpoint = endpoint
        self._sketch_app = sketch_app
        self._require_signed_sketch = require_signed_sketch

    def http_open(self, req: urllib.request.Request) -> Any:
        return self.do_open(
            self._build_conn,
            req,
        )

    def _build_conn(self, host: str, **kwargs: Any) -> http.client.HTTPConnection:
        return _VerifiedLoopbackHTTPConnection(
            host,
            endpoint=self._endpoint,
            sketch_app=self._sketch_app,
            require_signed_sketch=self._require_signed_sketch,
            **kwargs,
        )


def _build_direct_loopback_opener(
    endpoint: str,
    sketch_app: str = DEFAULT_SKETCH_APP,
    require_signed_sketch: bool = False,
) -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirectHandler(),
        _VerifiedLoopbackHTTPHandler(
            endpoint=endpoint,
            sketch_app=sketch_app,
            require_signed_sketch=require_signed_sketch,
        ),
    )


class MCPToolError(RuntimeError):
    """Retain the original tool response for recovery after an uncertain write."""

    def __init__(self, tool: str, payload: Dict[str, Any], reason: str = "returned an error") -> None:
        super().__init__(f"MCP tool '{tool}' {reason}")
        self.tool = tool
        self.payload = payload


class SketchMCPClient:
    """Minimal JSON-RPC 2.0 HTTP/SSE client for Sketch 2026.3 MCP server."""

    def __init__(
        self,
        endpoint: str = DEFAULT_MCP_URL,
        timeout: float = 10.0,
        sketch_app: str = DEFAULT_SKETCH_APP,
        require_signed_sketch: bool = False,
    ) -> None:
        self.endpoint = endpoint
        self.timeout = timeout
        self.sketch_app = sketch_app
        self.require_signed_sketch = require_signed_sketch
        self.session_id: Optional[str] = None
        self._req_id = 0
        self._initialized = False

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def _post_rpc(
        self, method: str, params: Optional[Dict[str, Any]] = None, is_notification: bool = False
    ) -> Dict[str, Any]:
        _verify_mcp_listener_peer(
            self.endpoint,
            sketch_app=self.sketch_app,
            require_signed_sketch=self.require_signed_sketch,
        )
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
        opener = _build_direct_loopback_opener(
            endpoint=self.endpoint,
            sketch_app=self.sketch_app,
            require_signed_sketch=self.require_signed_sketch,
        )
        with opener.open(req, timeout=self.timeout) as resp:
            sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id")
            if sid:
                self.session_id = sid
            ctype = (resp.headers.get("Content-Type") or "").lower()
            raw_resp = resp.read(MAX_MCP_RESPONSE_BYTES + 1)
            if len(raw_resp) > MAX_MCP_RESPONSE_BYTES:
                raise RuntimeError(
                    f"MCP response exceeds size limit ({MAX_MCP_RESPONSE_BYTES} bytes)"
                )
            body_text = raw_resp.decode("utf-8", errors="replace").strip()

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
            raise MCPToolError(name, rpc_resp)
        result = rpc_resp.get("result") or {}
        if result.get("isError"):
            raise MCPToolError(name, result)
        return result

    def run_code(self, title: str, script: str) -> Dict[str, Any]:
        res = self.call_tool("run_code", {"title": title, "script": script})
        content = res.get("content") or []
        structured = res.get("structuredContent")
        if not content and isinstance(structured, dict):
            return structured
        try:
            if len(content) != 1 or content[0].get("type") != "text":
                raise ValueError("expected one complete JSON log")
            text = content[0]["text"].strip()
            # Sketch's console inspector escapes strings as single-quoted literals.
            if text.startswith("'"):
                text = ast.literal_eval(text)
            result = json.loads(text)
            if not isinstance(result, dict):
                raise ValueError("expected a JSON object")
            if structured is not None and structured != result:
                raise ValueError("conflicting structured and text results")
            return result
        except (ValueError, SyntaxError, TypeError, KeyError, AttributeError) as exc:
            raise MCPToolError("run_code", res, f"returned an invalid result: {exc}") from exc

    def get_screenshot(
        self,
        *,
        document_id: str,
        layer_id: str,
    ) -> bytes:
        if not document_id or not layer_id:
            raise ValueError("Screenshot requires an explicit document and layer ID")
        res = self.call_tool("get_screenshot", {
            "targetDocumentID": document_id, "layerID": layer_id,
        })
        try:
            content = res.get("content") or []
            if len(content) != 1 or res.get("structuredContent") is not None:
                raise ValueError("expected one screenshot result")
            block = content[0]
            if block.get("type") == "image" and block.get("mimeType") == "image/png":
                png = base64.b64decode(block["data"], validate=True)
            elif block.get("type") == "text":
                text = block["text"].strip()
                prefix = "The screenshot has been generated at "
                if text.startswith(prefix):
                    path = Path(text[len(prefix):])
                    temporary_root = Path(tempfile.gettempdir()).resolve()
                    if (not path.is_absolute() or path.suffix.lower() != ".png"
                            or not path.resolve().is_relative_to(temporary_root)):
                        raise ValueError("screenshot path must be a PNG in the system temporary directory")
                    png = _read_regular_owned_bytes_nofollow(path, max_bytes=MAX_MCP_RESPONSE_BYTES)
                else:
                    payload = json.loads(text)
                    if not isinstance(payload, dict) or set(payload) != {"imageBase64"}:
                        raise ValueError("unexpected screenshot text")
                    png = base64.b64decode(payload["imageBase64"], validate=True)
            else:
                raise ValueError("unexpected screenshot content type")
            if (len(png) < 45 or len(png) > MAX_MCP_RESPONSE_BYTES
                    or png[:8] != b"\x89PNG\r\n\x1a\n" or png[8:16] != b"\x00\x00\x00\rIHDR"
                    or not int.from_bytes(png[16:20], "big") or not int.from_bytes(png[20:24], "big")
                    or png[-12:] != b"\x00\x00\x00\x00IEND\xaeB`\x82"):
                raise ValueError("invalid or incomplete PNG framing")
            return png
        except (ValueError, TypeError, KeyError, AttributeError, OSError, RuntimeError) as exc:
            raise MCPToolError("get_screenshot", res, f"returned an invalid result: {exc}") from exc


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


def _build_wait_open_js(anchor_id: str, expected_path: str) -> str:
    anchor_json = json.dumps(anchor_id)
    path_json = json.dumps(expected_path)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const anchorId = {anchor_json}",
            f"const expectedPath = {path_json}",
            "const docs = sketch.getDocuments()",
            "const candidates = docs.filter(d => String(d.id) !== anchorId && Boolean(d.path) && decodeURIComponent(String(d.path)) === expectedPath)",
            "const doc = candidates.length === 1 ? candidates[0] : null",
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
            "  if (edit.focusBorderColor || edit.focusBorderThickness !== undefined || edit.borderThickness !== undefined) {",
            "    const bThickness = edit.focusBorderThickness !== undefined ? edit.focusBorderThickness : (edit.borderThickness !== undefined ? edit.borderThickness : 2)",
            "    const existingColor = (layer.style && layer.style.borders && layer.style.borders.length > 0 && layer.style.borders[0].color) ? layer.style.borders[0].color : '#1F6BF5ff'",
            "    const bColor = edit.focusBorderColor || existingColor",
            "    layer.style.borders = [{ color: bColor, thickness: bThickness, position: sketch.Style.BorderPosition.Outside, enabled: true }]",
            "  }",
            "  applied.push({ layerID: String(layer.id), name: String(layer.name) })",
            "}",
            "if (typeof doc.processPendingChanges === 'function') {",
            "  doc.processPendingChanges()",
            "}",
            "console.log(JSON.stringify({ ok: true, topCounts, applied }))",
        ]
    )


def _build_save_js(doc_id: str, expected_path: str, operation_id: str) -> str:
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const targetDocId = {json.dumps(doc_id)}",
            f"const expectedPath = {json.dumps(expected_path)}",
            f"const operationID = {json.dumps(operation_id)}",
            "const matches = sketch.getDocuments().filter(d => String(d.id) === targetDocId && Boolean(d.path) && decodeURIComponent(String(d.path)) === expectedPath)",
            "if (matches.length !== 1) { throw new Error('Working document identity changed before save') }",
            "const doc = matches[0]",
            "let completed = false",
            "doc.save(expectedPath, { saveMode: sketch.Document.SaveMode.Save }, function(error) {",
            "  if (completed) return",
            "  completed = true",
            "  console.log(JSON.stringify({ operationID, stage: 'save-completed', ok: !error, error: error ? String(error) : null, path: doc.path ? decodeURIComponent(String(doc.path)) : null, docId: String(doc.id) }))",
            "})",
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
            "  const firstBorder = (layer.style && layer.style.borders && layer.style.borders.length > 0) ? layer.style.borders[0] : null",
            "  const borderThickness = firstBorder ? firstBorder.thickness : null",
            "  const borderColor = (firstBorder && firstBorder.color !== undefined && firstBorder.color !== null) ? String(firstBorder.color) : null",
            "  const layerText = typeof layer.text === 'string' ? layer.text : null",
            "  readbacks.push({ editIndex, layerID: String(layer.id), overrideID: edit.overrideID || null, text: layerText, overrideValue: ovVal, borderThickness, borderColor, focusBorderThickness: borderThickness, focusBorderColor: borderColor })",
            "}",
            "console.log(JSON.stringify({ ok: true, docId: String(doc.id), readbacks }))",
        ]
    )


def _build_close_doc_js(doc_id: str, anchor_id: str, expected_path: str) -> str:
    doc_id_json = json.dumps(doc_id)
    anchor_json = json.dumps(anchor_id)
    return "\n".join(
        [
            "const sketch = require('sketch')",
            f"const targetDocId = {doc_id_json}",
            f"const anchorId = {anchor_json}",
            f"const expectedPath = {json.dumps(expected_path)}",
            "if (targetDocId === anchorId) { throw new Error('Refusing to close anchor document') }",
            "const docs = sketch.getDocuments()",
            "const matches = docs.filter(d => String(d.id) === targetDocId && Boolean(d.path) && decodeURIComponent(String(d.path)) === expectedPath)",
            "if (matches.length !== 1) { throw new Error('Working document identity changed before close') }",
            "matches[0].close()",
            "const after = sketch.getDocuments()",
            "const anchorPresent = after.some(d => String(d.id) === anchorId)",
            "const remainingDocs = after.filter(d => String(d.id) !== anchorId)",
            "const remaining = remainingDocs.map(d => String(d.id))",
            "const closed = !remainingDocs.some(d => String(d.id) === targetDocId || (d.path && decodeURIComponent(String(d.path)) === expectedPath))",
            "console.log(JSON.stringify({ closed, anchorPresent, remainingNonAnchor: remaining }))",
        ]
    )


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
    seen_names: Set[str] = set()
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


def _normalize_json_value(val: Any) -> Any:
    if isinstance(val, float):
        return round(val, 4)
    if isinstance(val, dict):
        return {str(k): _normalize_json_value(v) for k, v in sorted(val.items())}
    if isinstance(val, list):
        return [_normalize_json_value(item) for item in val]
    return val


def _extract_archive_snapshot(sketch_path: Path) -> Dict[str, Dict[str, Any]]:
    """Extract per-object structural snapshot from a .sketch ZIP archive offline."""
    snapshot: Dict[str, Dict[str, Any]] = {}
    with zipfile.ZipFile(sketch_path, "r") as zf:
        infolist = _validate_zip_archive_budget(zf)
        info_by_name = {info.filename: info for info in infolist}
        dom_budget = _new_dom_budget()
        for member in sorted(info_by_name.keys()):
            info = info_by_name[member]
            if member.startswith("images/"):
                raw_img = _read_zip_member_bounded(
                    zf, info, max_bytes=MAX_ZIP_SINGLE_MEMBER_BYTES
                )
                snapshot[f"archiveMember:{member}"] = {
                    "_class": "archiveMember",
                    "name": member,
                    "sha256": hashlib.sha256(raw_img).hexdigest(),
                    "size": len(raw_img),
                }
                continue
            if not (
                member == "document.json"
                or (member.startswith("pages/") and member.endswith(".json"))
            ):
                continue
            if member.startswith("pages/"):
                dom_budget["pages"] += 1
                if dom_budget["pages"] > MAX_ARCHIVE_PAGES:
                    raise RuntimeError(
                        f"Archive page count ({dom_budget['pages']}) exceeds limit ({MAX_ARCHIVE_PAGES})"
                    )
            data = _loads_json_bounded(
                _read_zip_member_bounded(zf, info),
                member,
                dom_budget=dom_budget,
            )

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
                        "rawObject": _normalize_json_value(st),
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
                        "rawObject": _normalize_json_value(fst),
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
                            "rawObject": _normalize_json_value(lst),
                        }
                for flst in data.get("foreignLayerStyles") or []:
                    if not isinstance(flst, dict):
                        continue
                    local_lst = flst.get("localSharedStyle") or {}
                    sid = str(local_lst.get("do_objectID", ""))
                    if sid:
                        snapshot[f"foreignLayerStyle:{sid}"] = {
                            "_class": local_lst.get("_class", "sharedStyle"),
                            "name": local_lst.get("name"),
                            "borders": ((local_lst.get("value") or {}).get("borders")),
                            "fills": ((local_lst.get("value") or {}).get("fills")),
                            "rawObject": _normalize_json_value(flst),
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
                            "rawObject": _normalize_json_value(sw),
                        }
                for fsw in data.get("foreignSwatches") or []:
                    if not isinstance(fsw, dict):
                        continue
                    local_sw = fsw.get("localSwatch") or {}
                    sw_id = str(local_sw.get("do_objectID", ""))
                    if sw_id:
                        snapshot[f"foreignSwatch:{sw_id}"] = {
                            "_class": local_sw.get("_class", "swatch"),
                            "name": local_sw.get("name"),
                            "value": local_sw.get("value"),
                            "rawObject": _normalize_json_value(fsw),
                        }

            def walk(node: Dict[str, Any], parent_id: Optional[str] = None) -> None:
                oid = str(node.get("do_objectID", ""))
                children = [
                    child
                    for child in (node.get("layers") or [])
                    if isinstance(child, dict)
                ]
                if oid:
                    frame = node.get("frame") or {}
                    style = node.get("style") or {}
                    attr_str = node.get("attributedString") or {}
                    attrs = attr_str.get("attributes") or []
                    first_font = (
                        ((attrs[0].get("attributes") or {}).get("MSAttributedStringFontAttribute") or {}).get("attributes")
                        if attrs and isinstance(attrs[0], dict)
                        else None
                    )
                    text_runs = (
                        [
                            {
                                "location": seg.get("location"),
                                "length": seg.get("length"),
                                "fontDescriptor": (
                                    (
                                        (seg.get("attributes") or {}).get(
                                            "MSAttributedStringFontAttribute"
                                        )
                                        or {}
                                    ).get("attributes")
                                    if isinstance(
                                        (seg.get("attributes") or {}).get(
                                            "MSAttributedStringFontAttribute"
                                        ),
                                        dict,
                                    )
                                    else None
                                ),
                                "paragraphStyle": (seg.get("attributes") or {}).get(
                                    "paragraphStyle"
                                ),
                            }
                            for seg in attrs
                            if isinstance(seg, dict)
                        ]
                        if attr_str
                        else None
                    )
                    raw_attrs = _normalize_json_value(
                        {
                            k: v
                            for k, v in node.items()
                            if k not in ("layers", "frame")
                        }
                    )
                    snapshot[oid] = {
                        "_class": node.get("_class"),
                        "name": node.get("name"),
                        "isVisible": bool(node.get("isVisible", True)),
                        "isLocked": bool(node.get("isLocked", False)),
                        "parentID": parent_id,
                        "childIDs": [
                            str(c.get("do_objectID", "")) for c in children
                        ],
                        "frame": {
                            "x": round(float(frame.get("x", 0.0)), 2),
                            "y": round(float(frame.get("y", 0.0)), 2),
                            "width": round(float(frame.get("width", 0.0)), 2),
                            "height": round(float(frame.get("height", 0.0)), 2),
                        }
                        if frame
                        else None,
                        "groupLayout": node.get("groupLayout"),
                        "flexItem": node.get("flexItem"),
                        "clippingBehavior": node.get("clippingBehavior"),
                        "shouldBreakMaskChain": bool(
                            node.get("shouldBreakMaskChain", False)
                        ),
                        "hasClippingMask": bool(node.get("hasClippingMask", False)),
                        "textBehaviour": node.get("textBehaviour"),
                        "resizingConstraint": node.get("resizingConstraint"),
                        "rotation": round(float(node.get("rotation", 0.0) or 0.0), 4),
                        "isFlippedHorizontal": bool(
                            node.get("isFlippedHorizontal", False)
                        ),
                        "isFlippedVertical": bool(node.get("isFlippedVertical", False)),
                        "booleanOperation": node.get("booleanOperation"),
                        "flow": node.get("flow"),
                        "text": attr_str.get("string") if attr_str else None,
                        "fontDescriptor": first_font,
                        "textRuns": text_runs,
                        "symbolID": node.get("symbolID"),
                        "sharedStyleID": node.get("sharedStyleID"),
                        "overrideValues": node.get("overrideValues"),
                        "image": node.get("image"),
                        "borders": style.get("borders"),
                        "fills": style.get("fills"),
                        "shadows": style.get("shadows"),
                        "innerShadows": style.get("innerShadows"),
                        "blur": style.get("blur"),
                        "contextSettings": style.get("contextSettings"),
                        "rawAttributes": raw_attrs,
                    }
                for child in children:
                    walk(child, oid or parent_id)

            walk(data)
            if member == "document.json" and isinstance(data, dict):
                doc_oid = str(data.get("do_objectID", "") or "document.json")
                for fs in data.get("foreignSymbols") or []:
                    if not isinstance(fs, dict):
                        continue
                    fs_oid = str(fs.get("do_objectID", "") or doc_oid)
                    sm = fs.get("symbolMaster") or fs.get("originalMaster")
                    if isinstance(sm, dict):
                        walk(sm, fs_oid)
    return snapshot


def diff_sketch_archives_offline(
    before_sketch: Path,
    after_sketch: Path,
    allowed_layer_ids: Set[str],
    saved_document_ids: Optional[Tuple[str, str]] = None,
) -> Dict[str, Any]:
    before_snap = _extract_archive_snapshot(before_sketch)
    after_snap = _extract_archive_snapshot(after_sketch)
    document_identity = None
    if saved_document_ids is not None:
        before_id, after_id = saved_document_ids
        if (not before_id or not after_id
                or before_snap.get(before_id, {}).get("_class") != "document"
                or after_snap.get(after_id, {}).get("_class") != "document"
                or (before_id != after_id and before_id in after_snap)):
            raise RuntimeError("Saved archive document IDs do not match the bound operation")
        # Align only the root identity verified by the save receipt and exact-path probe.
        # Keep the original attributes in reports and compare every other document fact.
        after_snap[before_id] = after_snap.pop(after_id)
        document_identity = {"before": before_id, "after": after_id}

    expected_changes: List[Dict[str, Any]] = []
    unexpected_drifts: List[Dict[str, Any]] = []

    all_ids = sorted(set(before_snap.keys()) | set(after_snap.keys()))
    for oid in all_ids:
        b_item = before_snap.get(oid)
        a_item = after_snap.get(oid)
        compared_after = a_item
        if document_identity and oid == document_identity["before"]:
            compared_after = {
                **a_item,
                "rawAttributes": {**a_item["rawAttributes"], "do_objectID": oid},
            }
        if b_item == compared_after:
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
        "documentIdentity": document_identity,
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

    tmpdir = str(Path(tempfile.mkdtemp(prefix="sketch-roundtrip-")).resolve())
    operation_path = Path(tmpdir) / "operation.json"
    operation: Dict[str, Any] = {
        "operationID": str(uuid.uuid4()),
        "source": str(sketch_path),
        "anchorID": anchor_id,
        "stage": "preparing",
    }
    open_attempted = False
    mutation_requested = False
    close_requested = False
    doc_id: Optional[str] = None
    slot_released = False

    def checkpoint(stage: str, **facts: Any) -> None:
        operation.update(facts)
        operation["stage"] = stage
        _write_bytes_nofollow(
            operation_path, json.dumps(operation, ensure_ascii=False, indent=2).encode("utf-8")
        )

    try:
        os.chmod(tmpdir, 0o700)
        baseline_copy = Path(tmpdir) / "baseline-before-save.sketch"
        working_copy = Path(tmpdir) / "working-disposable-copy.sketch"
        checkpoint("preparing", workingCopy=str(working_copy), baselineCopy=str(baseline_copy))
        expected_archive_doc_id = ""
        src_fd = _open_regular_owned_fd_nofollow(
            sketch_path, max_bytes=MAX_SKETCH_ARCHIVE_BYTES
        )
        try:
            meta_dup_fd = os.dup(src_fd)
            with os.fdopen(meta_dup_fd, "rb") as meta_fh:
                with zipfile.ZipFile(meta_fh, "r") as zf_meta:
                    meta_infolist = _validate_zip_archive_budget(zf_meta)
                    meta_info_by_name = {i.filename: i for i in meta_infolist}
                    if "document.json" in meta_info_by_name:
                        doc_meta = _loads_json_bounded(
                            _read_zip_member_bounded(
                                zf_meta, meta_info_by_name["document.json"]
                            ),
                            "document.json",
                        )
                        expected_archive_doc_id = str(
                            doc_meta.get("do_objectID", "") or ""
                        )
            _stream_fd_to_file_nofollow(
                src_fd, baseline_copy, max_bytes=MAX_SKETCH_ARCHIVE_BYTES
            )
            _stream_fd_to_file_nofollow(
                src_fd, working_copy, max_bytes=MAX_SKETCH_ARCHIVE_BYTES
            )
        finally:
            os.close(src_fd)
        expected_sketch_path = str(working_copy.resolve())
        checkpoint("prepared", workingCopy=expected_sketch_path,
                   baselineCopy=str(baseline_copy), archiveDocID=expected_archive_doc_id)

        client = SketchMCPClient(
            endpoint=mcp_url,
            sketch_app=sketch_app,
            require_signed_sketch=(
                open_bin == "open" and sketch_app == DEFAULT_SKETCH_APP
            ),
        )

        # Step 1: Pre-check :31126/mcp open documents
        precheck = client.run_code(
            "roundtrip-step1-precheck", _build_slot_check_js(anchor_id)
        )
        if precheck.get("anchorPresent") is not True:
            raise RuntimeError(f"Anchor document {anchor_id} is not open in Sketch")
        if precheck.get("matching") != []:
            raise RuntimeError("Stray non-anchor document(s) open before acquiring slot (matching != [])")

        # Step 2: Open disposable copy with `open -g -a /Applications/Sketch.app`
        checkpoint("open-requested")
        open_attempted = True
        open_cmd_1 = _launch_sketch_background(working_copy, sketch_app, open_bin)
        deadline = time.perf_counter() + poll_timeout
        while time.perf_counter() < deadline:
            probe = client.run_code(
                "roundtrip-step2-wait-open",
                _build_wait_open_js(anchor_id, expected_sketch_path),
            )
            if probe.get("ready") is True and probe.get("docId"):
                doc_id = str(probe["docId"])
                break
            time.sleep(0.15)
        if not doc_id:
            raise RuntimeError(f"Timed out waiting for {working_copy.name} to open in background")
        opened_doc_id = doc_id
        checkpoint("opened", docID=doc_id)

        before_png_bytes = client.get_screenshot(document_id=doc_id, layer_id=target_artboard_id)
        before_png_path = screenshots_dir / "before.png"
        _write_bytes_nofollow(before_png_path, before_png_bytes)
        before_sha256 = hashlib.sha256(before_png_bytes).hexdigest()

        checkpoint("mutation-requested")
        mutation_requested = True
        mutate_res = client.run_code(
            "roundtrip-step3-mutate",
            _build_lightweight_mutate_js(doc_id, edits, target_page_id),
        )
        if mutate_res.get("ok") is not True:
            raise RuntimeError("Mutation completion was not confirmed; do not repeat the edit")
        checkpoint("save-requested", mutation=mutate_res)
        save_res = client.run_code(
            "roundtrip-step3-save",
            _build_save_js(doc_id, expected_sketch_path, operation["operationID"]),
        )
        if (
            save_res.get("operationID") != operation["operationID"]
            or save_res.get("stage") != "save-completed"
            or save_res.get("path") != expected_sketch_path
            or not isinstance(save_res.get("ok"), bool)
            or not isinstance(save_res.get("docId"), str)
            or not save_res["docId"]
            or (save_res.get("ok") is True and save_res.get("error") is not None)
        ):
            raise RuntimeError("Save completion receipt is missing or mismatched; do not repeat the save")
        checkpoint("save-completed", saveReceipt=save_res)
        if save_res["ok"] is not True:
            raise RuntimeError(f"Sketch reported a save failure: {save_res.get('error')}")

        # Saving can change the live document ID. Rebind through the exact copy path.
        saved_doc = client.run_code(
            "roundtrip-step3-wait-open-saved",
            _build_wait_open_js(anchor_id, expected_sketch_path),
        )
        if (saved_doc.get("ready") is not True
                or saved_doc.get("docId") != save_res["docId"]):
            raise RuntimeError("Saved document could not be rebound to the working copy")
        doc_id = str(saved_doc["docId"])
        checkpoint("saved", docID=doc_id)

        after_png_bytes = client.get_screenshot(document_id=doc_id, layer_id=target_artboard_id)
        after_png_path = screenshots_dir / "after.png"
        _write_bytes_nofollow(after_png_path, after_png_bytes)
        after_sha256 = hashlib.sha256(after_png_bytes).hexdigest()

        checkpoint("close-requested")
        close_requested = True
        close_res_1 = client.run_code(
            "roundtrip-step4-close-copy",
            _build_close_doc_js(doc_id, anchor_id, expected_sketch_path),
        )
        if (close_res_1.get("closed") is not True
                or close_res_1.get("anchorPresent") is not True
                or close_res_1.get("remainingNonAnchor") != []):
            raise RuntimeError("Working copy closure was not confirmed; do not repeat the close")
        checkpoint("closed")
        slot_released = True

        # Step 5: Offline Python zipfile diff between pre-save and post-save .sketch
        offline_diff = diff_sketch_archives_offline(
            baseline_copy, working_copy, allowed_ids,
            saved_document_ids=(expected_archive_doc_id, doc_id),
        )

        # Step 6: Reopen copy via `open -g -a /Applications/Sketch.app`, readback, screenshot SHA-256, close, assert matching: []
        checkpoint("reopen-requested")
        slot_released = False
        open_cmd_2 = _launch_sketch_background(working_copy, sketch_app, open_bin)
        reopen_doc_id: Optional[str] = None
        deadline2 = time.perf_counter() + poll_timeout
        while time.perf_counter() < deadline2:
            probe2 = client.run_code(
                "roundtrip-step6-wait-reopen",
                _build_wait_open_js(anchor_id, expected_sketch_path),
            )
            if probe2.get("ready") is True and probe2.get("docId"):
                reopen_doc_id = str(probe2["docId"])
                break
            time.sleep(0.15)
        if not reopen_doc_id:
            raise RuntimeError(f"Timed out waiting for {working_copy.name} to reopen")
        checkpoint("reopened", docID=reopen_doc_id)

        readback_res = client.run_code(
            "roundtrip-step6-readback",
            _build_lightweight_readback_js(reopen_doc_id, edits, target_page_id),
        )
        if readback_res.get("ok") is not True:
            raise RuntimeError("Reopened document readback was not confirmed")
        reopen_png_bytes = client.get_screenshot(document_id=reopen_doc_id, layer_id=target_artboard_id)
        reopen_png_path = screenshots_dir / "reopen.png"
        _write_bytes_nofollow(reopen_png_path, reopen_png_bytes)
        reopen_sha256 = hashlib.sha256(reopen_png_bytes).hexdigest()

        checkpoint("reopen-close-requested")
        close_res_2 = client.run_code(
            "roundtrip-step6-close-reopen",
            _build_close_doc_js(reopen_doc_id, anchor_id, expected_sketch_path),
        )
        if (close_res_2.get("closed") is not True
                or close_res_2.get("anchorPresent") is not True
                or close_res_2.get("remainingNonAnchor") != []):
            raise RuntimeError("Reopened copy closure was not confirmed; do not repeat the close")
        slot_released = True
        checkpoint("reopen-closed")

        final_slot_check = client.run_code(
            "roundtrip-step6-final-slot-check",
            _build_slot_check_js(anchor_id),
        )

    except Exception as exc:
        if isinstance(exc, MCPToolError):
            operation["failureResponse"] = {"tool": exc.tool, "payload": exc.payload}
        # A pre-edit failure can close its known copy once. After dispatching an
        # edit/save or close, an error is not permission to repeat or discard it.
        if open_attempted and not mutation_requested and not close_requested and doc_id:
            close_requested = True
            try:
                checkpoint("failure-close-requested")
                close_result = client.run_code(
                    "roundtrip-failure-close-unmodified-copy",
                    _build_close_doc_js(doc_id, anchor_id, expected_sketch_path),
                )
                slot_released = (
                    close_result.get("closed") is True
                    and close_result.get("anchorPresent") is True
                    and close_result.get("remainingNonAnchor") == []
                )
            except Exception as close_error:
                operation["closeError"] = str(close_error)
        operation["error"] = str(exc)
        operation["slotReleased"] = slot_released
        recovery = {"directory": tmpdir, "operationFile": str(operation_path), **operation}
        if not open_attempted or (slot_released and not mutation_requested):
            try:
                shutil.rmtree(tmpdir)
                recovery = None
            except OSError as cleanup_error:
                recovery["cleanupError"] = str(cleanup_error)
        else:
            try:
                checkpoint(operation["stage"])
            except OSError as journal_error:
                operation["journalError"] = str(journal_error)
            recovery = {"directory": tmpdir, "operationFile": str(operation_path), **operation}
        return {
            "tool": "sketch_mcp_roundtrip.py",
            "sketch": str(sketch_path),
            "anchorID": anchor_id,
            "passed": False,
            "failedStep": operation["stage"],
            "error": str(exc),
            "recovery": recovery,
        }

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
        expected_thickness = (
            edit["focusBorderThickness"]
            if "focusBorderThickness" in edit
            else (
                edit["borderThickness"]
                if "borderThickness" in edit
                else (2 if "focusBorderColor" in edit else None)
            )
        )
        if expected_thickness is not None:
            actual_thickness = rb.get(
                "focusBorderThickness", rb.get("borderThickness")
            )
            if actual_thickness != expected_thickness:
                persistence_verified = False
        if "focusBorderColor" in edit:
            expected_color = str(edit["focusBorderColor"]).strip().lower()
            actual_color = str(
                rb.get("focusBorderColor") or rb.get("borderColor") or ""
            ).strip().lower()
            expected_norm = (
                expected_color + "ff"
                if len(expected_color) == 7 and expected_color.startswith("#")
                else expected_color
            )
            actual_norm = (
                actual_color + "ff"
                if len(actual_color) == 7 and actual_color.startswith("#")
                else actual_color
            )
            if not actual_color or (
                actual_norm != expected_norm and actual_color != expected_color
            ):
                persistence_verified = False

    expected_changes_by_id: Dict[str, Dict[str, Any]] = {
        str(c.get("layerID", "")): c
        for c in (offline_diff.get("expectedChanges") or [])
        if isinstance(c, dict)
    }
    archive_mutations_verified = True
    for edit in edits:
        if not isinstance(edit, dict):
            continue
        lid = str(edit.get("layerID", ""))
        if not lid:
            continue
        change_entry = expected_changes_by_id.get(lid)
        if not change_entry:
            archive_mutations_verified = False
            break
        after_snap = change_entry.get("after") or {}
        if "text" in edit and after_snap.get("text") != edit["text"]:
            archive_mutations_verified = False
            break
        if "overrideID" in edit and "overrideValue" in edit:
            ov_id = str(edit["overrideID"])
            ov_list = after_snap.get("overrideValues") or []
            matched_ov = any(
                isinstance(ov, dict)
                and str(ov.get("overrideName", "")) == ov_id
                and ov.get("value") == edit["overrideValue"]
                for ov in ov_list
            )
            if not matched_ov:
                archive_mutations_verified = False
                break
    offline_diff["archiveMutationsVerified"] = archive_mutations_verified

    screenshot_sha_match = after_sha256 == reopen_sha256
    zero_unexpected_drift = offline_diff["unexpectedDriftCount"] == 0
    final_slot_clean = (
        final_slot_check.get("anchorPresent") is True
        and final_slot_check.get("matching") == []
    )
    passed = (
        persistence_verified
        and archive_mutations_verified
        and screenshot_sha_match
        and zero_unexpected_drift
        and final_slot_clean
    )

    try:
        checkpoint("verified", verificationPassed=passed, slotReleased=final_slot_clean)
    except OSError as journal_error:
        operation["journalError"] = str(journal_error)
        passed = False
    recovery = None
    if passed:
        try:
            shutil.rmtree(tmpdir)
        except OSError as cleanup_error:
            operation["cleanupError"] = str(cleanup_error)
            passed = False
    if not passed:
        recovery = {"directory": tmpdir, "operationFile": str(operation_path), **operation}
    return {
        "tool": "sketch_mcp_roundtrip.py",
        "sketch": str(sketch_path),
        "anchorID": anchor_id,
        "passed": passed,
        "operationID": operation["operationID"],
        "saveReceipt": save_res,
        "recovery": recovery,
        "elapsedMs": round((time.perf_counter() - start_ts) * 1000.0, 2),
        "launchCommands": [open_cmd_1, open_cmd_2],
        "steps": {
            "step1Precheck": precheck,
            "step2OpenDocID": opened_doc_id,
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
            "Non-activating native Sketch MCP roundtrip verifier with save receipts. "
            "Opens a disposable .sketch copy via `open -g -a /Applications/Sketch.app`, "
            "executes lightweight ID-targeted JS edits + `doc.processPendingChanges()` + "
            "an asynchronous save receipt, diffs archives offline via Python zipfile, and "
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
            edit_spec = json.loads(
                _read_regular_owned_bytes_nofollow(
                    Path(spec_arg), max_bytes=MAX_EDIT_SPEC_BYTES
                ).decode("utf-8")
            )

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
