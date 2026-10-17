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
MIN_DIMENSION = int(_RESOLUTION_CONFIG["min_dimension"])
# 该键仅作为「新建节点时自定义高度」的默认值，不是上限——历史键名 max_dimension 即因此改名。
DEFAULT_CUSTOM_HEIGHT = int(_RESOLUTION_CONFIG["default_custom_height"])
# ⚠ 上限必须**显式**声明，不能靠「省略 max」表达无限。
#   ComfyUI 前端 `useIntWidget()` 里写死了 `max: spec.max ?? 2048`——省略 max 不是
#   「无上限」，而是被前端兜底成 2048。这正是「后端已去掉上限、实测仍卡在 2048」
#   的根因：只删 max 等于把上限设成 2048。
#   这里取 ComfyUI 官方口径 `MAX_RESOLUTION`（EmptyLatentImage 等节点同款），
#   仅用于喂给 UI；后端计算与校验**不夹这个值**（见 _determine_target_size）。
MAX_DIMENSION = 16384
# 像素对齐粒度的默认值：8 = SD / SDXL / Flux 一系的 latent 空间压缩率。
# 可由节点上的 align_multiple（advanced）覆盖，用于下采样率不同的模型。
DEFAULT_ALIGN_MULTIPLE = 8
# 对齐粒度的可调上限：与 V1 / V3 两处声明及 VALIDATE_INPUTS 共用同一个常量，
#   避免三处硬编码后各自漂移（此前 VALIDATE 用的是 MAX_DIMENSION=16384，与 UI 的 128 不符）。
MAX_ALIGN_MULTIPLE = 128
DEFAULT_RES = _RESOLUTION_CONFIG["default_resolution"]
DEFAULT_RATIO = _RESOLUTION_CONFIG["default_ratio"]


def _lcm(a: int, b: int) -> int:
    """两个步长的公倍数。

    像素尺寸要同时满足两个约束：落在「网格粒度」multiple 上，且能被 latent 的
    空间压缩率 ratio 整除（否则 latent 形状只能靠整除截断，与输出的 width/height
    对不上）。同时满足两者 = 落在 lcm(multiple, ratio) 上。
    """
    a = max(1, int(a))
    b = max(1, int(b))
    return a * b // math.gcd(a, b)


def _align(value: float, step: int) -> int:
    """吸附到网格：**四舍五入**，不是向下取整。

    向下取整（`floor`）会让实际尺寸系统性偏小——最多差 step-1 个像素，且 Scale
    模式下连续取整会累积；四舍五入把误差压在 ±0.5 个步长内，与 ComfyUI 原生
    `ResolutionSelector` 的 `round(v / multiple) * multiple` 同口径。
    """
    step = max(1, int(step or 1))
    return max(step, int(round(float(value) / step)) * step)


def _align_grid(value: float, multiple: int, ratio: int = 1) -> int:
    """按「网格粒度 + latent 压缩率」的公倍数吸附。"""
    return _align(value, _lcm(multiple, ratio))


