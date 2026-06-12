# WOSAI NodeColor 预设持久化 API
# GET/POST /wosai/color_presets — 读写插件目录下 presets/color_presets.json
# 仅在 PromptServer 可用时注册（import 本模块即生效）；失败由 __init__.py 捕获降级。

import json
from pathlib import Path

from aiohttp import web
from server import PromptServer

_PRESETS_DIR = Path(__file__).parent.parent / "presets"
_PRESETS_FILE = _PRESETS_DIR / "color_presets.json"

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
    _PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _PRESETS_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(_PRESETS_FILE)  # 原子写，避免写一半损坏


routes = PromptServer.instance.routes


@routes.get("/wosai/color_presets")
async def get_color_presets(request):
    return web.json_response(_load())


@routes.post("/wosai/color_presets")
async def post_color_presets(request):
    if request.content_length and request.content_length > _MAX_BODY:
        return web.json_response({"error": "payload too large"}, status=413)
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid json"}, status=400)
    data = {
        "version": 1,
        "recent": _sanitize_list(body.get("recent"), _MAX_RECENT),
        "custom": _sanitize_list(body.get("custom"), _MAX_CUSTOM),
    }
    try:
        _save(data)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"ok": True})
