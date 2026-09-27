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

# 数据结构与前端 web/shared/color-store.js 对齐：
#   recent       [{hex}]
#   customSolid  [{type:'solid', title, bg}]
#   customGrad2  [{type:'grad2', dir, stops:[{hex, p}]}]
#   customGrad3  [{type:'grad3', dir, stops:[{hex, p}]}]
_DEFAULT = {
    "version": 2,
    "recent": [],
    "customSolid": [],
    "customGrad2": [],
    "customGrad3": [],
}

# 防御上限：避免异常客户端写入超大文件（与前端 color-store.js 的上限一致）
_MAX_RECENT = 12
_MAX_CUSTOM = 16
_MAX_BODY = 64 * 1024  # 64KB
_MAX_TITLE = 32       # 自定义纯色预设标题长度上限

# 合法渐变方向符号（与 web/shared/color-core.js 的 DIRS / CSS_DIR_MAP 一致）
_DIR_SYMBOLS = frozenset("↖↑↗←→↙↓↘")
_DEFAULT_DIR = "↓"


def _is_hex(value) -> bool:
    """判断是否为规范 7 位 #RRGGBB 十六进制颜色。"""
    return (
        isinstance(value, str)
        and len(value) == 7
        and value.startswith("#")
        and all(c in "0123456789abcdefABCDEF" for c in value[1:])
    )


def _sanitize_hex_list(items, cap):
    """取色历史：只保留 {hex: '#RRGGBB'} 形式的合法条目。"""
    out = []
    if not isinstance(items, list):
        return out
    for item in items:
        hex_val = item.get("hex") if isinstance(item, dict) else None
        if _is_hex(hex_val):
            out.append({"hex": hex_val})
        if len(out) >= cap:
            break
    return out


def _sanitize_title(value) -> str:
    """自定义纯色预设标题：仅保留字符串并截断。"""
    if not isinstance(value, str):
        return ""
    return value.strip()[:_MAX_TITLE]


def _sanitize_solid_list(items, cap):
    """自定义纯色预设：[{type:'solid', title, bg}]，bg 必须为合法 hex。"""
    out = []
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        bg = item.get("bg")
        if not _is_hex(bg):
            continue
        out.append({"type": "solid", "title": _sanitize_title(item.get("title")), "bg": bg})
        if len(out) >= cap:
            break
    return out


def _sanitize_gradient_list(items, kind, cap):
    """自定义渐变预设：[{type:'grad2'|'grad3', dir, stops:[{hex, p}]}]。

    至少保留 2 个合法色标（2 色标渐变可由前端推导中间色），
    超过 grad2=2 / grad3=3 的色标被截断，位置钳制在 [0, 1]。
    """
    out = []
    if not isinstance(items, list):
        return out
    stop_cap = 3 if kind == "grad3" else 2
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_stops = item.get("stops")
        if not isinstance(raw_stops, list):
            continue
        stops = []
        for stop in raw_stops:
            if not isinstance(stop, dict) or not _is_hex(stop.get("hex")):
                continue
            pos = stop.get("p")
            if isinstance(pos, bool) or not isinstance(pos, (int, float)):
                pos = 0.0
            stops.append({"hex": stop["hex"], "p": min(max(float(pos), 0.0), 1.0)})
            if len(stops) >= stop_cap:
                break
        # 少于两个色标无法构成渐变，丢弃
        if len(stops) < 2:
            continue
        direction = item.get("dir")
        if direction not in _DIR_SYMBOLS:
            direction = _DEFAULT_DIR
        out.append({"type": kind, "dir": direction, "stops": stops})
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
            "version": 2,
            "recent": _sanitize_hex_list(data.get("recent"), _MAX_RECENT),
            "customSolid": _sanitize_solid_list(data.get("customSolid"), _MAX_CUSTOM),
            "customGrad2": _sanitize_gradient_list(data.get("customGrad2"), "grad2", _MAX_CUSTOM),
            "customGrad3": _sanitize_gradient_list(data.get("customGrad3"), "grad3", _MAX_CUSTOM),
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
    # See preset_library: older route stacks can dispatch GET to the last
    # handler registered for a duplicate path.
    if request.method == "GET":
        return web.json_response(_load())
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
        "version": 2,
        "recent": _sanitize_hex_list(body.get("recent"), _MAX_RECENT),
        "customSolid": _sanitize_solid_list(body.get("customSolid"), _MAX_CUSTOM),
        "customGrad2": _sanitize_gradient_list(body.get("customGrad2"), "grad2", _MAX_CUSTOM),
        "customGrad3": _sanitize_gradient_list(body.get("customGrad3"), "grad3", _MAX_CUSTOM),
    }
    try:
        _save(data)
    except OSError:
        _LOGGER.exception("Failed to save WOSAI color presets")
        return web.json_response({"error": "could not save presets"}, status=500)
    return web.json_response({"ok": True})
