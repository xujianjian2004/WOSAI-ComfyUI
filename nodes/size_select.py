import math
import logging
import json
from pathlib import Path
from typing import Optional

import torch

from wosai_core.config import CATEGORY_PREFIX

logger = logging.getLogger(__name__)

_RESOLUTION_FILE = Path(__file__).parent.parent / "web" / "data" / "resolutions.json"
_RESOLUTION_CONFIG = json.loads(_RESOLUTION_FILE.read_text(encoding="utf-8"))
RESOLUTION_DATA = {
    resolution: {
        ratio: tuple(dimensions)
        for ratio, dimensions in ratios.items()
    }
    for resolution, ratios in _RESOLUTION_CONFIG["resolutions"].items()
}
ASPECT_RATIOS = list(_RESOLUTION_CONFIG["aspect_ratios"])
MAX_DIMENSION = int(_RESOLUTION_CONFIG["max_dimension"])
MIN_DIMENSION = int(_RESOLUTION_CONFIG["min_dimension"])
DEFAULT_RES = _RESOLUTION_CONFIG["default_resolution"]
DEFAULT_RATIO = _RESOLUTION_CONFIG["default_ratio"]


def _r8(v: int) -> int:
    return max(0, math.floor(v / 8) * 8)


def _scale_r8(v: float) -> int:
    """Scale-mode dimensions must still describe a valid latent grid."""
    return max(8, _r8(int(v)))


def _aligned_dimension(value: float, ratio: int) -> int:
    ratio = max(1, int(ratio))
    return max(ratio, math.floor(float(value) / ratio) * ratio)


def _latent_spatial_ratio(latent: Optional[dict] = None, vae=None) -> int:
    """Return the actual spatial compression ratio, falling back to SD's 8x."""

    candidates = []
    if vae is not None:
        compression = getattr(vae, "spacial_compression_encode", None)
        if callable(compression):
            try:
                candidates.append(compression())
            except (AttributeError, TypeError, ValueError):
                pass
    if isinstance(latent, dict):
        candidates.append(latent.get("downscale_ratio_spacial"))
    for candidate in candidates:
        if isinstance(candidate, (int, float)) and math.isfinite(candidate) and candidate >= 1:
            return int(candidate)
    return 8


