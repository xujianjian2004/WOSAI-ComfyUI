import math
from typing import Optional

from wosai_core.config import CATEGORY_PREFIX

RESOLUTION_DATA = {
    "SD 480P 标清": {
        "3:2": (768, 512),  "2:3": (512,  768),
        "4:3": (512, 384),  "3:4": (384,  512),
        "16:9":(640, 360),  "9:16":(360,  640),
        "21:9":(768, 328),
        "1:1": (512, 512),
    },
    "HD 720P 高清": {
        "3:2": (1152, 768),  "2:3": (768,  1152),
        "4:3": (1024, 768),  "3:4": (768,  1024),
        "16:9":(1280, 720),  "9:16":(720,  1280),
        "21:9":(1280, 544),
        "1:1": (768,  768),
    },
    "FHD 1080P 全高清": {
        "3:2": (1536, 1024), "2:3": (1024, 1536),
        "4:3": (1280, 960),  "3:4": (960,  1280),
        "16:9":(1920, 1080), "9:16":(1080, 1920),
        "21:9":(2560, 1080),
        "1:1": (1024, 1024),
    },
    "QHD 2K+ 超清": {
        "3:2": (2304, 1536), "2:3": (1536, 2304),
        "4:3": (2048, 1536), "3:4": (1536, 2048),
        "16:9":(2560, 1440), "9:16":(1440, 2560),
        "21:9":(3440, 1440),
        "1:1": (1536, 1536),
    },
}

ASPECT_RATIOS = [
    "3:2 Classic 经典胶片", "2:3 Photo 人像照片",
    "4:3 Standard 标准画幅", "3:4 Portrait 竖幅人像",
    "16:9 Widescreen 标准宽屏", "9:16 Mobile 手机竖屏",
    "21:9 Ultrawide 超宽银幕",
    "1:1 Square 正方形",
]

MAX_DIMENSION = 2048
MIN_DIMENSION = 256

DEFAULT_RES   = "FHD 1080P 全高清"
DEFAULT_RATIO = "9:16 Mobile 手机竖屏"


def _r8(v: int) -> int:
    return max(0, math.floor(v / 8) * 8)


