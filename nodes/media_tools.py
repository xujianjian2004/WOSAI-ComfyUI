"""Visual annotation and lightweight inspection nodes for WOSAI."""

from __future__ import annotations

import json
import os
from typing import Any

import torch

from wosai_core.config import CATEGORY_PREFIX

try:
    from nodes import PreviewImage
except ImportError:  # Unit-test environments without a full ComfyUI runtime.
    PreviewImage = object


def _parse_annotation(raw: str) -> dict[str, Any]:
    empty = {
        "version": 1,
        "frame_index": 0,
        "positive": [],
        "negative": [],
        "boxes": [],
    }
    try:
        value = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return empty
    if not isinstance(value, dict):
        return empty
    result = empty.copy()
    result["frame_index"] = max(0, int(value.get("frame_index", 0) or 0))
    for key in ("positive", "negative"):
        items = value.get(key, [])
        if isinstance(items, list):
            result[key] = [
                {
                    "x": max(0.0, min(1.0, float(item.get("x", 0)))),
                    "y": max(0.0, min(1.0, float(item.get("y", 0)))),
                }
                for item in items[:256]
                if isinstance(item, dict)
            ]
    boxes = value.get("boxes", [])
    if isinstance(boxes, list):
        result["boxes"] = [
            {
                "x": max(0.0, min(1.0, float(item.get("x", 0)))),
                "y": max(0.0, min(1.0, float(item.get("y", 0)))),
                "w": max(0.0, min(1.0, float(item.get("w", 0)))),
                "h": max(0.0, min(1.0, float(item.get("h", 0)))),
            }
            for item in boxes[:128]
            if isinstance(item, dict)
        ]
    return result


def _points_ui_payload(saved: dict[str, Any]) -> dict[str, Any]:
    return {
        "wosai_points": [{
            "images": saved.get("ui", {}).get("images", []),
        }],
    }


class WOSAI_PointsEditor(PreviewImage):
    CATEGORY = f"{CATEGORY_PREFIX}Image"
    DESCRIPTION = "Annotate positive points, negative points, and boxes on an image"
    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("positive_coords", "negative_coords", "bboxes", "frame_index")
    FUNCTION = "annotate"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "annotation_json": ("STRING", {"default": "", "multiline": False}),
                "preview_scale": (
                    "FLOAT",
                    {"default": 0.75, "min": 0.1, "max": 1.0, "step": 0.05},
                ),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, image=None, annotation_json="", preview_scale=0.75, **kwargs):
        if not 0.1 <= float(preview_scale) <= 1.0:
            return "preview_scale must be between 0.1 and 1.0"
        _parse_annotation(annotation_json)
        return True

    def annotate(
        self,
        image,
        annotation_json="",
        preview_scale=0.75,
        prompt=None,
        extra_pnginfo=None,
    ):
        state = _parse_annotation(annotation_json)
        frame_index = min(state["frame_index"], max(0, int(image.shape[0]) - 1))
        height = int(image.shape[1])
        width = int(image.shape[2])

        def absolute_points(items):
            return [
                {
                    "x": int(round(item["x"] * max(0, width - 1))),
                    "y": int(round(item["y"] * max(0, height - 1))),
                }
                for item in items
            ]

        boxes = []
        for item in state["boxes"]:
            x1 = int(round(item["x"] * width))
            y1 = int(round(item["y"] * height))
            x2 = int(round(min(1.0, item["x"] + item["w"]) * width))
            y2 = int(round(min(1.0, item["y"] + item["h"]) * height))
            boxes.append([x1, y1, x2, y2])

        scale = float(preview_scale)
        preview = image
        if scale < 0.999:
            preview = torch.nn.functional.interpolate(
                image.movedim(-1, 1),
                scale_factor=scale,
                mode="bilinear",
                align_corners=False,
            ).movedim(1, -1)

        saved = super().save_images(
            preview,
            filename_prefix="wosai_points",
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )
        return {
            # Use a WOSAI-specific UI channel. ComfyUI treats the reserved
            # "images" channel as a request to draw its native image preview;
            # the point editor already owns the preview surface.
            "ui": _points_ui_payload(saved),
            "result": (
                json.dumps(absolute_points(state["positive"]), ensure_ascii=False),
                json.dumps(absolute_points(state["negative"]), ensure_ascii=False),
                json.dumps(boxes, ensure_ascii=False),
                frame_index,
            ),
        }