class WOSAI_SizeSelect:
    CATEGORY    = CATEGORY_PREFIX + "图像"

    DESCRIPTION = "Dual-mode resolution selector with preset and custom sizes, supports image/mask/latent scaling with crop and fit modes"

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

    def _determine_target_size(self, Manual_Mode, Resolution, Aspect_Ratio,
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

    def _center_crop_tensor(self, tensor, target_width, target_height):
        """中心裁剪到目标宽高比"""
        _, _, original_height, original_width = tensor.shape
        aspect_ratio = target_width / target_height
        img_ratio = original_width / original_height
        if img_ratio > aspect_ratio:
            new_width = int(original_height * aspect_ratio)
            left = (original_width - new_width) // 2
            return tensor[:, :, :, left:left + new_width]
        new_height = int(original_width / aspect_ratio)
        top = (original_height - new_height) // 2
        return tensor[:, :, top:top + new_height, :]

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
            Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height)

        has_image = image is not None
        has_latent = latent is not None
        has_vae = vae is not None
        latent_ratio = _latent_spatial_ratio(latent, vae)
        processing_ratio = latent_ratio if has_latent or has_vae else 8
        if has_latent or has_vae:
            target_w = _aligned_dimension(target_w, processing_ratio)
            target_h = _aligned_dimension(target_h, processing_ratio)

        # ── 计算实际处理尺寸（等比缩放 vs 中心裁剪）──
        if scale_method == "Scale":
            if has_image:
                _, h1, w1, _ = image.shape
                actual_w = _aligned_dimension(w1 * scale_multiplier, processing_ratio)
                actual_h = _aligned_dimension(h1 * scale_multiplier, processing_ratio)
            elif has_latent:
                _, _, lh, lw = latent["samples"].shape
                actual_w = _aligned_dimension(lw * latent_ratio * scale_multiplier, latent_ratio)
                actual_h = _aligned_dimension(lh * latent_ratio * scale_multiplier, latent_ratio)
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
                out_latent = {
                    "samples": encoded,
                    "downscale_ratio_spacial": latent_ratio,
                }
            else:
                out_latent = {"samples": out_image.new_zeros(
                    (out_image.shape[0], 4, actual_h // latent_ratio, actual_w // latent_ratio),
                ), "downscale_ratio_spacial": latent_ratio}
            logger.debug(
                "SizeSelect image pixel=(%s,%s) latent_shape=%s",
                actual_w, actual_h, out_latent["samples"].shape,
            )
            return (out_image, out_mask, out_latent, actual_w, actual_h)

        elif has_latent:
            # ── Latent 输入：缩放 latent ──
            samples = latent["samples"]
            if not isinstance(samples, torch.Tensor) or samples.ndim != 4:
                raise ValueError("[WOSAI_SizeSelect] latent samples must be a 4D tensor")
            _, _, latent_h, latent_w = samples.shape
            original_w = latent_w * latent_ratio
            original_h = latent_h * latent_ratio

            if scale_method == "Scale":
                # 等比缩放：直接 interpolate 到目标尺寸
                scaled = torch.nn.functional.interpolate(
                    samples,
                    size=(actual_h // latent_ratio, actual_w // latent_ratio),
                    mode="bilinear", align_corners=False)
            else:
                # 中心裁剪到目标比例
                target_aspect = target_w / target_h
                original_aspect = original_w / original_h
                if original_aspect > target_aspect:
                    new_w = int(original_h * target_aspect)
                    new_w_latent = max(1, new_w // latent_ratio)
                    start_x = (latent_w - new_w_latent) // 2
                    cropped = samples[:, :, :, start_x:start_x + new_w_latent]
                else:
                    new_h = int(original_w / target_aspect)
                    new_h_latent = max(1, new_h // latent_ratio)
                    start_y = (latent_h - new_h_latent) // 2
                    cropped = samples[:, :, start_y:start_y + new_h_latent, :]

                scaled = torch.nn.functional.interpolate(
                    cropped,
                    size=(target_h // latent_ratio, target_w // latent_ratio),
                    mode="bilinear", align_corners=False)
                actual_w, actual_h = target_w, target_h

            out_latent = dict(latent)
            out_latent["samples"] = scaled
            out_latent["downscale_ratio_spacial"] = latent_ratio
            noise_mask = latent.get("noise_mask")
            if isinstance(noise_mask, torch.Tensor) and noise_mask.ndim in {2, 3, 4}:
                out_latent["noise_mask"] = self._resize_spatial_mask(
                    noise_mask, actual_w, actual_h, scale_method != "Scale"
                )
            logger.debug(
                "SizeSelect latent pixel=(%s,%s) latent_shape=%s",
                actual_w, actual_h, scaled.shape,
            )
            return (None, None, out_latent, actual_w, actual_h)

        else:
            # ── 无输入：仅返回尺寸 + 空 latent ──
            out_latent = {"samples": torch.zeros(
                (1, 4, actual_h // latent_ratio, actual_w // latent_ratio)), "downscale_ratio_spacial": latent_ratio}
            logger.debug(
                "SizeSelect empty pixel=(%s,%s) latent_shape=%s samples_dtype=%s",
                actual_w, actual_h, out_latent["samples"].shape,
                out_latent["samples"].dtype,
            )
            return (None, None, out_latent, actual_w, actual_h)

    def _resize_image_and_mask(self, image, mask, target_w, target_h, scale_method="Crop", ratio_w=0, ratio_h=0):
        """缩放图像和遮罩到目标尺寸"""
        use_crop = scale_method != "Scale"
        image_bchw = image.movedim(-1, 1)
        if use_crop:
            image_bchw = self._center_crop_tensor(image_bchw, target_w, target_h)
        out_image = torch.nn.functional.interpolate(
            image_bchw, size=(target_h, target_w), mode="bicubic", align_corners=False
        ).movedim(1, -1)

        if mask is None:
            out_mask = torch.ones(
                (image.shape[0], target_h, target_w), device=image.device, dtype=image.dtype
            )
        else:
            if mask.ndim == 2:
                mask = mask.unsqueeze(0)
            if mask.ndim != 3:
                raise ValueError("[WOSAI_SizeSelect] mask must be a 2D or 3D tensor")
            if mask.shape[0] == 1 and image.shape[0] > 1:
                mask = mask.expand(image.shape[0], -1, -1)
            elif mask.shape[0] != image.shape[0]:
                raise ValueError("[WOSAI_SizeSelect] mask batch must match image batch")
            mask_bchw = mask.to(device=image.device, dtype=image.dtype).unsqueeze(1)
            if use_crop:
                mask_bchw = self._center_crop_tensor(mask_bchw, target_w, target_h)
            # Masks can be soft; bilinear interpolation preserves that meaning.
            out_mask = torch.nn.functional.interpolate(
                mask_bchw, size=(target_h, target_w), mode="bilinear", align_corners=False
            ).squeeze(1).to(dtype=image.dtype)
        return out_image, out_mask

    def _resize_spatial_mask(self, mask, target_w, target_h, use_crop):
        """Resize a latent noise mask while preserving its rank and tensor traits."""

        original_ndim = mask.ndim
        if original_ndim == 2:
            mask_bchw = mask.unsqueeze(0).unsqueeze(0)
        elif original_ndim == 3:
            mask_bchw = mask.unsqueeze(1)
        else:
            mask_bchw = mask
        if use_crop:
            mask_bchw = self._center_crop_tensor(mask_bchw, target_w, target_h)
        resized = torch.nn.functional.interpolate(
            mask_bchw, size=(target_h, target_w), mode="bilinear", align_corners=False
        )
        if original_ndim == 2:
            return resized[0, 0]
        if original_ndim == 3:
            return resized[:, 0]
        return resized

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
                description="Dual-mode resolution selector, auto 8x alignment",
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
else:
    # Nodes 2.0 可用时使用同一节点 ID 的 V3 Schema；旧版环境保留上方 V1 映射。
    NODE_CLASS_MAPPINGS["WOSAI_SizeSelect"] = WOSAI_SizeSelect_V3
