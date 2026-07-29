"""Behavior tests for the P0-P2 migrated WOSAI nodes."""

from __future__ import annotations

import json
import unittest

from nodes.route_switch import WOSAI_LazyFallback, WOSAI_NumberSwitch
from nodes.omni_slider import WOSAI_OmniSlider
from nodes.selector import (
    DEFAULT_LABELS,
    DEFAULT_SETTINGS_JSON,
    MAX_COLUMNS,
    MAX_LABELS,
    WOSAI_BooleanSelector,
    WOSAI_Selector,
    normalize_labels,
)

try:
    import torch
except ModuleNotFoundError:
    torch = None

if torch is not None:
    from nodes.media_tools import (
        WOSAI_FirstLastFrame,
        _parse_annotation,
        _points_ui_payload,
    )


class SelectorTests(unittest.TestCase):
    def test_normalize_labels_is_bounded_and_recovers_invalid_json(self):
        self.assertEqual(normalize_labels("invalid"), DEFAULT_LABELS)
        labels = normalize_labels(json.dumps([f"item {index}" for index in range(30)]))
        self.assertEqual(len(labels), MAX_LABELS)
        self.assertEqual(DEFAULT_LABELS, [str(index) for index in range(10)])

    def test_selector_limits_columns_and_zero_based_indices(self):
        selector_inputs = WOSAI_Selector.INPUT_TYPES()["required"]
        self.assertEqual(selector_inputs["selected_index"][1]["max"], MAX_LABELS - 1)
        self.assertEqual(selector_inputs["columns"][1]["max"], MAX_COLUMNS)
        self.assertEqual(selector_inputs["columns"][1]["default"], MAX_COLUMNS)
        self.assertEqual(
            WOSAI_Selector.VALIDATE_INPUTS(0, json.dumps(["0", "1"]), 6),
            "columns must be between 1 and 5",
        )

    def test_selector_returns_a_valid_index(self):
        node = WOSAI_Selector()
        self.assertEqual(node.select(8, json.dumps(["A", "B"]), 2), (1,))
        self.assertEqual(
            node.VALIDATE_INPUTS(8, json.dumps(["A", "B"]), 2),
            "selected_index must be between 0 and 1",
        )

    def test_selector_appearance_settings_are_workflow_serializable(self):
        selector_inputs = WOSAI_Selector.INPUT_TYPES()["required"]
        boolean_inputs = WOSAI_BooleanSelector.INPUT_TYPES()["required"]
        self.assertEqual(
            selector_inputs["settings_json"][1]["default"],
            DEFAULT_SETTINGS_JSON,
        )
        self.assertEqual(
            boolean_inputs["settings_json"][1]["default"],
            DEFAULT_SETTINGS_JSON,
        )
        self.assertEqual(
            WOSAI_Selector().select(0, json.dumps(["A"]), 1, '{"mode":"custom"}'),
            (0,),
        )
        self.assertEqual(
            WOSAI_BooleanSelector().select(True, '{"falseLabel":"No"}'),
            (True,),
        )

    def test_boolean_selector_keeps_boolean_type(self):
        node = WOSAI_BooleanSelector()
        self.assertEqual(node.select(True), (True,))
        self.assertEqual(node.select(0), (False,))


class RouteSwitchTests(unittest.TestCase):
    def test_number_switch_uses_selected_generic_input(self):
        node = WOSAI_NumberSwitch()
        self.assertEqual(node.switch(1, value0="A", value1="B"), ("B",))
        with self.assertRaises(ValueError):
            node.switch(100, value0="A")

    def test_lazy_fallback_requests_only_missing_fallback(self):
        node = WOSAI_LazyFallback()
        self.assertEqual(node.check_lazy_status(primary="value"), None)
        self.assertEqual(node.check_lazy_status(primary=None, fallback=None), ["fallback"])
        self.assertEqual(node.resolve(primary=0, fallback=9), (0,))
        self.assertEqual(node.resolve(primary=None, fallback=9), (9,))


class OmniSliderTests(unittest.TestCase):
    def test_output_socket_accepts_dynamic_integer_or_float_values(self):
        self.assertEqual(str(WOSAI_OmniSlider.RETURN_TYPES[0]), "*")
        node = WOSAI_OmniSlider()
        integer = node.execute(ch1_cfg=json.dumps({"type": "INT", "value": 4.7}))[0]
        floating = node.execute(ch1_cfg=json.dumps({"type": "FLOAT", "value": 4.7}))[0]
        self.assertIsInstance(integer, int)
        self.assertEqual(integer, 5)
        self.assertIsInstance(floating, float)
        self.assertEqual(floating, 4.7)


@unittest.skipIf(torch is None, "PyTorch is provided by the ComfyUI runtime")
class MediaToolTests(unittest.TestCase):
    def test_annotation_parser_clamps_normalized_coordinates(self):
        value = _parse_annotation(json.dumps({
            "positive": [{"x": -1, "y": 2}],
            "boxes": [{"x": 0.1, "y": 0.2, "w": 4, "h": -1}],
        }))
        self.assertEqual(value["positive"], [{"x": 0.0, "y": 1.0}])
        self.assertEqual(value["boxes"][0]["w"], 1.0)
        self.assertEqual(value["boxes"][0]["h"], 0.0)

    def test_first_last_frame_preserves_device_and_dtype(self):
        image = torch.arange(3 * 2 * 2, dtype=torch.float32).reshape(3, 2, 2, 1)
        first, last = WOSAI_FirstLastFrame().extract(image)
        self.assertTrue(torch.equal(first, image[:1]))
        self.assertTrue(torch.equal(last, image[-1:]))
        self.assertEqual(first.dtype, image.dtype)

    def test_points_editor_uses_custom_preview_channel(self):
        saved_images = [{
            "filename": "preview.png",
            "subfolder": "",
            "type": "temp",
        }]
        result = _points_ui_payload({"ui": {"images": saved_images}})
        self.assertNotIn("images", result)
        self.assertEqual(result["wosai_points"], [{"images": saved_images}])
