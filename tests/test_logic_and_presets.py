"""Core behavior tests for LogicSwitch and PresetPromptSelector nodes."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

try:
    import torch
except ModuleNotFoundError:
    torch = None

from nodes.logic_switch import WOSAI_LogicSwitch
from nodes.preset_prompt import DEFAULT_PRESETS, WOSAI_PresetPromptSelector, _normalize_presets
if torch is not None:
    from nodes.size_select import MIN_DIMENSION, WOSAI_SizeSelect, _align, _align_grid, _fit_scale


class LogicSwitchTests(unittest.TestCase):
    def setUp(self):
        self.node = WOSAI_LogicSwitch()

    def test_condition_selects_the_matching_input(self):
        self.assertEqual(self.node.switch(condition=True, true_input="yes", false_input="no"), ("yes",))
        self.assertEqual(self.node.switch(condition=False, true_input="yes", false_input="no"), ("no",))

    def test_missing_condition_uses_default_input(self):
        self.assertEqual(self.node.switch(Default_Input=True, true_input="yes", false_input="no"), ("yes",))
        self.assertEqual(self.node.switch(Default_Input=False, true_input="yes", false_input="no"), ("no",))

    def test_missing_selected_branch_returns_none(self):
        self.assertEqual(self.node.switch(condition=True, false_input="fallback"), ("fallback",))
        self.assertEqual(self.node.switch(condition=False, true_input="unused"), (None,))


class PresetPromptSelectorTests(unittest.TestCase):
    def setUp(self):
        self.node = WOSAI_PresetPromptSelector()

    def test_invalid_preset_payload_falls_back_to_defaults(self):
        self.assertEqual(_normalize_presets("not json"), DEFAULT_PRESETS)
        self.assertEqual(_normalize_presets(json.dumps({"not": "a list"})), DEFAULT_PRESETS)

    def test_single_output_uses_editor_text(self):
        self.assertEqual(
            self.node.select_preset(0, prompt_cn="中文", prompt_en="English"),
            ("中文", "English"),
        )

    def test_empty_native_prompts_fall_back_to_active_preset(self):
        payload = json.dumps([
            {"label": "one", "prompt_cn": "甲", "prompt_en": "A"},
            {"label": "two", "prompt_cn": "乙", "prompt_en": "B"},
        ])
        self.assertEqual(self.node.select_preset(1, payload, prompt_cn="", prompt_en=""), ("乙", "B"))

    def test_catalog_defaults_provide_at_least_nine_presets_per_category(self):
        required = self.node.INPUT_TYPES()["required"]
        presets = json.loads(required["presets_data"][1]["default"])
        categories = {item["category"] for item in presets}
        self.assertGreater(len(categories), 1)
        for category in categories:
            self.assertGreaterEqual(sum(item["category"] == category for item in presets), 9)

    def test_catalog_json_is_the_default_source_and_has_i18n_ids(self):
        catalog_path = Path(__file__).resolve().parents[1] / "presets" / "preset_prompt_catalog.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        presets = catalog["presets"]
        required = self.node.INPUT_TYPES()["required"]
        categories = []
        expected = []
        for preset in presets:
            if preset["category"] not in categories:
                if len(categories) >= 6:
                    continue
                categories.append(preset["category"])
            expected.append(preset)
        self.assertEqual(json.loads(required["presets_data"][1]["default"]), expected)
        self.assertTrue(all(item.get("category_i18n") and item.get("label_i18n") for item in presets))
        self.assertNotIn("batch_output", required)

    def test_legacy_batch_output_is_ignored(self):
        payload = json.dumps([
            {"label": "one", "prompt_cn": "甲", "prompt_en": "A"},
            {"label": "two", "prompt_cn": "乙", "prompt_en": "B"},
        ])

        self.assertEqual(
            self.node.select_preset(0, payload, prompt_cn="当前中文", prompt_en="Current English", batch_output=True),
            ("当前中文", "Current English"),
        )

    def test_thumbnail_metadata_survives_preset_normalization(self):
        presets = _normalize_presets(json.dumps([{
            "label": "粘土风格",
            "thumbnail": "assets/presets/clay-style.webp",
            "prompt_cn": "粘土风格",
            "prompt_en": "clay style",
        }]))
        self.assertEqual(presets[0]["thumbnail"], "assets/presets/clay-style.webp")


@unittest.skipIf(torch is None, "PyTorch is provided by the ComfyUI runtime, not this test interpreter")
class SizeSelectTensorResizeTests(unittest.TestCase):
    def setUp(self):
        self.node = WOSAI_SizeSelect()

    def test_center_crop_keeps_the_middle_of_a_wide_tensor(self):
        image = torch.arange(1 * 3 * 4 * 8, dtype=torch.float32).reshape(1, 3, 4, 8)

        cropped = self.node._center_crop_tensor(image, 4, 4)

        self.assertTrue(torch.equal(cropped, image[:, :, :, 2:6]))

    def test_resize_keeps_batch_device_dtype_and_mask_semantics(self):
        image = torch.rand((2, 6, 10, 3), dtype=torch.float32)
        mask = torch.rand((2, 6, 10), dtype=torch.float32)

        out_image, out_mask = self.node._resize_image_and_mask(image, mask, 8, 8, "Crop")

        self.assertEqual(tuple(out_image.shape), (2, 8, 8, 3))
        self.assertEqual(tuple(out_mask.shape), (2, 8, 8))
        self.assertEqual(out_image.device, image.device)
        self.assertEqual(out_image.dtype, image.dtype)
        self.assertEqual(out_mask.dtype, image.dtype)

    def test_resize_creates_an_opaque_mask_when_none_is_given(self):
        image = torch.rand((1, 4, 4, 3), dtype=torch.float32)

        _, out_mask = self.node._resize_image_and_mask(image, None, 8, 8, "Scale")

        self.assertTrue(torch.equal(out_mask, torch.ones((1, 8, 8), dtype=image.dtype)))

    def test_resize_moves_and_broadcasts_mask_to_image_tensor_traits(self):
        image = torch.rand((2, 4, 4, 3), dtype=torch.float64)
        mask = torch.rand((1, 4, 4), dtype=torch.float32)

        _, out_mask = self.node._resize_image_and_mask(image, mask, 8, 8, "Scale")

        self.assertEqual(tuple(out_mask.shape), (2, 8, 8))
        self.assertEqual(out_mask.device, image.device)
        self.assertEqual(out_mask.dtype, image.dtype)
        self.assertTrue(torch.equal(out_mask[0], out_mask[1]))

    def test_latent_resize_preserves_metadata_dtype_and_non_sd_ratio(self):
        samples = torch.rand((2, 8, 4, 6), dtype=torch.float16)
        noise_mask = torch.rand((1, 1, 64, 96), dtype=torch.float16)
        batch_index = [12, 13]
        latent = {
            "samples": samples,
            "noise_mask": noise_mask,
            "batch_index": batch_index,
            "downscale_ratio_spacial": 16,
            "custom_metadata": {"keep": True},
        }

        _, _, output, width, height = self.node.calculate_size(
            scale_method="Scale",
            scale_multiplier=0.5,
            latent=latent,
        )

        self.assertEqual((width, height), (48, 32))
        self.assertEqual(tuple(output["samples"].shape), (2, 8, 2, 3))
        self.assertEqual(output["samples"].dtype, samples.dtype)
        self.assertEqual(tuple(output["noise_mask"].shape), (1, 1, 32, 48))
        self.assertEqual(output["batch_index"], batch_index)
        self.assertEqual(output["custom_metadata"], {"keep": True})
        self.assertEqual(output["downscale_ratio_spacial"], 16)

    def test_image_placeholder_latent_inherits_dtype_and_device(self):
        image = torch.rand((1, 256, 256, 3), dtype=torch.float16)

        _, _, output, _, _ = self.node.calculate_size(
            Manual_Mode="on",
            scale_method="Scale",
            scale_multiplier=1.0,
            Custom_Width=256,
            Custom_Height=256,
            image=image,
        )

        self.assertEqual(output["samples"].dtype, image.dtype)
        self.assertEqual(output["samples"].device, image.device)

    def test_vae_encode_uses_reported_16x_spatial_compression(self):
        class FluxStyleVAE:
            @staticmethod
            def spacial_compression_encode():
                return 16

            @staticmethod
            def encode(image):
                batch, height, width, _ = image.shape
                return image.new_zeros((batch, 16, height // 16, width // 16))

        image = torch.rand((1, 130, 194, 3), dtype=torch.float32)

        _, _, output, width, height = self.node.calculate_size(
            scale_method="Scale",
            scale_multiplier=1.0,
            image=image,
            vae=FluxStyleVAE(),
        )

        self.assertEqual((width, height), (192, 128))
        self.assertEqual(tuple(output["samples"].shape), (1, 16, 8, 12))
        self.assertEqual(output["downscale_ratio_spacial"], 16)


@unittest.skipIf(torch is None, "PyTorch is provided by the ComfyUI runtime, not this test interpreter")
class SizeSelectManualModeLimitTests(unittest.TestCase):
    """自定义（手动）模式不设上限：只保留最小值约束与 8px 网格对齐。"""

    def setUp(self):
        self.node = WOSAI_SizeSelect()

    def test_manual_mode_accepts_dimensions_above_the_removed_cap(self):
        self.assertEqual(self.node._determine_target_size("on", None, None, 4096, 8192), (4096, 8192))

    def test_manual_mode_still_applies_the_minimum_and_the_8px_grid(self):
        # 8 → 抬到最小值；4100 → 向下对齐到 4096
        self.assertEqual(
            self.node._determine_target_size("on", None, None, 8, 4100),
            (MIN_DIMENSION, 4096),
        )

    def test_validation_accepts_large_custom_sizes(self):
        self.assertIs(WOSAI_SizeSelect.VALIDATE_INPUTS("on", None, None, 8192, 8192), True)

    def test_validation_still_rejects_below_minimum_but_no_longer_off_grid(self):
        # 最小值仍然要卡；但**网格倍数不该由校验来管**——对齐由 _align_grid 自动完成，
        # 硬编码 `% 8` 与 align_multiple 脱钩：实测 align_multiple=3 时 1023 被拒（本该合法）、
        # 1024 被放行（随后又被对齐成 1023），双向都错。
        self.assertIsInstance(WOSAI_SizeSelect.VALIDATE_INPUTS("on", None, None, 128, 2048), str)
        self.assertIs(WOSAI_SizeSelect.VALIDATE_INPUTS("on", None, None, 4097, 2048), True)
        self.assertIs(WOSAI_SizeSelect.VALIDATE_INPUTS("on", None, None, 1023, 1023, 3), True)

    def test_validation_rejects_a_bogus_align_multiple(self):
        self.assertIs(WOSAI_SizeSelect.VALIDATE_INPUTS("on", None, None, 1024, 1024, 8), True)
        self.assertIsInstance(WOSAI_SizeSelect.VALIDATE_INPUTS("on", None, None, 1024, 1024, 0), str)
        # 上限与 UI 声明的 max 同口径（此前用的是 MAX_DIMENSION=16384，与 UI 的 128 不符）
        self.assertIsInstance(WOSAI_SizeSelect.VALIDATE_INPUTS("on", None, None, 1024, 1024, 129), str)


@unittest.skipIf(torch is None, "PyTorch is provided by the ComfyUI runtime, not this test interpreter")
class SizeSelectLatentConsistencyTests(unittest.TestCase):
    """本节点自己产 latent ⇒ 输出的 width/height 必须等于 latent 形状 × 压缩率。

    历史上无 latent / VAE 输入时 processing_ratio 按 1 计（只按 align_multiple 对齐），
    而空 latent 用 `// 8` 截断 ⇒ align_multiple 取 1/3/5 时两者对不上（差最多 7px）。
    """

    def setUp(self):
        self.node = WOSAI_SizeSelect()

    def test_empty_latent_matches_the_reported_size_for_every_align_multiple(self):
        for multiple in (1, 3, 5, 8, 16, 64, 128):
            with self.subTest(align_multiple=multiple):
                _, _, out, width, height = self.node.calculate_size(
                    "on", "Crop", 1.0, None, None, 1023, 1023, multiple)
                ratio = out["downscale_ratio_spacial"]
                samples = out["samples"]
                self.assertEqual(samples.shape[-1] * ratio, width)
                self.assertEqual(samples.shape[-2] * ratio, height)

    def test_align_multiple_that_is_not_a_multiple_of_8_still_lands_on_the_latent_grid(self):
        # lcm(3, 8) = 24 ⇒ 1023 落到 1032，仍然能被压缩率 8 整除
        _, _, out, width, height = self.node.calculate_size(
            "on", "Crop", 1.0, None, None, 1023, 1023, 3)
        self.assertEqual(width % 24, 0)
        self.assertEqual(height % 24, 0)
        self.assertEqual(out["samples"].shape[-1] * 8, width)


@unittest.skipIf(torch is None, "PyTorch is provided by the ComfyUI runtime, not this test interpreter")
class SizeSelectFitModeTests(unittest.TestCase):
    """Fit 模式：等比适配目标框——不变形、不裁剪（与 Crop / Scale 并列的第三种）。"""

    def setUp(self):
        self.node = WOSAI_SizeSelect()

    def test_long_edge_fits_inside_the_box_while_short_edge_may_exceed(self):
        # 横图 1000×500 装进竖框 500×1000
        self.assertAlmostEqual(_fit_scale(1000, 500, 500, 1000, "Long"), 0.5)   # → 500×250
        self.assertAlmostEqual(_fit_scale(1000, 500, 500, 1000, "Short"), 1.0)  # → 1000×500（长边超出）

    def test_fit_keeps_the_source_aspect_and_stays_inside_the_target(self):
        # 300×400（3:4）装进 FHD 16:9 的 1920×1080 ⇒ scale=2.7 → 810×1080 → 对齐 808×1080
        image = torch.rand((1, 400, 300, 3))
        out, _, _, width, height = self.node.calculate_size(
            "off", "Fit", 1.0, "FHD 1080P", "16:9 Widescreen", fit_edge="Long", image=image)
        self.assertLessEqual(width, 1920)
        self.assertLessEqual(height, 1080)
        self.assertAlmostEqual(width / height, 300 / 400, delta=0.02)  # 比例不变
        self.assertEqual(tuple(out.shape), (1, height, width, 3))      # 未裁剪，整图都在

    def test_fit_also_works_on_a_latent_input(self):
        latent = {"samples": torch.rand((1, 4, 64, 48)), "downscale_ratio_spacial": 8}  # 384×512
        _, _, out, width, height = self.node.calculate_size(
            "off", "Fit", 1.0, "FHD 1080P", "16:9 Widescreen", latent=latent)
        self.assertEqual(tuple(out["samples"].shape), (1, 4, height // 8, width // 8))
        self.assertLessEqual(height, 1080)

    def test_fit_without_any_source_falls_back_to_the_target_size(self):
        _, _, _, width, height = self.node.calculate_size(
            "off", "Fit", 1.0, "FHD 1080P", "16:9 Widescreen")
        self.assertEqual((width, height), (1920, 1080))


@unittest.skipIf(torch is None, "PyTorch is provided by the ComfyUI runtime, not this test interpreter")
class SizeSelectMaskOnlyTests(unittest.TestCase):
    """只接 mask（无 image / latent）时遮罩不能被静默丢弃。"""

    def setUp(self):
        self.node = WOSAI_SizeSelect()

    def test_a_lone_mask_is_resized_and_returned(self):
        mask = torch.ones((1, 512, 512))
        image, out_mask, _, width, height = self.node.calculate_size(
            "on", "Crop", 1.0, None, None, 1024, 768, mask=mask)
        self.assertIsNone(image)
        self.assertIsNotNone(out_mask, "只接 mask 时遮罩不应被丢弃")
        self.assertEqual(tuple(out_mask.shape), (1, height, width))

    def test_a_2d_mask_keeps_its_rank(self):
        mask = torch.ones((300, 400))
        _, out_mask, _, width, height = self.node.calculate_size(
            "on", "Crop", 1.0, None, None, 1024, 768, mask=mask)
        self.assertEqual(out_mask.ndim, 2)
        self.assertEqual(tuple(out_mask.shape), (height, width))


@unittest.skipIf(torch is None, "PyTorch is provided by the ComfyUI runtime, not this test interpreter")
class SizeSelectAlignGridTests(unittest.TestCase):
    """对齐粒度：口径统一为「四舍五入到 lcm(网格粒度, latent 压缩率)」"""

    def setUp(self):
        self.node = WOSAI_SizeSelect()

    def test_align_rounds_to_the_nearest_step_instead_of_flooring(self):
        # 向下取整会系统性偏小：1023 → 1016；四舍五入 → 1024
        self.assertEqual(_align(1023, 8), 1024)
        self.assertEqual(_align(1021, 8), 1024)
        # 1019/8 = 127.375 → 127 → 1016（.5 取偶：与前端 roundHalfToEven 同源）
        self.assertEqual(_align(1019, 8), 1016)
        self.assertEqual(_align(1024, 8), 1024)
        self.assertEqual(_align(4, 8), 8)

    def test_align_grid_also_satisfies_the_latent_compression_ratio(self):
        # 压缩率 16 时像素必须能被 16 整除：1033 落到 1040，
        # 否则 latent 形状要靠整除截断，与输出的 width/height 对不上
        self.assertEqual(_align_grid(1033, 8, 16), 1040)
        self.assertEqual(_align_grid(1024, 8, 16), 1024)
        self.assertEqual(_align_grid(1023, 16, 1), 1024)

    def test_manual_mode_honours_a_custom_align_multiple(self):
        self.assertEqual(
            self.node._determine_target_size("on", None, None, 1023, 1023, 16),
            (1024, 1024),
        )

    def test_latent_output_stays_divisible_by_the_compression_ratio(self):
        latent = {"samples": torch.rand((1, 4, 8, 8)), "downscale_ratio_spacial": 16}
        _, _, out, width, height = self.node.calculate_size(
            "on", "Crop", 1.0, None, None, 1000, 1000, latent=latent)
        self.assertEqual(width % 16, 0)
        self.assertEqual(height % 16, 0)
        self.assertEqual(width // 16, out["samples"].shape[3])
        self.assertEqual(height // 16, out["samples"].shape[2])
