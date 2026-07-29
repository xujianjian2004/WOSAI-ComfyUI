"""WOSAI OmniSlider — 万能滑条节点（单通道美化版）"""

import json
import logging
from wosai_core.config import CATEGORY_PREFIX, default_omni_config as default_config
from wosai_core.types import ANY

logger = logging.getLogger(__name__)


class WOSAI_OmniSlider:

    CATEGORY = CATEGORY_PREFIX + "工具"
    # The configured channel can intentionally emit either int or float.
    # A wildcard keeps the backend schema consistent with the dynamic frontend port.
    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("VALUE",)
    FUNCTION = "execute"
    OUTPUT_NODE = False

    DESCRIPTION = "Multi-channel slider control, supports float/int/fill style"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "active_value": ("FLOAT", {
                    "default": 0.0, "min": -999999, "max": 999999, "step": 0.01,
                    "tooltip": "内部缓存键，自动同步滑条值",
                }),
            },
            "hidden": {
                "ch1_cfg": ("STRING", {
                    "default": json.dumps(default_config("")), "multiline": False,
                }),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, active_value: float = 0.0, **kwargs):
        cfg_str = kwargs.get("ch1_cfg", "")
        if cfg_str:
            try:
                json.loads(str(cfg_str) if cfg_str else "{}")
            except json.JSONDecodeError:
                return "滑条配置格式无效"
        return True

    @staticmethod
    def _cfg_str(raw):
        if isinstance(raw, (list, tuple)):
            return str(raw[0]) if raw else ""
        if isinstance(raw, dict):
            return json.dumps(raw)
        return str(raw) if raw is not None else ""

    def execute(self, active_value: float = 0.0, **kwargs):
        cfg_str = self._cfg_str(kwargs.get("ch1_cfg", ""))
        if cfg_str:
            try:
                cfg = json.loads(cfg_str)
                raw = float(cfg.get("value", 0.0))
                if str(cfg.get("type", "FLOAT")).upper() == "INT":
                    return (int(round(raw)),)
                return (float(raw),)
            except (json.JSONDecodeError, ValueError, TypeError, AttributeError) as e:
                logger.warning("OmniSlider execute: invalid cfg: %s", e)
        return (0.0,)

    @classmethod
    def IS_CHANGED(cls, active_value: float = 0.0, **kwargs):
        cfg_str = cls._cfg_str(kwargs.get("ch1_cfg", ""))
        return (active_value, cfg_str)


NODE_CLASS_MAPPINGS = {"WOSAI_OmniSlider": WOSAI_OmniSlider}
NODE_DISPLAY_NAME_MAPPINGS = {"WOSAI_OmniSlider": "OmniSlider"}
