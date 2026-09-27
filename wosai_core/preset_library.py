"""Persistent full preset library for the WOSAI Preset Manager.

The node workflow keeps a small, portable display snapshot. This module owns
the larger editable library under ``presets/`` so users can keep more
categories and presets without making every workflow huge.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

from aiohttp import web
from server import PromptServer

from wosai_core.http_security import is_same_origin_request

_PRESETS_DIR = Path(__file__).parent.parent / "presets"
_PRESETS_FILE = _PRESETS_DIR / "preset_library.json"
_BACKUP_FILE = _PRESETS_DIR / "preset_library.backup.json"
_CATALOG_FILE = _PRESETS_DIR / "preset_prompt_catalog.json"
_SAVE_LOCK = Lock()
_LOGGER = logging.getLogger(__name__)

_MAX_BODY = 8 * 1024 * 1024
_MAX_CATEGORIES = 500
_MAX_PRESETS_PER_CATEGORY = 500
_MAX_TEXT_LENGTH = 160_000
_MAX_LABEL_LENGTH = 512


def _text(value: Any, limit: int = _MAX_TEXT_LENGTH) -> str:
    return str(value if value is not None else "").strip()[:limit]


def _identifier(value: Any, fallback: str) -> str:
    return _text(value, 160) or fallback


def _preset(item: Any, category_index: int, preset_index: int) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    value = {
        "id": _identifier(item.get("id"), f"preset-{category_index + 1:03d}-{preset_index + 1:03d}"),
        "label": _text(item.get("label") or item.get("name"), _MAX_LABEL_LENGTH),
        "prompt_cn": _text(item.get("prompt_cn") or item.get("promptCn") or item.get("cn")),
        "prompt_en": _text(item.get("prompt_en") or item.get("promptEn") or item.get("en")),
    }
    for key in ("label_i18n", "thumbnail"):
        if text := _text(item.get(key), _MAX_LABEL_LENGTH):
            value[key] = text
    return value


def _category(item: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    presets_source = item.get("presets")
    if not isinstance(presets_source, list):
        presets_source = []
    presets = [
        value
        for preset_index, source in enumerate(presets_source[:_MAX_PRESETS_PER_CATEGORY])
        if (value := _preset(source, index, preset_index)) is not None
    ]
    value: dict[str, Any] = {
        "id": _identifier(item.get("id"), f"category-{index + 1:03d}"),
        "label": _text(item.get("label") or item.get("category"), _MAX_LABEL_LENGTH) or f"Category {index + 1}",
        "presets": presets,
    }
    if text := _text(item.get("label_i18n") or item.get("category_i18n"), _MAX_LABEL_LENGTH):
        value["label_i18n"] = text
    if text := _text(item.get("thumbnail"), _MAX_LABEL_LENGTH):
        value["thumbnail"] = text
    return value


def _sanitize(data: Any) -> dict[str, Any]:
    source = data.get("categories") if isinstance(data, dict) else []
    if not isinstance(source, list):
        source = []
    categories = [
        value for index, item in enumerate(source[:_MAX_CATEGORIES])
        if (value := _category(item, index)) is not None
    ]
    return {"version": 1, "categories": categories}


def _catalog_library() -> dict[str, Any]:
    """Convert the bundled flat catalog to the library schema once."""
    try:
        raw = json.loads(_CATALOG_FILE.read_text(encoding="utf-8"))
        presets = raw.get("presets", []) if isinstance(raw, dict) else raw
    except (OSError, ValueError, TypeError):
        presets = []
    grouped: dict[str, dict[str, Any]] = {}
    if isinstance(presets, list):
        for item in presets:
            if not isinstance(item, dict):
                continue
            category_label = _text(item.get("category"), _MAX_LABEL_LENGTH) or "General"
            group = grouped.setdefault(category_label, {
                "label": category_label,
                "label_i18n": _text(item.get("category_i18n"), _MAX_LABEL_LENGTH),
                "presets": [],
            })
            group["presets"].append({
                "label": item.get("label", ""),
                "label_i18n": item.get("label_i18n", ""),
                "thumbnail": item.get("thumbnail", ""),
                "prompt_cn": item.get("prompt_cn", ""),
                "prompt_en": item.get("prompt_en", ""),
            })
    return _sanitize({"categories": list(grouped.values())})


def _has_prompt_content(data: dict[str, Any]) -> bool:
    """A name-only library cannot produce a usable node prompt snapshot."""
    return any(
        _text(preset.get("prompt_cn")) or _text(preset.get("prompt_en"))
        for category in data.get("categories", [])
        if isinstance(category, dict)
        for preset in category.get("presets", [])
        if isinstance(preset, dict)
    )


def _load() -> dict[str, Any]:
    try:
        raw = json.loads(_PRESETS_FILE.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            data = _sanitize(raw)
            # Earlier placeholder-only library builds stored category and
            # preset names but no bilingual prompt content. Selecting those
            # entries synced empty cards into the node. Repair that specific
            # unusable state from the bundled catalog and retain a backup.
            if _has_prompt_content(data):
                return data
            recovered = _catalog_library()
            if _has_prompt_content(recovered):
                _save(recovered)
                return recovered
            return data
    except (OSError, ValueError, TypeError):
        pass
    # First access produces a visible, editable library file in ``presets``.
    data = _catalog_library()
    try:
        _save(data, backup=False)
    except OSError:
        _LOGGER.warning("Unable to initialize WOSAI preset library", exc_info=True)
    return data


def _save(data: dict[str, Any], *, backup: bool = True) -> None:
    with _SAVE_LOCK:
        _PRESETS_DIR.mkdir(parents=True, exist_ok=True)
        if backup and _PRESETS_FILE.exists():
            shutil.copy2(_PRESETS_FILE, _BACKUP_FILE)
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=_PRESETS_DIR,
                prefix=f".{_PRESETS_FILE.name}.", suffix=".tmp", delete=False,
            ) as handle:
                temporary = Path(handle.name)
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, _PRESETS_FILE)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


async def _read_json_body(request) -> tuple[dict[str, Any] | None, web.Response | None]:
    if request.content_length and request.content_length > _MAX_BODY:
        return None, web.json_response({"error": "payload too large"}, status=413)
    try:
        raw = await request.content.read(_MAX_BODY + 1)
        if len(raw) > _MAX_BODY or not request.content.at_eof():
            return None, web.json_response({"error": "payload too large"}, status=413)
        parsed = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return None, web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(parsed, dict):
        return None, web.json_response({"error": "invalid payload"}, status=400)
    return parsed, None


routes = PromptServer.instance.routes


@routes.get("/wosai/preset_library")
async def get_preset_library(request) -> web.Response:
    return web.json_response(_load())


@routes.post("/wosai/preset_library")
async def post_preset_library(request) -> web.Response:
    # Some ComfyUI route stacks dispatch the unprefixed GET endpoint through
    # the last registered handler for the same path. Keep reads safe in that
    # compatibility path instead of attempting to parse an empty request body.
    if request.method == "GET":
        return web.json_response(_load())
    if not is_same_origin_request(request):
        return web.json_response({"error": "cross-origin request rejected"}, status=403)
    body, error = await _read_json_body(request)
    if error is not None:
        return error
    data = _sanitize(body)
    try:
        _save(data)
    except OSError:
        _LOGGER.exception("Failed to save WOSAI preset library")
        return web.json_response({"error": "could not save preset library"}, status=500)
    return web.json_response({"ok": True, "categories": len(data["categories"])})
