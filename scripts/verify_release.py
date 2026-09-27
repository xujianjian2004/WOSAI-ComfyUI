"""Validate a WOSAI release ZIP as an isolated ComfyUI custom-node install."""

from __future__ import annotations

import compileall
import hashlib
import importlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_ROOT = "WOSAI-ComfyUI"
FORBIDDEN_PARTS = {
    ".git",
    ".github",
    "_ref",
    "__pycache__",
    "node_modules",
    "scripts",
    "tests",
}
FORBIDDEN_PATHS = {
    "presets/preset_library.json",
    "presets/preset_library.backup.json",
}
REQUIRED_PATHS = {
    "__init__.py",
    "VERSION",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "extension.json",
    "requirements.txt",
    "nodes/common_color.py",
    "wosai_core/registry.py",
    "web/common-color.js",
    "web/styles/wosai-variables.css",
    "presets/color_presets.json",
    "presets/preset_prompt_catalog.json",
    "workflows/WOSAI_frontend_compat_test.json",
    "docs/RELEASE_CHECKLIST.md",
}
IMPORT_SPECIFIER = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']"""
)
JS_COMMENTS = re.compile(r"/\*.*?\*/|^[ \t]*//[^\r\n]*$", re.DOTALL | re.MULTILINE)


def version() -> str:
    return str(json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"])


def validate_members(archive: zipfile.ZipFile) -> list[str]:
    members = archive.namelist()
    if len(members) != len(set(members)):
        raise AssertionError("archive contains duplicate entries")
    if members != sorted(members):
        raise AssertionError("archive entries are not deterministically sorted")
    relative_paths = []
    for name in members:
        pure = PurePosixPath(name)
        if pure.is_absolute() or ".." in pure.parts:
            raise AssertionError(f"unsafe archive member: {name}")
        if not pure.parts or pure.parts[0] != ARCHIVE_ROOT:
            raise AssertionError(f"archive member is outside {ARCHIVE_ROOT}: {name}")
        relative = PurePosixPath(*pure.parts[1:])
        if relative.as_posix() in FORBIDDEN_PATHS:
            raise AssertionError(f"runtime user state included: {relative}")
        if any(part in FORBIDDEN_PARTS for part in relative.parts):
            raise AssertionError(f"development-only path included: {relative}")
        if relative.name.endswith((".pyc", ".pyo", ".test.mjs", "._chk.mjs", ".zip")):
            raise AssertionError(f"generated/test file included: {relative}")
        relative_paths.append(relative.as_posix())
    missing = sorted(REQUIRED_PATHS.difference(relative_paths))
    if missing:
        raise AssertionError(f"release archive is missing: {', '.join(missing)}")
    return relative_paths


def validate_json(plugin_root: Path) -> int:
    count = 0
    for path in plugin_root.rglob("*.json"):
        json.loads(path.read_text(encoding="utf-8"))
        count += 1
    return count


def validate_frontend_entries(plugin_root: Path) -> int:
    extension = json.loads((plugin_root / "extension.json").read_text(encoding="utf-8"))
    resources = [*(extension.get("js") or []), *(extension.get("css") or [])]
    for resource in resources:
        local = resource.split("?", 1)[0]
        if not (plugin_root / local).is_file():
            raise AssertionError(f"extension resource is missing after install: {local}")
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required to syntax-check release frontend modules")
    root = plugin_root.resolve()
    for script in plugin_root.joinpath("web").rglob("*.js"):
        source = JS_COMMENTS.sub("", script.read_text(encoding="utf-8"))
        for specifier in IMPORT_SPECIFIER.findall(source):
            if not specifier.startswith("."):
                continue
            clean_specifier = specifier.split("?", 1)[0].split("#", 1)[0]
            imported = (script.parent / clean_specifier).resolve()
            try:
                imported.relative_to(root)
            except ValueError:
                continue
            if not imported.is_file():
                relative = script.relative_to(plugin_root).as_posix()
                raise AssertionError(
                    f"release frontend import is missing: {relative} -> {specifier}"
                )
        subprocess.run(
            [node, "--check", str(script)],
            check=True,
            capture_output=True,
            text=True,
        )
    return len(resources)


def validate_checksum(archive_path: Path) -> None:
    sidecar = archive_path.with_suffix(".zip.sha256")
    if not sidecar.is_file():
        raise AssertionError(f"release checksum is missing: {sidecar.name}")
    fields = sidecar.read_text(encoding="ascii").strip().split()
    if len(fields) < 2 or fields[1] != archive_path.name:
        raise AssertionError("release checksum manifest has an invalid filename")
    actual = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    if fields[0].lower() != actual:
        raise AssertionError("release checksum does not match the ZIP")


def validate_python_install(plugin_root: Path) -> None:
    if not compileall.compile_dir(plugin_root, quiet=1, force=True):
        raise AssertionError("release Python sources did not compile")
    sys.path.insert(0, str(plugin_root))
    try:
        config = importlib.import_module("wosai_core.config")
        if config.BRAND_COLOR != "#DD6F4A":
            raise AssertionError("installed core configuration did not load correctly")
    finally:
        sys.path.remove(str(plugin_root))
        sys.modules.pop("wosai_core.config", None)
        sys.modules.pop("wosai_core", None)


def remove_tree(path: Path, attempts: int = 12, delay: float = 0.25) -> None:
    """Best-effort recursive delete.

    ``compileall`` writes ``__pycache__`` into the staging directory; on Windows a
    virus scanner or the search indexer can briefly hold those fresh ``.pyc``
    files, so a single ``rmtree`` intermittently leaves the tree behind. Retry
    until the directory is gone (or the attempts run out) so a release check can
    never pollute the repository root with a ``.wosai-release-*`` leftover.
    """
    for _ in range(attempts):
        if not path.exists():
            return
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return
        time.sleep(delay)


def main() -> int:
    archive_path = (
        Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else ROOT / "dist" / f"WOSAI-ComfyUI-{version()}.zip"
    )
    validate_checksum(archive_path)
    staging = Path(tempfile.mkdtemp(prefix=".wosai-release-", dir=ROOT))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            relative_paths = validate_members(archive)
            custom_nodes = staging / "ComfyUI" / "custom_nodes"
            custom_nodes.mkdir(parents=True)
            archive.extractall(custom_nodes)
            plugin_root = custom_nodes / ARCHIVE_ROOT
            json_count = validate_json(plugin_root)
            resource_count = validate_frontend_entries(plugin_root)
            validate_python_install(plugin_root)
    finally:
        remove_tree(staging)
    print(
        f"Verified {archive_path.name}: {len(relative_paths)} files, "
        f"{json_count} JSON documents, {resource_count} extension resources",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
