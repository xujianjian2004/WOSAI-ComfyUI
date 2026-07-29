"""Behaviour tests for the WOSAI common colour node."""

from __future__ import annotations

import unittest

from nodes.common_color import (
    COLOR_OPTIONS,
    COLOR_PRESETS,
    CUSTOM_COLOR_OPTION,
    DEFAULT_CUSTOM_COLOR,
    WOSAI_CommonColor,
    normalize_hex_color,
)


class CommonColorTests(unittest.TestCase):
    def setUp(self):
        self.node = WOSAI_CommonColor()

    def test_wosai_and_source_palettes_are_available_in_order(self):
        self.assertEqual(COLOR_OPTIONS[0], CUSTOM_COLOR_OPTION)
        self.assertEqual(COLOR_OPTIONS[1], "品牌橙")
        self.assertEqual(COLOR_PRESETS["品牌橙"], "#DD6F4A")
        self.assertEqual(COLOR_OPTIONS[12], "白")
        self.assertEqual(COLOR_PRESETS["海马体蓝"], "#095498")
        self.assertEqual(self.node.select_color("落日黄"), (0xF4A460, "#F4A460"))

    def test_custom_colour_uses_the_scoped_wosai_preview_widget(self):
        preset_input = WOSAI_CommonColor.INPUT_TYPES()["required"]["color_name"]
        custom_input = WOSAI_CommonColor.INPUT_TYPES()["optional"]["custom_color"]
        self.assertEqual(preset_input[0], "WOSAI_COLOR_PRESET")
        self.assertEqual(preset_input[1]["default"], CUSTOM_COLOR_OPTION)
        self.assertEqual(custom_input[0], "WOSAI_COLOR_PREVIEW")
        self.assertEqual(custom_input[1]["default"], DEFAULT_CUSTOM_COLOR)
        self.assertEqual(WOSAI_CommonColor.RETURN_TYPES, ("INT", "STRING"))
        self.assertEqual(WOSAI_CommonColor.RETURN_NAMES, ("color", "hex"))

    def test_custom_colour_normalizes_short_and_lowercase_hex(self):
        self.assertEqual(normalize_hex_color("abc"), "#AABBCC")
        self.assertEqual(self.node.select_color(CUSTOM_COLOR_OPTION, "#a1b2c3"), (0xA1B2C3, "#A1B2C3"))

    def test_invalid_custom_colour_is_rejected(self):
        self.assertIsNone(normalize_hex_color("#xyz"))
        self.assertEqual(
            WOSAI_CommonColor.VALIDATE_INPUTS(CUSTOM_COLOR_OPTION, "#xyz"),
            "custom_color must be a hexadecimal colour such as #RRGGBB or #RGB",
        )
        with self.assertRaises(ValueError):
            self.node.select_color(CUSTOM_COLOR_OPTION, "not-a-colour")

    def test_preset_does_not_depend_on_the_optional_custom_value(self):
        self.assertEqual(self.node.select_color("黑", "#xyz"), (0x000000, "#000000"))
        self.assertEqual(self.node.select_color(), (0x242730, DEFAULT_CUSTOM_COLOR))
        self.assertEqual(DEFAULT_CUSTOM_COLOR, "#242730")
