#!/usr/bin/env python3
# Contract subject: `python`.
# - Read [contract](../delivery/policy/tool-contracts.md). Use tool `curl`.
"""Install pinned upstream validation inputs or validate repository skills offline."""

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import runpy
import stat
import subprocess
import sys
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "agents-tools"


def check_path(target, writable=False):
    uid = os.getuid()
    # The hosted supervisor owns immutable inputs; the isolated reader must not own them.
    protected = not writable and uid != 0 and target.exists() and target.stat().st_uid == 0
    for current in (target, *target.parents):
        if current.is_symlink():
            raise ValueError(f"Symlink in validator input: {target}")
        if not current.exists():
            continue
        metadata = current.stat()
        if protected:
            if metadata.st_uid != 0:
                raise ValueError(f"Unowned validator input: {target}")
            # A root-owned sticky temporary ancestor cannot be renamed by the reader.
            sticky_parent = current != target and stat.S_ISDIR(metadata.st_mode) and metadata.st_mode & stat.S_ISVTX
            if metadata.st_mode & 0o022 and not sticky_parent:
                raise ValueError(f"Writable protected validator input: {target}")
        elif metadata.st_uid != uid and current != Path("/"):
            if current == target or current.is_file():
                raise ValueError(f"Unowned validator input: {target}")


def verified_download(artifact, download):
    archive = CACHE / "archives" / artifact["sha256"]
    check_path(archive, writable=download)
    if archive.exists() or archive.is_symlink():
        if not archive.is_file() or archive.is_symlink():
            raise ValueError(f"Invalid cached archive: {archive}")
        content = archive.read_bytes()
    else:
        if not download:
            raise ValueError("Missing pinned validator archive; run bash scripts/install-tools.sh")
        archive.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="agents-validator-download-") as temporary:
            candidate = Path(temporary) / "download"
            subprocess.run([
                "curl", "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2",
                "-fsSL", "--retry", "3", "--connect-timeout", "15", "--max-time", "180",
                "-o", str(candidate), artifact["url"],
            ], check=True)
            content = candidate.read_bytes()
    if hashlib.sha256(content).hexdigest() != artifact["sha256"]:
        raise ValueError(f"Checksum mismatch: {artifact['url']}")
    if not archive.exists():
        with tempfile.NamedTemporaryFile(dir=archive.parent, delete=False) as candidate:
            candidate.write(content)
        try:
            os.replace(candidate.name, archive)
        finally:
            Path(candidate.name).unlink(missing_ok=True)
    return content


def pinned_files(manifest, download):
    # Use upstream's pure Python package; its optional C extension is unnecessary.
    files = {}
    for product in ("codex", "claude"):
        files[f"{product}/quick_validate.py"] = verified_download(manifest[product], download)
        files[f"{product}/LICENSE"] = verified_download(manifest[f"{product}License"], download)
    prefix = f"PyYAML-{manifest['pyyaml']['version']}/"
    with tarfile.open(fileobj=io.BytesIO(verified_download(manifest["pyyaml"], download)), mode="r:gz") as archive:
        for member in archive.getmembers():
            if not member.name.startswith(prefix):
                continue
            relative = PurePosixPath(member.name.removeprefix(prefix))
            if relative.parts[:2] != ("lib", "yaml") and str(relative) != "LICENSE":
                continue
            if member.isdir():
                continue
            if not member.isfile() or ".." in relative.parts or relative.is_absolute():
                raise ValueError(f"Invalid PyYAML archive member: {member.name}")
            if str(relative) in files:
                raise ValueError("Duplicate PyYAML archive member")
            files[str(relative)] = archive.extractfile(member).read()
    if "lib/yaml/__init__.py" not in files or "LICENSE" not in files:
        raise ValueError("PyYAML source archive is incomplete")
    hashes = {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}
    files["files.json"] = (json.dumps(hashes, sort_keys=True) + "\n").encode()
    return files


