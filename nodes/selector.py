"""Compact WOSAI selector nodes.

The Python side owns stable workflow fields.  The richer button UI is added by
``web/selector.js`` without changing the serialized input names.
"""

from __future__ import annotations

import json

from wosai_core.config import CATEGORY_PREFIX


MAX_LABELS = 10
MAX_COLUMNS = 5
DEFAULT_LABELS = [str(index) for index in range(MAX_LABELS)]
DEFAULT_SETTINGS_JSON = "{}"


def normalize_labels(raw: str) -> list[str]:
    """Return a bounded, non-empty list of selector labels."""
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        value = DEFAULT_LABELS
    if not isinstance(value, list):
        value = DEFAULT_LABELS
    labels = [str(item).strip()[:48] for item in value if str(item).strip()]
    return labels[:MAX_LABELS] or DEFAULT_LABELS.copy()


class WOSAI_Selector:
    CATEGORY = f"{CATEGORY_PREFIX}Logic"
    DESCRIPTION = "Choose a labelled option and output its zero-based index"
    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("index",)
    FUNCTION = "select"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selected_index": (
                    "INT",
                    {"default": 0, "min": 0, "max": MAX_LABELS - 1, "step": 1},
                ),
                "labels_json": (
                    "STRING",
                    {
                        "default": json.dumps(DEFAULT_LABELS, ensure_ascii=False),
                        "multiline": False,
                    },
                ),
                "columns": (
                    "INT",
                    {
                        "default": MAX_COLUMNS,
                        "min": 1,
                        "max": MAX_COLUMNS,
                        "step": 1,
                    },
                ),
                "settings_json": (
                    "STRING",
                    {"default": DEFAULT_SETTINGS_JSON, "multiline": False},
                ),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(
        cls,
        selected_index=0,
        labels_json="",
        columns=MAX_COLUMNS,
        settings_json=DEFAULT_SETTINGS_JSON,
    ):
        labels = normalize_labels(labels_json)
        if not 1 <= int(columns) <= MAX_COLUMNS:
            return f"columns must be between 1 and {MAX_COLUMNS}"
        if not 0 <= int(selected_index) < len(labels):
            return f"selected_index must be between 0 and {len(labels) - 1}"
        return True

    @classmethod
    def IS_CHANGED(
        cls,
        selected_index=0,
        labels_json="",
        columns=MAX_COLUMNS,
        settings_json=DEFAULT_SETTINGS_JSON,
    ):
        return int(selected_index), str(labels_json), int(columns)

    def select(
        self,
        selected_index=0,
        labels_json="",
        columns=MAX_COLUMNS,
        settings_json=DEFAULT_SETTINGS_JSON,
    ):
        labels = normalize_labels(labels_json)
        index = max(0, min(int(selected_index), len(labels) - 1))
        return (index,)


class WOSAI_BooleanSelector:
    CATEGORY = f"{CATEGORY_PREFIX}Logic"
    DESCRIPTION = "Choose False or True with a compact two-button control"
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("value",)
    FUNCTION = "select"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("BOOLEAN", {"default": False}),
                "settings_json": (
                    "STRING",
                    {"default": DEFAULT_SETTINGS_JSON, "multiline": False},
                ),
            }
        }

    @classmethod
    def IS_CHANGED(cls, value=False, settings_json=DEFAULT_SETTINGS_JSON):
        return bool(value)

    def select(self, value=False, settings_json=DEFAULT_SETTINGS_JSON):
        return (bool(value),)


NODE_CLASS_MAPPINGS = {
    "WOSAI_Selector": WOSAI_Selector,
    "WOSAI_BooleanSelector": WOSAI_BooleanSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_Selector": "Selector",
    "WOSAI_BooleanSelector": "Boolean Selector",
}