class WOSAI_ImageCompare(PreviewImage):
    CATEGORY = f"{CATEGORY_PREFIX}Image"
    DESCRIPTION = "Compare two images with an interactive split view"
    RETURN_TYPES = ()
    FUNCTION = "compare"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "image_a": ("IMAGE",),
                "image_b": ("IMAGE",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    def _save_preview(self, image, prefix, prompt, extra_pnginfo):
        if image is None or int(image.shape[0]) == 0:
            return None
        result = super().save_images(
            image[:1],
            filename_prefix=prefix,
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )
        images = result.get("ui", {}).get("images", [])
        return images[0] if images else None

    def compare(self, image_a=None, image_b=None, prompt=None, extra_pnginfo=None):
        first = self._save_preview(image_a, "wosai_compare_a", prompt, extra_pnginfo)
        second = self._save_preview(image_b, "wosai_compare_b", prompt, extra_pnginfo)
        return {
            "ui": {
                "wosai_compare": [
                    {
                        "a": first,
                        "b": second,
                    }
                ]
            }
        }


class WOSAI_GetWidget:
    CATEGORY = f"{CATEGORY_PREFIX}Tools"
    DESCRIPTION = "Read one or all serialized widget values from a connected node"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("widget_value",)
    FUNCTION = "get_widget"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "target_output": ("*", {}),
                "widget_name": ("STRING", {"default": "", "multiline": False}),
                "include_name": ("BOOLEAN", {"default": True}),
                "include_extension": ("BOOLEAN", {"default": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "dynprompt": "DYNPROMPT",
            },
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    @staticmethod
    def _is_link(value):
        return (
            isinstance(value, list)
            and len(value) >= 2
            and isinstance(value[0], (int, str))
            and isinstance(value[1], int)
        )

    @staticmethod
    def _format(value, include_extension):
        if isinstance(value, (dict, list)):
            text = json.dumps(value, ensure_ascii=False)
        else:
            text = str(value)
        if not include_extension:
            base, extension = os.path.splitext(text)
            if extension.lower() in {
                ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov",
                ".mkv", ".wav", ".mp3", ".json", ".txt", ".safetensors",
                ".ckpt", ".pt", ".pth",
            }:
                text = base
        return text

    def get_widget(
        self,
        unique_id,
        dynprompt,
        target_output=None,
        widget_name="",
        include_name=True,
        include_extension=True,
    ):
        current = dynprompt.get_node(unique_id)
        target_link = current.get("inputs", {}).get("target_output")
        if not self._is_link(target_link):
            raise ValueError("Connect any output of the target node")
        target_id = target_link[0]
        if not dynprompt.has_node(target_id):
            raise KeyError(f"Target node not found: {target_id}")
        inputs = dynprompt.get_node(target_id).get("inputs", {})

        def render(name, value):
            formatted = self._format(value, include_extension)
            return f"{name}: {formatted}" if include_name else formatted

        requested = str(widget_name or "").strip()
        if requested:
            if requested not in inputs:
                available = ", ".join(sorted(inputs))
                raise NameError(f"Widget not found: {requested}. Available: {available}")
            return (render(requested, inputs[requested]),)
        return ("\n".join(render(name, value) for name, value in inputs.items()),)


class WOSAI_FirstLastFrame:
    CATEGORY = f"{CATEGORY_PREFIX}Image"
    DESCRIPTION = "Extract the first and last frame from an image batch"
    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("first_frame", "last_frame")
    FUNCTION = "extract"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",)}}

    def extract(self, image):
        if image is None or int(image.shape[0]) == 0:
            if image is None:
                raise ValueError("image is required")
            empty = image.new_zeros((1, *image.shape[1:]))
            return empty, empty.clone()
        return image[:1], image[-1:]


NODE_CLASS_MAPPINGS = {
    "WOSAI_PointsEditor": WOSAI_PointsEditor,
    "WOSAI_ImageCompare": WOSAI_ImageCompare,
    "WOSAI_GetWidget": WOSAI_GetWidget,
    "WOSAI_FirstLastFrame": WOSAI_FirstLastFrame,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_PointsEditor": "Points Editor",
    "WOSAI_ImageCompare": "Image Compare",
    "WOSAI_GetWidget": "Get Widget",
    "WOSAI_FirstLastFrame": "First / Last Frame",
}
