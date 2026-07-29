"""Core behavior tests for LogicSwitch and PresetPromptSelector nodes."""

from __future__ import annotations

import json
import unittest

try:
    import torch
except ModuleNotFoundError:
    torch = None

from nodes.logic_switch import WOSAI_LogicSwitch
from nodes.preset_prompt import DEFAULT_PRESETS, WOSAI_PresetPromptSelector, _normalize_presets
if torch is not None:
    from nodes.size_select import WOSAI_SizeSelect


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
            (["中文"], ["English"]),
        )

    def test_batch_output_normalizes_every_record(self):
        payload = json.dumps([
            {"label": "one", "prompt_cn": "甲", "prompt_en": "A"},
            {"label": "two", "prompt_cn": "乙", "prompt_en": "B"},
        ])

        self.assertEqual(self.node.select_preset(0, payload, batch_output=True), (["甲", "乙"], ["A", "B"]))


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
