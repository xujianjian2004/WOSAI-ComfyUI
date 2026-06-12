from wosai_core.config import CATEGORY_PREFIX


class WOSAI_CanvasNote:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    OUTPUT_NODE = False
    FUNCTION = "execute"
    CATEGORY = CATEGORY_PREFIX + "工具"

    DESCRIPTION = "可自由编辑的画布注释节点，支持MarkDown / 渐变 / 预设样式"

    def execute(self):
        return ()

NODE_CLASS_MAPPINGS = {
    "WOSAI_CanvasNote": WOSAI_CanvasNote,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_CanvasNote": "画布注释 CanvasNote",
}


# ── V3 API 版本（comfy_api 可用时由根 __init__.py 覆盖注册）──────────────
try:
    from comfy_api.latest import io as _io

    class WOSAI_CanvasNote_V3(_io.ComfyNode):

        @classmethod
        def define_schema(cls):
            return _io.Schema(
                node_id="WOSAI_CanvasNote",
                display_name="画布注释 CanvasNote",
                category=CATEGORY_PREFIX + "工具",
                description="可自由编辑的注释节点，支持MarkDown / 渐变 / 预设样式",
                inputs=[],
                outputs=[],
            )

        @classmethod
        def execute(cls):
            return _io.NodeOutput()
except ImportError:
    pass  # V1-only 环境（旧版 ComfyUI）
