"""WOSAI preset prompt selector node."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from wosai_core.config import CATEGORY_PREFIX


DEFAULT_PRESETS = [
    {
        "label": "泛黄去渍",
        "prompt_cn": "专业老照片修复，去除泛黄、色偏、污渍、霉斑和划痕，校正白平衡，保留原始人物五官、服饰和场景细节，自然真实。",
        "prompt_en": "Old photo restoration, remove yellow tint, fix color cast, balance white. Restore sepia/B&W film look. Clean stains, mold, scratches, aging marks. Reduce haze, boost contrast. Gently restore details, preserve facial features and expression, no oversharpen, keep vintage grain. Clear and layered.",
    },
    {
        "label": "污渍清理",
        "prompt_cn": "精细清理老照片上的污渍、水渍、灰尘和霉斑，保留纸张纹理与人物细节，修复结果干净自然。",
        "prompt_en": "Old photo cleanup, erase graffiti, stains, mold spots, peeling. Reconstruct face, hair, clothes. Fix yellowing, restore true colors. Reduce haze, boost contrast, enhance clarity. Keep skin texture, preserve facial features and expression, no oversharpen. Vintage film style, clear and layered.",
    },
    {
        "label": "折痕修复",
        "prompt_cn": "修复老照片中的折痕、裂纹、压痕与划伤，补全连续纹理和边缘，保持人物比例、表情和背景不变。",
        "prompt_en": "B&W photo repair, remove cracks, deep creases, peeling. Rebuild face, hair, fabric details. Fix contrast, reduce haze, brighten, restore pure grayscale. Gently restore skin texture and features, no oversharpen, protect original expression. Repair damaged edges, clean and clear, keep vintage grain.",
    },
    {
        "label": "反光祛除",
        "prompt_cn": "去除照片表面的反光、高光、玻璃眩光与局部过曝，恢复被遮挡的自然细节和均衡光影。",
        "prompt_en": "Photo restoration, remove glass glare, light reflections, hand shadows. Reveal hidden face, preserve facial features and expression. Fix yellowing, clean damage, restore authentic film texture. Gentle processing, no oversharpen. Crop to photo only, clean edges, high clarity, no artifacts.",
    },
    {
        "label": "残缺补全",
        "prompt_cn": "智能补全老照片缺失、破损和撕裂区域，延续原有纹理、光线和构图，避免改变人物身份与历史信息。",
        "prompt_en": "Photo inpainting, fill missing parts, fix torn edges, heavy damage. Rebuild face, strands of hair, clothing. Balance white, remove yellow tint, restore sepia/B&W film look. Reduce haze, boost contrast. Gently restore skin texture, preserve identity and expression, no oversharpen. Clean, detailed, layered.",
    },
    {
        "label": "黑白上色",
        "prompt_cn": "为黑白老照片自然上色，肤色、服饰、环境和光线符合年代与真实材质，保持清晰细节，不产生夸张饱和度。",
        "prompt_en": "Colorize old B&W photo, keep original face, figure, composition and vintage film grain, do not alter appearance. Natural era-authentic colors for skin, clothes, furniture and scenery. Remove yellow stains, scratches, mold and haze, adjust contrast, soften light transitions. Retain skin and hair details, balanced saturation, no oversaturation or distortion. Realistic retro color film look, clean with period atmosphere.",
    },
    {"label": "", "prompt_cn": "", "prompt_en": ""},
    {"label": "", "prompt_cn": "", "prompt_en": ""},
    {"label": "", "prompt_cn": "", "prompt_en": ""},
]

_CATALOG_FILE = Path(__file__).resolve().parent.parent / "presets" / "preset_prompt_catalog.json"
_LEGACY_CATALOG_FILE = Path(__file__).resolve().parent.parent / "presets" / "preset_prompt_catalog.md"
_CATEGORY_RE = re.compile(r"^#\s+(.+?)\s*$")
_PRESET_RE = re.compile(r"^##\s+(.+?)\s*$")
_FIELD_RE = re.compile(r"^###\s+(prompt_cn|prompt_en)\s*$", re.IGNORECASE)
_DEFAULT_PRESETS_PER_CATEGORY = 9
_DEFAULT_CATEGORY_COUNT = 6


def _fill_catalog_categories(categories: dict[str, list[dict[str, str]]]) -> list[dict[str, str]]:
    """Keep the UI's nine preset slots available for every category."""
    presets: list[dict[str, str]] = []
    for name, items in categories.items():
        items.extend(
            {"category": name, "label": f"预设 {index + 1}", "prompt_cn": "", "prompt_en": ""}
            for index in range(len(items), _DEFAULT_PRESETS_PER_CATEGORY)
        )
        presets.extend(items)
    return presets


