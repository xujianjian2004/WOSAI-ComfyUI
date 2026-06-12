from pathlib import Path
from .wosai_core.registry import Registry

WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

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

# ── V3 nodes: upgrade if comfy_api is available ──
# 注：OmniSlider 有意保留 V1（其 hidden-widget 序列化机制依赖 V1 INPUT_TYPES），
#     原 nodes_v3/omni_slider_v3.py 因 schema 缺少 ch*_cfg 输入已删除。
try:
    from comfy_api.latest import ComfyExtension

    from .nodes.canvas_note import WOSAI_CanvasNote_V3
    from .nodes.size_select import WOSAI_SizeSelect_V3

    # Override V1 registrations with V3 versions (same node_id = backward compat)
    NODE_CLASS_MAPPINGS["WOSAI_CanvasNote"] = WOSAI_CanvasNote_V3
    NODE_CLASS_MAPPINGS["WOSAI_SizeSelect"] = WOSAI_SizeSelect_V3
    NODE_DISPLAY_NAME_MAPPINGS["WOSAI_CanvasNote"] = "画布注释 CanvasNote"
    NODE_DISPLAY_NAME_MAPPINGS["WOSAI_SizeSelect"] = "尺寸选择 SizeSelect"

    _v3_node_list = [WOSAI_CanvasNote_V3, WOSAI_SizeSelect_V3]

    class WOSAIExtension(ComfyExtension):
        async def get_node_list(self) -> list:
            return _v3_node_list

    async def comfy_entrypoint():
        return WOSAIExtension()

    print("[WOSAI-ComfyUI] V3 API detected — CanvasNote & SizeSelect upgraded to V3")
except ImportError as e:
    print(f"[WOSAI-ComfyUI] V3 API not available — using V1 fallback for all nodes ({e})")
except Exception as e:
    print(f"[WOSAI-ComfyUI] V3 init skipped: {e}")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