def verify_files(destination, files):
    check_path(destination)
    if not destination.is_dir():
        raise ValueError("Missing pinned skill validators; run bash scripts/install-tools.sh")
    actual = set()
    for target in destination.rglob("*"):
        check_path(target)
        if target.is_dir():
            continue
        if not target.is_file():
            raise ValueError("Special validator input rejected")
        actual.add(str(target.relative_to(destination)))
    if actual != set(files):
        raise ValueError("Validator installation has missing or extra files")
    for name, content in files.items():
        if (destination / name).read_bytes() != content:
            raise ValueError(f"Validator installation differs from pinned archives: {name}")


def install(manifest, destination):
    files = pinned_files(manifest, True)
    check_path(destination, writable=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent, prefix=".candidate-") as temporary:
        candidate = Path(temporary) / "bundle"
        for name, content in files.items():
            target = candidate / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        subprocess.run([
            sys.executable, "-I", "-B", "-c",
            "import sys; sys.path.insert(0, sys.argv[1]); import yaml; "
            "assert yaml.__version__ == sys.argv[2]; "
            "assert yaml.safe_load('name: probe')['name'] == 'probe'",
            str(candidate / "lib"), manifest["pyyaml"]["version"],
        ], check=True)
        if destination.exists() or destination.is_symlink():
            if destination.is_symlink() or not destination.is_dir():
                raise ValueError(f"Invalid validator installation: {destination}")
            # A matching content-addressed installation needs no replacement.
            verify_files(destination, files)
        else:
            os.replace(candidate, destination)
    print("Pinned Codex and Anthropic skill validators and PyYAML installed in the repository cache")


def check(manifest, destination, product, entries):
    files = pinned_files(manifest, False)
    verify_files(destination, files)
    if entries is None:
        inputs = [str((destination / name).relative_to(ROOT)) for name in files]
        inputs += [str((CACHE / "archives" / manifest[name]["sha256"]).relative_to(ROOT))
                   for name in ("codex", "codexLicense", "claude", "claudeLicense", "pyyaml")]
        print(json.dumps(sorted(inputs)))
        return
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(destination / "lib"))
    import yaml
    if yaml.__version__ != manifest["pyyaml"]["version"]:
        raise ValueError("PyYAML version differs from the pinned dependency")
    validate = runpy.run_path(str(destination / product / "quick_validate.py"))["validate_skill"]
    if not entries:
        raise ValueError(f"No skill entrypoints found for {product} validation")
    for entry in entries:
        skill = Path(entry)
        check_path(skill / "SKILL.md")
        valid, message = validate(skill)
        if not valid:
            raise ValueError(f"{skill.name}: {message}")
    print(json.dumps({"product": product, "validated": len(entries)}))


def main():
    if (len(sys.argv) < 2 or sys.argv[1] not in ("install", "verify", "validate")
            or (sys.argv[1] != "validate" and len(sys.argv) != 2)
            or (sys.argv[1] == "validate" and (len(sys.argv) < 4 or sys.argv[2] not in ("codex", "claude")))):
        print("usage: python3 scripts/skill-validator.py install|verify|validate codex|claude DIRECTORY...", file=sys.stderr)
        return 2
    if sys.version_info < (3, 9):
        print("Python 3.9 or later is required for skill validation", file=sys.stderr)
        return 1
    try:
        manifest_bytes = (ROOT / "scripts" / "skill-validator-versions.json").read_bytes()
        manifest = json.loads(manifest_bytes)
        for name in ("codex", "codexLicense", "claude", "claudeLicense", "pyyaml"):
            artifact = manifest[name]
            if not re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]) or not artifact["url"].startswith("https://"):
                raise ValueError(f"Invalid pinned artifact: {name}")
        destination = CACHE / "skill-validators" / hashlib.sha256(manifest_bytes).hexdigest()
        if sys.argv[1] == "install":
            install(manifest, destination)
        else:
            check(manifest, destination, sys.argv[2] if sys.argv[1] == "validate" else None,
                  sys.argv[3:] if sys.argv[1] == "validate" else None)
    except (OSError, ValueError, ImportError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"Skill validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
