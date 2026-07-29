"""WOSAI common color presets node.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import MappingProxyType

from wosai_core.config import CATEGORY_PREFIX


_HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
_DATA_FILE = Path(__file__).parent.parent / "web" / "data" / "common-colors.json"


def _load_color_data() -> dict:
    data = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    colors = data.get("colors")
    if not isinstance(colors, list) or not colors:
        raise ValueError("common-colors.json must contain a non-empty colors list")
    names = set()
    for item in colors:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("name"), str)
            or item["name"] in names
            or not _HEX_COLOR_PATTERN.fullmatch(str(item.get("hex", "")))
        ):
            raise ValueError("common-colors.json contains an invalid or duplicate color")
        names.add(item["name"])
    return data


_COLOR_DATA = _load_color_data()
DEFAULT_CUSTOM_COLOR = _COLOR_DATA["default_custom_color"]
CUSTOM_COLOR_OPTION = _COLOR_DATA["custom"]["zh"]
# WOSAI brand and semantic colours appear first, followed by the source palette.
COLOR_PRESETS = MappingProxyType({
    item["name"]: item["hex"].upper() for item in _COLOR_DATA["colors"]
})
# Put the custom picker first so a newly-created node opens on its most
# flexible choice, while keeping the remaining source palette order intact.
COLOR_OPTIONS = (CUSTOM_COLOR_OPTION,) + tuple(COLOR_PRESETS)
DEFAULT_PRESET_COLOR = next(iter(COLOR_PRESETS.values()))


def normalize_hex_color(value: object) -> str | None:
    """Return a canonical ``#RRGGBB`` value, or ``None`` for invalid input."""
    if not isinstance(value, str):
        return None
    color = value.strip()
    if not color.startswith("#"):
        color = f"#{color}"
    if len(color) == 4 and all(character in "0123456789abcdefABCDEF" for character in color[1:]):
        color = "#" + "".join(character * 2 for character in color[1:])
    if not _HEX_COLOR_PATTERN.fullmatch(color):
        return None
    return color.upper()


class WOSAI_CommonColor:
    """Select a common preset colour or supply a custom hexadecimal colour."""

    CATEGORY = f"{CATEGORY_PREFIX}工具"
    DESCRIPTION = "Select a common colour preset and output an integer colour value plus #RRGGBB HEX text"
    RETURN_TYPES = ("INT", "STRING")
    RETURN_NAMES = ("color", "hex")
    FUNCTION = "select_color"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "color_name": ("WOSAI_COLOR_PRESET", {"default": COLOR_OPTIONS[0]}),
            },
            "optional": {
                # Use a WOSAI-specific frontend widget instead of COLORCODE.
                # Some third-party extensions globally replace COLORCODE and
                # render an unlocalised field name with broken left padding.
                "custom_color": ("WOSAI_COLOR_PREVIEW", {"default": DEFAULT_CUSTOM_COLOR}),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(
        cls,
        color_name: str = COLOR_OPTIONS[0],
        custom_color: str = DEFAULT_CUSTOM_COLOR,
    ):
        if color_name not in COLOR_OPTIONS:
            return "color_name must be a supplied preset or 自定义"
        if color_name == CUSTOM_COLOR_OPTION and normalize_hex_color(custom_color) is None:
            return "custom_color must be a hexadecimal colour such as #RRGGBB or #RGB"
        return True

    @classmethod
    def IS_CHANGED(
        cls,
        color_name: str = COLOR_OPTIONS[0],
        custom_color: str = DEFAULT_CUSTOM_COLOR,
    ):
        if color_name == CUSTOM_COLOR_OPTION:
            return color_name, normalize_hex_color(custom_color)
        return color_name

    def select_color(
        self,
        color_name: str = COLOR_OPTIONS[0],
        custom_color: str = DEFAULT_CUSTOM_COLOR,
    ):
        if color_name == CUSTOM_COLOR_OPTION:
            color = normalize_hex_color(custom_color)
            if color is None:
                raise ValueError("custom_color must be a hexadecimal colour such as #RRGGBB or #RGB")
        else:
            color = COLOR_PRESETS.get(color_name, DEFAULT_PRESET_COLOR)
        return (int(color[1:], 16), color)


NODE_CLASS_MAPPINGS = {"WOSAI_CommonColor": WOSAI_CommonColor}
NODE_DISPLAY_NAME_MAPPINGS = {"WOSAI_CommonColor": "Common Color"}
