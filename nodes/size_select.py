import math
from typing import Optional

import numpy as np
import torch
from PIL import Image

from wosai_core.config import CATEGORY_PREFIX

# ═══ 分辨率数据 ═══════════════════════════════════════════════════════════════════
# ⚠ 与 web/size-select.js 的 RESOLUTION_DATA 必须保持同步（后端是真正的计算源）
#   前端用于 UI 渲染与即时预览）。修改任一端时须同步另一端。
RESOLUTION_DATA = {
    "SD 480P": {
        "3:2": (768, 512),  "2:3": (512,  768),
        "4:3": (512, 384),  "3:4": (384,  512),
        "16:9":(640, 360),  "9:16":(360,  640),
        "21:9":(768, 328),
        "1:1": (512, 512),
    },
    "HD 720P": {
        "3:2": (1152, 768),  "2:3": (768,  1152),
        "4:3": (1024, 768),  "3:4": (768,  1024),
        "16:9":(1280, 720),  "9:16":(720,  1280),
        "21:9":(1280, 544),
        "1:1": (768,  768),
    },
    "FHD 1080P": {
        "3:2": (1536, 1024), "2:3": (1024, 1536),
        "4:3": (1280, 960),  "3:4": (960,  1280),
        "16:9":(1920, 1080), "9:16":(1080, 1920),
        "21:9":(2560, 1080),
        "1:1": (1024, 1024),
    },
    "QHD 2K+": {
        "3:2": (2304, 1536), "2:3": (1536, 2304),
        "4:3": (2048, 1536), "3:4": (1536, 2048),
        "16:9":(2560, 1440), "9:16":(1440, 2560),
        "21:9":(3440, 1440),
        "1:1": (1536, 1536),
    },
}

ASPECT_RATIOS = [
    "3:2 Classic", "2:3 Photo",
    "4:3 Standard", "3:4 Portrait",
    "16:9 Widescreen", "9:16 Mobile",
    "21:9 Ultrawide",
    "1:1 Square",
]

MAX_DIMENSION = 2048
MIN_DIMENSION = 256

DEFAULT_RES   = "FHD 1080P"
DEFAULT_RATIO = "9:16 Mobile"


def _r8(v: int) -> int:
    return max(0, math.floor(v / 8) * 8)


