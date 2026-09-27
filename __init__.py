"""WOSAI-ComfyUI: Professional visualization toolkit for ComfyUI nodes."""
from pathlib import Path
from .wosai_core.registry import Registry

from .wosai_core.config import VERSION
__version__: str = VERSION  # 单一版本源：wosai_core/config.py::VERSION
__author__: str = "穿山阅海"

WEB_DIRECTORY: str = "./web"
NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}

# ── V1 nodes: always available (baseline) ──
_nodes_dir = Path(__file__).parent / "nodes"
Registry.discover_nodes(_nodes_dir)

NODE_CLASS_MAPPINGS.update(Registry.NODE_CLASS_MAPPINGS)
NODE_DISPLAY_NAME_MAPPINGS.update(Registry.NODE_DISPLAY_NAME_MAPPINGS)

# ── NodeColor 预设持久化 API（/wosai/color_presets）──
# PromptServer 不可用（如单测环境）时静默降级，前端自动回退 localStorage
try:
    from .wosai_core import color_presets  # noqa: F401  导入即注册路由
except Exception as e:
    print(f"[WOSAI-ComfyUI] color presets API unavailable: {e}")

# ── SizeSelect 原图尺寸探测 API（/wosai/probe_image_size）──
# Layer 2 兜底：前端 Layer 1 拿不到输入尺寸时调用
try:
    from .wosai_core.wosai_size_probe import setup_routes as _setup_size_probe
    _setup_size_probe()
except Exception as e:
    print(f"[WOSAI-ComfyUI] size probe API unavailable: {e}")

# Preset Manager keeps its full reusable library under ``presets`` while each
# workflow only stores the selected display snapshot.
try:
    from .wosai_core import preset_library  # noqa: F401
except Exception as e:
    print(f"[WOSAI-ComfyUI] preset library API unavailable: {e}")

# Device information API (``/wosai/device_info``).  The collector is isolated
# so a missing optional system dependency never prevents the extension loading.
try:
    from .wosai_core.device_info import setup_routes as _setup_device_info
    _setup_device_info()
except Exception as e:
    print(f"[WOSAI-ComfyUI] device info API unavailable: {e}")

# ── CanvasNote 已迁出为独立插件（ComfyUI-Title-Memo），不再内置于 WOSAI。
#    SizeSelect 保留 V1 / Nodes 2.0 V3 双实现；OmniSlider 仍为 V1，
#    因其 hidden-widget 序列化依赖 V1 INPUT_TYPES。

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
