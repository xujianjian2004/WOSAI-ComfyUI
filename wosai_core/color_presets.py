# WOSAI NodeColor 预设持久化 API
# GET/POST /wosai/color_presets — 读写插件目录下 presets/color_presets.json
# 仅在 PromptServer 可用时注册（import 本模块即生效）；失败由 __init__.py 捕获降级。

import json
import logging
import os
import tempfile
from pathlib import Path
from threading import Lock

from aiohttp import web
from server import PromptServer

from wosai_core.http_security import is_same_origin_request

_PRESETS_DIR = Path(__file__).parent.parent / "presets"
_PRESETS_FILE = _PRESETS_DIR / "color_presets.json"
_SAVE_LOCK = Lock()
_LOGGER = logging.getLogger(__name__)

_DEFAULT = {"version": 1, "recent": [], "custom": []}

# 防御上限：避免异常客户端写入超大文件
_MAX_RECENT = 12
_MAX_CUSTOM = 24
_MAX_BODY = 64 * 1024  # 64KB


def _sanitize_list(items, cap):
    """只保留 {hex: '#RRGGBB'} 形式的合法条目。"""
    out = []
    if not isinstance(items, list):
        return out
    for item in items:
        hex_val = item.get("hex") if isinstance(item, dict) else None
        if (
            isinstance(hex_val, str)
            and len(hex_val) == 7
            and hex_val.startswith("#")
            and all(c in "0123456789abcdefABCDEF" for c in hex_val[1:])
        ):
            out.append({"hex": hex_val})
        if len(out) >= cap:
            break
    return out


def _load() -> dict:
    try:
        with open(_PRESETS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return dict(_DEFAULT)
        return {
            "version": 1,
            "recent": _sanitize_list(data.get("recent"), _MAX_RECENT),
            "custom": _sanitize_list(data.get("custom"), _MAX_CUSTOM),
        }
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return dict(_DEFAULT)


def _save(data: dict) -> None:
    with _SAVE_LOCK:
        _PRESETS_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=_PRESETS_DIR,
                prefix=f".{_PRESETS_FILE.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                tmp_path = Path(handle.name)
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, _PRESETS_FILE)
        finally:
            if tmp_path is not None:
                tmp_path.unlink(missing_ok=True)


routes = PromptServer.instance.routes


@routes.get("/wosai/color_presets")
async def get_color_presets(request) -> web.Response:
    return web.json_response(_load())


@routes.post("/wosai/color_presets")
async def post_color_presets(request) -> web.Response:
    if not is_same_origin_request(request):
        return web.json_response({"error": "cross-origin request rejected"}, status=403)
    if request.content_length and request.content_length > _MAX_BODY:
        return web.json_response({"error": "payload too large"}, status=413)
    try:
        chunks = []
        remaining = _MAX_BODY + 1
        while remaining:
            chunk = await request.content.read(remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > _MAX_BODY or not request.content.at_eof():
            return web.json_response({"error": "payload too large"}, status=413)
        body = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "invalid payload"}, status=400)
    data = {
        "version": 1,
        "recent": _sanitize_list(body.get("recent"), _MAX_RECENT),
        "custom": _sanitize_list(body.get("custom"), _MAX_CUSTOM),
    }
    try:
        _save(data)
    except OSError:
        _LOGGER.exception("Failed to save WOSAI color presets")
        return web.json_response({"error": "could not save presets"}, status=500)
    return web.json_response({"ok": True})
