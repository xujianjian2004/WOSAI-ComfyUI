"""Build a deterministic ComfyUI source-install ZIP."""

from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_ROOT = "WOSAI-ComfyUI"
ROOT_FILES = (
    "__init__.py",
    "VERSION",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "extension.json",
    "requirements.txt",
    "package.json",
    "package-lock.json",
    "pyproject.toml",
    "MANIFEST.in",
    "I18N_GUIDELINES.md",
    "preview.png",
)
RUNTIME_DIRECTORIES = ("nodes", "wosai_core", "web", "presets", "workflows", "docs")
EXCLUDED_PARTS = {"__pycache__", "node_modules"}
EXCLUDED_SUFFIXES = (".pyc", ".pyo", ".test.mjs", "._chk.mjs", ".zip")
# 运行时用户状态：Prompt Manager 在本地生成/改写的预设库，绝不进发布包，
# 否则会把使用者本地的预设内容打包分发出去。
EXCLUDED_RELATIVE_PATHS = {
    "presets/preset_library.json",
    "presets/preset_library.backup.json",
}
ZIP_TIMESTAMP = (2026, 1, 1, 0, 0, 0)


def version() -> str:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return str(package["version"])


def included_files() -> list[Path]:
    files = [ROOT / name for name in ROOT_FILES]
    for directory in RUNTIME_DIRECTORIES:
        files.extend(path for path in (ROOT / directory).rglob("*") if path.is_file())
    result = []
    for path in files:
        relative = path.relative_to(ROOT)
        if relative.as_posix() in EXCLUDED_RELATIVE_PATHS:
            continue
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        if path.name.endswith(EXCLUDED_SUFFIXES):
            continue
        if not path.exists():
            raise FileNotFoundError(f"required release file is missing: {relative.as_posix()}")
        result.append(path)
    return sorted(set(result), key=lambda path: path.relative_to(ROOT).as_posix())


def write_archive(destination: Path) -> tuple[int, str]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    files = included_files()
    with zipfile.ZipFile(
        destination,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for path in files:
            relative = path.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo(f"{ARCHIVE_ROOT}/{relative}", ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compresslevel=9)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix(".zip.sha256").write_text(
        f"{digest}  {destination.name}\n",
        encoding="ascii",
        newline="\n",
    )
    return len(files), digest


def main() -> int:
    destination = (
        Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else ROOT / "dist" / f"WOSAI-ComfyUI-{version()}.zip"
    )
    count, digest = write_archive(destination)
    print(f"Built {destination} with {count} files")
    print(f"SHA256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