def _fit_scale(src_w: float, src_h: float, target_w: float, target_h: float,
               fit_edge: str = "Long") -> float:
    """等比适配的缩放系数：**不变形、不裁剪**，只按目标框等比缩放。

    Long（默认）= 长边贴齐目标框（contain）：结果**不会超出**目标，另一边按比例缩小。
    Short       = 短边贴齐目标框（cover 但不裁剪）：另一边按比例**超出**目标。

    与 Crop（先裁到目标比例再拉伸到目标尺寸）、Scale（按倍数线性缩放）并列第三种。
    """
    if src_w <= 0 or src_h <= 0 or target_w <= 0 or target_h <= 0:
        return 1.0
    if fit_edge == "Short":
        return min(target_w, target_h) / min(src_w, src_h)
    return min(target_w / src_w, target_h / src_h)


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
                "scale_method":   (["Crop", "Fit", "Scale"], {"default": "Crop", "tooltip": "Crop=center crop to target ratio / Fit=uniform fit inside the target / Scale=uniform scale by multiplier | Crop=中心裁剪到目标比例 / Fit=等比适配到目标框内 / Scale=按倍数等比缩放"}),
                "scale_multiplier": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.1, "tooltip": "Active in Scale mode, relative to original size | 在Scale模式下生效，相对于原始尺寸"}),
            },
            "optional": {
                "Resolution":    (list(RESOLUTION_DATA.keys()), {"default": DEFAULT_RES, "tooltip": "Select preset resolution | 选择预设分辨率"}),
                "Aspect_Ratio":  (ASPECT_RATIOS, {"default": DEFAULT_RATIO, "tooltip": "Select aspect ratio | 选择画面宽高比"}),
                "Custom_Width":  ("INT", {"default": MIN_DIMENSION, "min": MIN_DIMENSION, "max": MAX_DIMENSION, "step": 8, "tooltip": f"Custom width (manual mode only, max {MAX_DIMENSION}) | 自定义宽度（仅手动模式，上限 {MAX_DIMENSION}）"}),
                "Custom_Height": ("INT", {"default": DEFAULT_CUSTOM_HEIGHT, "min": MIN_DIMENSION, "max": MAX_DIMENSION, "step": 8, "tooltip": f"Custom height (manual mode only, max {MAX_DIMENSION}) | 自定义高度（仅手动模式，上限 {MAX_DIMENSION}）"}),
                "align_multiple": ("INT", {"default": DEFAULT_ALIGN_MULTIPLE, "min": 1, "max": MAX_ALIGN_MULTIPLE, "step": 1, "advanced": True, "tooltip": "Snap width/height to this grid (default 8 = latent compression) | 宽高对齐粒度（默认 8，即 latent 压缩率）"}),
                "fit_edge":       (["Long", "Short"], {"default": "Long", "advanced": True, "tooltip": "Fit mode only: Long=whole image fits inside the target / Short=short edge fills the target, long edge may exceed | 仅适配模式：Long=整图装进目标框 / Short=短边填满目标，长边可能超出"}),
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
                                Custom_Width, Custom_Height, align_multiple=DEFAULT_ALIGN_MULTIPLE):
        """确定目标像素尺寸（与现有逻辑一致）"""
        if Manual_Mode == "on":
            # 无上限：只保留最小值约束，网格对齐由 _align 完成（四舍五入）。
            w = max(MIN_DIMENSION, int(Custom_Width or MIN_DIMENSION))
            h = max(MIN_DIMENSION, int(Custom_Height or MIN_DIMENSION))
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
        return _align(w, align_multiple), _align(h, align_multiple)

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
        align_multiple: int = DEFAULT_ALIGN_MULTIPLE,
        fit_edge: str = "Long",
        image: Optional[torch.Tensor] = None,
        mask: Optional[torch.Tensor] = None,
        latent: Optional[dict] = None,
        vae = None,
        **kwargs,
    ):
        target_w, target_h = self._determine_target_size(
            Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height, align_multiple)

        has_image = image is not None
        has_latent = latent is not None
        has_vae = vae is not None
        latent_ratio = _latent_spatial_ratio(latent, vae)
        # ⚠ 三条路径（预设 / 自定义 / Scale）统一走同一个网格：lcm(对齐粒度, latent 压缩率)，
        #   **不区分有没有接 latent / VAE**。本节点自己产 latent ⇒ 像素必须能被压缩率整除，
        #   否则 latent 形状只能靠 `//` 截断、与输出的 width/height 对不上。
        #   实测（无 latent/VAE 输入）：align_multiple=3、输入 1023 → 输出 1023×1023，
        #   而空 latent 是 127×127（隐含 1016×1016），差 7px。
        #   无 latent / VAE 时压缩率按 8 计；接了 VAE 会自动取真实值（如 16× 模型）。
        target_w = _align_grid(target_w, align_multiple, latent_ratio)
        target_h = _align_grid(target_h, align_multiple, latent_ratio)

        # ── 计算实际处理尺寸（等比缩放 vs 中心裁剪）──
        if scale_method == "Scale":
            if has_image:
                _, h1, w1, _ = image.shape
                actual_w = _align_grid(w1 * scale_multiplier, align_multiple, latent_ratio)
                actual_h = _align_grid(h1 * scale_multiplier, align_multiple, latent_ratio)
            elif has_latent:
                _, _, lh, lw = latent["samples"].shape
                actual_w = _align_grid(lw * latent_ratio * scale_multiplier, align_multiple, latent_ratio)
                actual_h = _align_grid(lh * latent_ratio * scale_multiplier, align_multiple, latent_ratio)
            else:
                actual_w, actual_h = target_w, target_h
        elif scale_method == "Fit" and (has_image or has_latent):
            # ── 等比适配：不变形、不裁剪，按目标框等比缩放 ──
            #   没有 image / latent 就没有基准，退化为 Crop（直接用目标尺寸）。
            if has_image:
                _, h1, w1, _ = image.shape
                src_w, src_h = float(w1), float(h1)
            else:
                _, _, lh, lw = latent["samples"].shape
                src_w, src_h = float(lw * latent_ratio), float(lh * latent_ratio)
            scale_f = _fit_scale(src_w, src_h, target_w, target_h, fit_edge)
            actual_w = _align_grid(src_w * scale_f, align_multiple, latent_ratio)
            actual_h = _align_grid(src_h * scale_f, align_multiple, latent_ratio)
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

            if scale_method in ("Scale", "Fit"):
                # 等比缩放 / 等比适配：直接 interpolate 到目标尺寸（不裁剪）
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

        elif mask is not None:
            # ── 只接了 mask（既无 image 也无 latent）：按目标尺寸缩放遮罩后输出 ──
            #   此前这条路径会掉进下面的 else，用户接的遮罩被静默丢弃。
            #   复用 _resize_spatial_mask（2D / 3D / 4D 通吃，保留原 rank 与 dtype）。
            out_mask = self._resize_spatial_mask(
                mask, actual_w, actual_h, scale_method == "Crop")
            out_latent = {"samples": torch.zeros(
                (1, 4, actual_h // latent_ratio, actual_w // latent_ratio)),
                "downscale_ratio_spacial": latent_ratio}
            logger.debug(
                "SizeSelect mask-only pixel=(%s,%s) mask_shape=%s",
                actual_w, actual_h, getattr(out_mask, "shape", None),
            )
            return (None, out_mask, out_latent, actual_w, actual_h)

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
        # Fit 也是等比缩放（倍率由目标框算出而已），只有 Crop 需要裁剪
        use_crop = scale_method == "Crop"
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
        align_multiple: int = DEFAULT_ALIGN_MULTIPLE,
        **kwargs,
    ):
        if align_multiple is not None:
            try:
                multiple = int(align_multiple)
            except (TypeError, ValueError):
                return "对齐粒度必须是不小于 1 的整数"
            if multiple < 1 or multiple > MAX_ALIGN_MULTIPLE:
                return f"对齐粒度必须在 1-{MAX_ALIGN_MULTIPLE} 之间"
        if Manual_Mode == "on":
            try:
                custom_width = int(Custom_Width)
                custom_height = int(Custom_Height)
            except (TypeError, ValueError):
                return "自定义宽高必须是整数"
            if custom_width < MIN_DIMENSION or custom_height < MIN_DIMENSION:
                return f"自定义宽高不能小于 {MIN_DIMENSION}"
            # ⚠ 这里**不校验网格倍数**：对齐由 _align_grid 自动完成，硬编码 `% 8` 会与
            #   align_multiple 脱钩——实测 align_multiple=3 时 1023 被拒（本该合法）、
            #   1024 被放行（随后又被对齐成 1023），双向都错。只卡真正越界的值。
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
        align_multiple: int = DEFAULT_ALIGN_MULTIPLE,
        fit_edge: str = "Long",
        **kwargs,
    ) -> tuple[str, str, float, Optional[str], Optional[str], int, int, int, str]:
        return (Manual_Mode, scale_method, scale_multiplier, Resolution, Aspect_Ratio,
                Custom_Width, Custom_Height, align_multiple, fit_edge)


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
                    _io.Combo.Input("scale_method", options=["Crop", "Fit", "Scale"],
                                    default="Crop",
                                    tooltip="Crop=center crop to target ratio / Fit=uniform fit inside the target / Scale=uniform scale by multiplier | Crop=中心裁剪到目标比例 / Fit=等比适配到目标框内 / Scale=按倍数等比缩放"),
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
                                  tooltip=f"Custom width (manual mode only, max {MAX_DIMENSION}) | 自定义宽度（仅手动模式，上限 {MAX_DIMENSION}）"),
                    _io.Int.Input("Custom_Height", default=DEFAULT_CUSTOM_HEIGHT,
                                  min=MIN_DIMENSION, max=MAX_DIMENSION, step=8,
                                  optional=True,
                                  tooltip=f"Custom height (manual mode only, max {MAX_DIMENSION}) | 自定义高度（仅手动模式，上限 {MAX_DIMENSION}）"),
                    _io.Int.Input("align_multiple", default=DEFAULT_ALIGN_MULTIPLE,
                                  min=1, max=MAX_ALIGN_MULTIPLE, step=1, optional=True, advanced=True,
                                  tooltip="Snap width/height to this grid (default 8 = latent compression) | 宽高对齐粒度（默认 8，即 latent 压缩率）"),
                    _io.Combo.Input("fit_edge", options=["Long", "Short"], default="Long",
                                    optional=True, advanced=True,
                                    tooltip="Fit mode only: Long=whole image fits inside the target / Short=short edge fills the target, long edge may exceed | 仅适配模式：Long=整图装进目标框 / Short=短边填满目标，长边可能超出"),
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
                            Aspect_Ratio=None, Custom_Width=256, Custom_Height=2048,
                            align_multiple=DEFAULT_ALIGN_MULTIPLE):
            return WOSAI_SizeSelect.VALIDATE_INPUTS(
                Manual_Mode, Resolution, Aspect_Ratio, Custom_Width, Custom_Height, align_multiple)

        @classmethod
        def fingerprint_inputs(cls, Manual_Mode: str = "off", scale_method: str = "Crop",
                               scale_multiplier: float = 1.0, Resolution: Optional[str] = None,
                               Aspect_Ratio: Optional[str] = None, Custom_Width: int = 256,
                               Custom_Height: int = 2048,
                               align_multiple: int = DEFAULT_ALIGN_MULTIPLE,
                               fit_edge: str = "Long") -> tuple:
            return (Manual_Mode, scale_method, scale_multiplier, Resolution, Aspect_Ratio,
                    Custom_Width, Custom_Height, align_multiple, fit_edge)

        @classmethod
        def execute(cls, Manual_Mode: str = "off", scale_method: str = "Crop",
                    scale_multiplier: float = 1.0, Resolution: Optional[str] = None,
                    Aspect_Ratio: Optional[str] = None, Custom_Width: int = 256, Custom_Height: int = 2048,
                    align_multiple: int = DEFAULT_ALIGN_MULTIPLE, fit_edge: str = "Long",
                    image: Optional[torch.Tensor] = None, mask: Optional[torch.Tensor] = None,
                    latent: Optional[dict] = None, vae: Optional[object] = None) -> _io.NodeOutput:
            result = WOSAI_SizeSelect().calculate_size(
                Manual_Mode, scale_method, scale_multiplier,
                Resolution, Aspect_Ratio, Custom_Width, Custom_Height,
                align_multiple=align_multiple, fit_edge=fit_edge,
                image=image, mask=mask, latent=latent, vae=vae)
            return _io.NodeOutput(*result)
except ImportError:
    pass  # V1-only 环境（旧版 ComfyUI）
else:
    # Nodes 2.0 可用时使用同一节点 ID 的 V3 Schema；旧版环境保留上方 V1 映射。
    NODE_CLASS_MAPPINGS["WOSAI_SizeSelect"] = WOSAI_SizeSelect_V3