class WOSAI_SizeSelect:
    CATEGORY    = CATEGORY_PREFIX + "图像"

    DESCRIPTION = "Dual-mode resolution selector with preset and custom sizes, supports image/mask/latent scaling with crop and fit modes | 预设与自定义双模式分辨率选择，支持图像/遮罩/Latent缩放，含裁剪与适配模式"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "Manual_Mode":    (["off", "on"], {"default": "off", "tooltip": "Preset mode / Manual mode | 预设模式 / 手动模式"}),
                "scale_method":   (["Crop", "Scale"], {"default": "Crop", "tooltip": "Crop=center crop to target ratio / Scale=uniform scale by multiplier | Crop=中心裁剪到目标比例 / Scale=按倍数等比缩放"}),
                "scale_multiplier": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.1, "tooltip": "Active in Scale mode, relative to original size | 在Scale模式下生效，相对于原始尺寸"}),
            },
            "optional": {
                "Resolution":    (list(RESOLUTION_DATA.keys()), {"default": DEFAULT_RES, "tooltip": "Select preset resolution | 选择预设分辨率"}),
                "Aspect_Ratio":  (ASPECT_RATIOS, {"default": DEFAULT_RATIO, "tooltip": "Select aspect ratio | 选择画面宽高比"}),
                "Custom_Width":  ("INT", {"default": MIN_DIMENSION, "min": MIN_DIMENSION, "max": MAX_DIMENSION, "step": 8, "tooltip": "Custom width (manual mode only) | 自定义宽度（仅手动模式）"}),
                "Custom_Height": ("INT", {"default": MAX_DIMENSION, "min": MIN_DIMENSION, "max": MAX_DIMENSION, "step": 8, "tooltip": "Custom height (manual mode only) | 自定义高度（仅手动模式）"}),
                "image":         ("IMAGE",),
                "mask":          ("MASK",),
                "latent":        ("LATENT",),
                "vae":           ("VAE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "LATENT", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "latent", "width", "height")
    FUNCTION     = "calculate_size"
    OUTPUT_NODE  = False

    def _determine_target_size(self, kwargs, Manual_Mode, Resolution, Aspect_Ratio,
                                Custom_Width, Custom_Height):
        """确定目标像素尺寸（与现有逻辑一致）"""
        if Manual_Mode == "on":
            w = max(MIN_DIMENSION, min(MAX_DIMENSION, Custom_Width))
            h = max(MIN_DIMENSION, min(MAX_DIMENSION, Custom_Height))
        else:
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
        return _r8(w), _r8(h)

    def _center_crop_pil(self, img, target_width, target_height, original_width, original_height):
        """中心裁剪到目标宽高比"""
        aspect_ratio = target_width / target_height
        img_ratio = original_width / original_height
        if img_ratio > aspect_ratio:
            new_width = int(original_height * aspect_ratio)
            left = (original_width - new_width) // 2
            return img.crop((left, 0, left + new_width, original_height))
        else:
            new_height = int(original_width / aspect_ratio)
            top = (original_height - new_height) // 2
            return img.crop((0, top, original_width, top + new_height))

    def calculate_size(
        self,
        Manual_Mode: str = "off",
        scale_method: str = "Crop",
        scale_multiplier: float = 1.0,
        Resolution: Optional[str] = None,
        Aspect_Ratio: Optional[str] = None,
        Custom_Width: int = 256,
        Custom_Height: int = 2048,
        image: Optional[torch.Tensor] = None,
        mask: Optional[torch.Tensor] = None,
        latent: Optional[dict] = None,
        vae = None,
        **kwargs,
    ):
        target_w, target_h = self._determine_target_size(
            kwargs, Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)

        has_image = image is not None
        has_latent = latent is not None
        has_vae = vae is not None

        # ── 计算实际处理尺寸（等比缩放 vs 中心裁剪）──
        if scale_method == "Scale":
            if has_image:
                _, h1, w1, _ = image.shape
                actual_w = int(w1 * scale_multiplier)
                actual_h = int(h1 * scale_multiplier)
            elif has_latent:
                _, _, lh, lw = latent["samples"].shape
                actual_w = int(lw * 8 * scale_multiplier)
                actual_h = int(lh * 8 * scale_multiplier)
            else:
                actual_w, actual_h = target_w, target_h
        else:
            actual_w, actual_h = target_w, target_h

        if has_image:
            # ── 图像输入：缩放图像 + 遮罩 ──
            out_image, out_mask = self._resize_image_and_mask(
                image, mask, actual_w, actual_h, scale_method, target_w, target_h)
            if has_vae:
                encoded = vae.encode(out_image)
                out_latent = {"samples": encoded, "downscale_ratio_spacial": 8}
            else:
                out_latent = {"samples": torch.zeros(
                    (out_image.shape[0], 4, actual_h // 8, actual_w // 8),
                    device=out_image.device), "downscale_ratio_spacial": 8}
            print(f"[WOSAI_SizeSelect] image pixel=({actual_w},{actual_h}) "
                  f"latent_shape={out_latent['samples'].shape}")
            return (out_image, out_mask, out_latent, actual_w, actual_h)

        elif has_latent:
            # ── Latent 输入：缩放 latent ──
            batch_size, channels, latent_h, latent_w = latent["samples"].shape
            original_w = latent_w * 8
            original_h = latent_h * 8

            if scale_method == "Scale":
                # 等比缩放：直接 interpolate 到目标尺寸
                scaled = torch.nn.functional.interpolate(
                    latent["samples"],
                    size=(actual_h // 8, actual_w // 8),
                    mode="bilinear", align_corners=False)
            else:
                # 中心裁剪到目标比例
                target_aspect = target_w / target_h
                original_aspect = original_w / original_h
                if original_aspect > target_aspect:
                    new_w = int(original_h * target_aspect)
                    new_w_latent = new_w // 8
                    start_x = (latent_w - new_w_latent) // 2
                    cropped = latent["samples"][:, :, :, start_x:start_x + new_w_latent]
                else:
                    new_h = int(original_w / target_aspect)
                    new_h_latent = new_h // 8
                    start_y = (latent_h - new_h_latent) // 2
                    cropped = latent["samples"][:, :, start_y:start_y + new_h_latent, :]

                scaled = torch.nn.functional.interpolate(
                    cropped, size=(target_h // 8, target_w // 8),
                    mode="bilinear", align_corners=False)
                actual_w, actual_h = target_w, target_h

            out_latent = {"samples": scaled, "downscale_ratio_spacial": 8}
            print(f"[WOSAI_SizeSelect] latent pixel=({actual_w},{actual_h}) "
                  f"latent_shape={scaled.shape}")
            return (None, None, out_latent, actual_w, actual_h)

        else:
            # ── 无输入：仅返回尺寸 + 空 latent ──
            out_latent = {"samples": torch.zeros(
                (1, 4, actual_h // 8, actual_w // 8)), "downscale_ratio_spacial": 8}
            print(f"[WOSAI_SizeSelect] pixel=({actual_w},{actual_h}) "
                  f"latent_shape={out_latent['samples'].shape} "
                  f"samples_dtype={out_latent['samples'].dtype}")
            return (None, None, out_latent, actual_w, actual_h)

    def _resize_image_and_mask(self, image, mask, target_w, target_h, scale_method="Crop", ratio_w=0, ratio_h=0):
        """缩放图像和遮罩到目标尺寸"""
        new_images = []
        new_masks = []

        batch_size, height1, width1, channels = image.shape
        use_crop = scale_method != "Scale"

        for i in range(batch_size):
            # 处理图像
            img = image[i]
            pil_img = Image.fromarray(
                np.clip(255. * img.cpu().numpy(), 0, 255).astype(np.uint8))

            if use_crop:
                pil_img = self._center_crop_pil(pil_img, target_w, target_h, width1, height1)
                pil_img = pil_img.resize((target_w, target_h), Image.LANCZOS)
            else:
                pil_img = pil_img.resize((target_w, target_h), Image.LANCZOS)

            new_img = np.array(pil_img).astype(np.float32) / 255.0
            new_images.append(new_img)

            # 处理遮罩
            if mask is not None:
                m = mask[i]
                pil_mask = Image.fromarray(
                    np.clip(255. * m.cpu().numpy(), 0, 255).astype(np.uint8))
                if use_crop:
                    pil_mask = self._center_crop_pil(pil_mask, target_w, target_h, width1, height1)
                    pil_mask = pil_mask.resize((target_w, target_h), Image.LANCZOS)
                else:
                    pil_mask = pil_mask.resize((target_w, target_h), Image.LANCZOS)
                new_mask = np.array(pil_mask).astype(np.float32) / 255.0
            else:
                new_mask = np.ones((target_h, target_w), dtype=np.float32)
            new_masks.append(new_mask)

        out_image = torch.tensor(np.stack(new_images, axis=0))
        out_mask = torch.tensor(np.stack(new_masks, axis=0))
        return out_image, out_mask

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
        scale_method: str = "Crop",
        scale_multiplier: float = 1.0,
        Resolution: Optional[str] = None,
        Aspect_Ratio: Optional[str] = None,
        Custom_Width: int = 256,
        Custom_Height: int = 2048,
        **kwargs,
    ) -> tuple[str, str, float, Optional[str], Optional[str], int, int]:
        return (Manual_Mode, scale_method, scale_multiplier, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)


NODE_CLASS_MAPPINGS = {
    "WOSAI_SizeSelect": WOSAI_SizeSelect,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_SizeSelect": "SizeSelect",
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
                display_name="SizeSelect",
                category=CATEGORY_PREFIX + "图像",
                description="Author: 穿山阅海 | Dual-mode resolution selector, auto 8x alignment",
                inputs=[
                    _io.Combo.Input("Manual_Mode", options=["off", "on"],
                                    default="off",
                tooltip="Preset mode / Manual mode | 预设模式 / 手动模式"),
                    _io.Combo.Input("scale_method", options=["Crop", "Scale"],
                                    default="Crop",
                                    tooltip="Crop=center crop to target ratio / Scale=uniform scale by multiplier | Crop=中心裁剪到目标比例 / Scale=按倍数等比缩放"),
                    _io.Float.Input("scale_multiplier", default=1.0,
                                    min=0.1, max=4.0, step=0.1,
                                    tooltip="Active in Scale mode, relative to original size | 在Scale模式下生效，相对于原始尺寸"),
                    _io.Combo.Input("Resolution", options=list(RESOLUTION_DATA.keys()),
                                    default=DEFAULT_RES, optional=True,
                                    tooltip="Select preset resolution | 选择预设分辨率"),
                    _io.Combo.Input("Aspect_Ratio", options=ASPECT_RATIOS,
                                    default=DEFAULT_RATIO, optional=True,
                                    tooltip="Select aspect ratio | 选择宽高比"),
                    _io.Int.Input("Custom_Width", default=MIN_DIMENSION,
                                  min=MIN_DIMENSION, max=MAX_DIMENSION, step=8,
                                  optional=True,
                                  tooltip="Custom width (manual mode only) | 自定义宽度（仅手动模式）"),
                    _io.Int.Input("Custom_Height", default=MAX_DIMENSION,
                                  min=MIN_DIMENSION, max=MAX_DIMENSION, step=8,
                                  optional=True,
                                  tooltip="Custom height (manual mode only) | 自定义高度（仅手动模式）"),
                    _io.Image.Input("image", optional=True,
                                    tooltip="Input image (optional, will be scaled to target size) | 输入图像（可选，将缩放至目标尺寸）"),
                    _io.Mask.Input("mask", optional=True,
                                   tooltip="Input mask (optional, will be scaled synchronously) | 输入遮罩（可选，将同步缩放）"),
                    _io.Latent.Input("latent", optional=True,
                                     tooltip="Input latent (optional, will be scaled to target size) | 输入Latent（可选，将缩放至目标尺寸）"),
                    _io.Vae.Input("vae", optional=True,
                                  tooltip="VAE model (optional, image will be encoded to latent via VAE) | VAE模型（可选，图像将通过VAE编码为Latent）"),
                ],
                # ⚠ 不要硬编码 display_name（会固定为该语言、无法跟随系统语言切换）。
                #   输出名保持英文标识符，由 locales/{en,zh}/nodeDefs.json 的 outputs 段做本地化。
                outputs=[
                    _io.Image.Output("image"),
                    _io.Mask.Output("mask"),
                    _io.Latent.Output("latent"),
                    _io.Int.Output("width"),
                    _io.Int.Output("height"),
                ],
            )

        @classmethod
        def validate_inputs(cls, Manual_Mode="off", Resolution=None,
                            Aspect_Ratio=None, Custom_Width=256, Custom_Height=2048):
            return WOSAI_SizeSelect.VALIDATE_INPUTS(
                Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)

        @classmethod
        def fingerprint_inputs(cls, Manual_Mode="off", scale_method="Crop",
                               scale_multiplier=1.0, Resolution=None,
                               Aspect_Ratio=None, Custom_Width=256, Custom_Height=2048):
            return (Manual_Mode, scale_method, scale_multiplier, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)

        @classmethod
        def execute(cls, Manual_Mode="off", scale_method="Crop",
                    scale_multiplier=1.0, Resolution=None,
                    Aspect_Ratio=None, Custom_Width=256, Custom_Height=2048,
                    image=None, mask=None, latent=None, vae=None):
            result = WOSAI_SizeSelect().calculate_size(
                Manual_Mode, scale_method, scale_multiplier,
                Resolution, Aspect_Ratio, Custom_Width, Custom_Height,
                image=image, mask=mask, latent=latent, vae=vae)
            return _io.NodeOutput(*result)
except ImportError:
    pass  # V1-only 环境（旧版 ComfyUI）