class WOSAI_SizeSelect:
    CATEGORY    = CATEGORY_PREFIX + "图像"

    DESCRIPTION = "预设与自定义双模式分辨率选择，自动8倍数对齐"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "Manual_Mode": (["off", "on"], {"default": "off", "tooltip": "off=预设模式 on=自定义模式"}),
            },
            "optional": {
                "Resolution":    (list(RESOLUTION_DATA.keys()), {"default": DEFAULT_RES, "tooltip": "选择预设分辨率档位"}),
                "Aspect_Ratio":  (ASPECT_RATIOS, {"default": DEFAULT_RATIO, "tooltip": "选择画面宽高比"}),
                "Custom_Width":  ("INT", {"default": MIN_DIMENSION, "min": MIN_DIMENSION, "max": MAX_DIMENSION, "step": 8, "tooltip": "自定义宽度（仅自定义模式）"}),
                "Custom_Height": ("INT", {"default": MAX_DIMENSION, "min": MIN_DIMENSION, "max": MAX_DIMENSION, "step": 8, "tooltip": "自定义高度（仅自定义模式）"}),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION     = "calculate_size"
    OUTPUT_NODE  = False

    def calculate_size(
        self,
        Manual_Mode: str = "off",
        Resolution: Optional[str] = None,
        Aspect_Ratio: Optional[str] = None,
        Custom_Width: int = 256,
        Custom_Height: int = 2048,
        **kwargs,
    ) -> tuple[int, int]:
        if Manual_Mode == "on":
            w = max(MIN_DIMENSION, min(MAX_DIMENSION, Custom_Width))
            h = max(MIN_DIMENSION, min(MAX_DIMENSION, Custom_Height))
            return (_r8(w), _r8(h))

        if not Resolution:
            Resolution = DEFAULT_RES
        if not Aspect_Ratio:
            Aspect_Ratio = DEFAULT_RATIO

        aspect_key = Aspect_Ratio.split(" ")[0] if Aspect_Ratio else DEFAULT_RATIO.split(" ")[0]

        if Resolution not in RESOLUTION_DATA:
            raise ValueError(f"[WOSAI_SizeSelect] Invalid resolution: {Resolution!r}")
        if aspect_key not in RESOLUTION_DATA[Resolution]:
            raise ValueError(f"[WOSAI_SizeSelect] Invalid aspect ratio: {Aspect_Ratio!r}")

        w, h = RESOLUTION_DATA[Resolution][aspect_key]
        return (_r8(w), _r8(h))

    @classmethod
    def VALIDATE_INPUTS(
        cls,
        Manual_Mode: str = "off",
        Resolution: Optional[str] = None,
        Aspect_Ratio: Optional[str] = None,
        Custom_Width: int = 256,
        Custom_Height: int = 2048,
        **kwargs,
    ):
        if Manual_Mode == "on":
            if not (MIN_DIMENSION <= Custom_Width <= MAX_DIMENSION):
                return f"自定义宽度必须在 {MIN_DIMENSION}-{MAX_DIMENSION} 之间"
            if not (MIN_DIMENSION <= Custom_Height <= MAX_DIMENSION):
                return f"自定义高度必须在 {MIN_DIMENSION}-{MAX_DIMENSION} 之间"
            if Custom_Width % 8 != 0 or Custom_Height % 8 != 0:
                return "自定义宽高必须是 8 的倍数"
        else:
            if Resolution and Resolution not in RESOLUTION_DATA:
                return f"无效的分辨率: {Resolution}"
        return True

    @classmethod
    def IS_CHANGED(
        cls,
        Manual_Mode: str = "off",
        Resolution: Optional[str] = None,
        Aspect_Ratio: Optional[str] = None,
        Custom_Width: int = 256,
        Custom_Height: int = 2048,
        **kwargs,
    ) -> tuple[str, Optional[str], Optional[str], int, int]:
        return (Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)


NODE_CLASS_MAPPINGS = {
    "WOSAI_SizeSelect": WOSAI_SizeSelect,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_SizeSelect": "尺寸选择 SizeSelect",
}


# ── V3 API 版本（comfy_api 可用时由根 __init__.py 覆盖注册）──────────────
# 与 V1 共享同一份 RESOLUTION_DATA / ASPECT_RATIOS / _r8，消除数据双份拷贝
try:
    from comfy_api.latest import io as _io

    class WOSAI_SizeSelect_V3(_io.ComfyNode):

        @classmethod
        def define_schema(cls):
            return _io.Schema(
                node_id="WOSAI_SizeSelect",
                display_name="尺寸选择 SizeSelect",
                category=CATEGORY_PREFIX + "图像",
                description="作者：穿山阅海 | 预设/自定义双模式分辨率选择，自动8倍数对齐",
                inputs=[
                    _io.Combo.Input("Manual_Mode", options=["off", "on"],
                                    default="off",
                                    tooltip="off=预设模式 on=自定义模式"),
                    _io.Combo.Input("Resolution", options=list(RESOLUTION_DATA.keys()),
                                    default=DEFAULT_RES, optional=True,
                                    tooltip="选择预设分辨率档位"),
                    _io.Combo.Input("Aspect_Ratio", options=ASPECT_RATIOS,
                                    default=DEFAULT_RATIO, optional=True,
                                    tooltip="选择画面宽高比"),
                    _io.Int.Input("Custom_Width", default=MIN_DIMENSION,
                                  min=MIN_DIMENSION, max=MAX_DIMENSION, step=8,
                                  optional=True,
                                  tooltip="自定义宽度（仅自定义模式）"),
                    _io.Int.Input("Custom_Height", default=MAX_DIMENSION,
                                  min=MIN_DIMENSION, max=MAX_DIMENSION, step=8,
                                  optional=True,
                                  tooltip="自定义高度（仅自定义模式）"),
                ],
                outputs=[
                    _io.Int.Output("width", display_name="width"),
                    _io.Int.Output("height", display_name="height"),
                ],
            )

        @classmethod
        def validate_inputs(cls, Manual_Mode="off", Resolution=None,
                            Aspect_Ratio=None, Custom_Width=256, Custom_Height=2048):
            return WOSAI_SizeSelect.VALIDATE_INPUTS(
                Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)

        @classmethod
        def fingerprint_inputs(cls, Manual_Mode="off", Resolution=None,
                               Aspect_Ratio=None, Custom_Width=256, Custom_Height=2048):
            return (Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)

        @classmethod
        def execute(cls, Manual_Mode="off", Resolution=None,
                    Aspect_Ratio=None, Custom_Width=256, Custom_Height=2048):
            w, h = WOSAI_SizeSelect().calculate_size(
                Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)
            return _io.NodeOutput(w, h)
except ImportError:
    pass  # V1-only 环境（旧版 ComfyUI）