def _load_json_catalog() -> list[dict[str, str]]:
    """Read the editable bundled JSON preset catalog."""
    try:
        raw_catalog = json.loads(_CATALOG_FILE.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return []

    source = raw_catalog.get("presets", []) if isinstance(raw_catalog, dict) else raw_catalog
    if not isinstance(source, list):
        return []
    categories: dict[str, list[dict[str, str]]] = {}
    for item in source:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category", "通用")).strip() or "通用"
        categories.setdefault(category, []).append(
            {
                "category": category,
                "category_i18n": str(item.get("category_i18n", "")).strip(),
                "label": str(item.get("label", "")).strip(),
                "label_i18n": str(item.get("label_i18n", "")).strip(),
                **({"thumbnail": str(item.get("thumbnail", "")).strip()} if str(item.get("thumbnail", "")).strip() else {}),
                "prompt_cn": str(item.get("prompt_cn", "")).strip(),
                "prompt_en": str(item.get("prompt_en", "")).strip(),
            }
        )
    return _fill_catalog_categories(categories)


def _load_legacy_markdown_catalog() -> list[dict[str, str]]:
    """Keep existing Markdown catalogs readable when upgrading older installs."""
    try:
        lines = _LEGACY_CATALOG_FILE.read_text(encoding="utf-8").replace("\r\n", "\n").split("\n")
    except OSError:
        return []

    categories: dict[str, list[dict[str, str]]] = {}
    category = "通用"
    current: dict[str, str] | None = None
    field: str | None = None
    for raw_line in lines:
        line = raw_line.rstrip()
        if match := _CATEGORY_RE.match(line):
            category = match.group(1).strip() or "通用"
            categories.setdefault(category, [])
            current = None
            field = None
        elif match := _PRESET_RE.match(line):
            current = {"category": category, "label": match.group(1).strip(), "prompt_cn": "", "prompt_en": ""}
            categories.setdefault(category, []).append(current)
            field = None
        elif match := _FIELD_RE.match(line):
            field = match.group(1).lower() if current else None
        elif current is not None and field is not None:
            current[field] = f"{current[field]}\n{raw_line}" if current[field] else raw_line

    for name, items in categories.items():
        for item in items:
            item["prompt_cn"] = item["prompt_cn"].strip()
            item["prompt_en"] = item["prompt_en"].strip()
    return _fill_catalog_categories(categories)


def _load_catalog_presets() -> list[dict[str, str]]:
    source = _load_json_catalog() or _load_legacy_markdown_catalog()
    categories: list[str] = []
    limited: list[dict[str, str]] = []
    for preset in source:
        category = preset.get("category", "通用")
        if category not in categories:
            if len(categories) >= _DEFAULT_CATEGORY_COUNT:
                continue
            categories.append(category)
        limited.append(preset)
    return limited


DEFAULT_PRESETS = _load_catalog_presets() or DEFAULT_PRESETS

def _default_presets_json() -> str:
    return json.dumps(DEFAULT_PRESETS, ensure_ascii=False)


def _normalize_presets(raw_data: str) -> list[dict[str, str]]:
    try:
        parsed: Any = json.loads(raw_data)
    except (TypeError, ValueError):
        return DEFAULT_PRESETS

    if not isinstance(parsed, list):
        return DEFAULT_PRESETS

    normalized: list[dict[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "label": str(item.get("label", "")).strip(),
                "category": str(item.get("category", "通用")).strip() or "通用",
                "library_category_id": str(item.get("library_category_id", "")).strip(),
                "library_id": str(item.get("library_id", "")).strip(),
                "category_i18n": str(item.get("category_i18n", "")).strip(),
                "label_i18n": str(item.get("label_i18n", "")).strip(),
                **({"thumbnail": str(item.get("thumbnail", "")).strip()} if str(item.get("thumbnail", "")).strip() else {}),
                "prompt_cn": str(item.get("prompt_cn", "")),
                "prompt_en": str(item.get("prompt_en", "")),
            }
        )

    return normalized or DEFAULT_PRESETS


class WOSAI_PresetPromptSelector:
    """Select a saved bilingual prompt preset from a compact tab widget."""

    CATEGORY = f"{CATEGORY_PREFIX}提示词"
    DESCRIPTION = "Manage bilingual prompt presets with nine default labels; click a label to output the selected prompt"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt_cn", "prompt_en")
    # Prompt Manager can be queued on its own. Mark it as a terminal output so
    # ComfyUI does not reject a workflow that has no image/file output node.
    OUTPUT_NODE = True
    FUNCTION = "select_preset"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "active_index": ("INT", {"default": 0, "min": 0, "max": 998, "step": 1}),
                "presets_data": ("STRING", {"default": _default_presets_json(), "multiline": False}),
                "prompt_cn": ("STRING", {"default": DEFAULT_PRESETS[0]["prompt_cn"], "multiline": True}),
                "prompt_en": ("STRING", {"default": DEFAULT_PRESETS[0]["prompt_en"], "multiline": True}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, active_index: int, presets_data: str = "", prompt_cn: str = "", prompt_en: str = "", **_legacy: Any):
        return active_index, presets_data, prompt_cn, prompt_en

    def select_preset(
        self,
        active_index: int,
        presets_data: str = "",
        prompt_cn: str = "",
        prompt_en: str = "",
        **_legacy: Any,
    ):
        # Native prompt inputs remain authoritative so connected upstream text
        # can override the preset.  The selected preset is a safe backend
        # fallback for API/headless calls that omit both native prompt values.
        if prompt_cn or prompt_en:
            return prompt_cn, prompt_en
        presets = _normalize_presets(presets_data)
        index = max(0, min(int(active_index or 0), len(presets) - 1))
        selected = presets[index]
        return selected["prompt_cn"], selected["prompt_en"]


NODE_CLASS_MAPPINGS = {"WOSAI_PresetPromptSelector": WOSAI_PresetPromptSelector}
NODE_DISPLAY_NAME_MAPPINGS = {"WOSAI_PresetPromptSelector": "WOSAI Preset Manager"}
