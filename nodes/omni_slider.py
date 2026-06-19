"""WOSAI OmniSlider — 万能滑条节点"""

import json
from wosai_core.config import CATEGORY_PREFIX, default_omni_config as default_config

MAX_CHANNELS = 6


class _TS(str):
    """TautologyStr: __ne__ always False so type validation passes for any
    connected input (FLOAT→INT, FLOAT→FLOAT, etc).  Used because ComfyUI V1
    RETURN_TYPES is read from the class before execute(), making per-channel
    dynamic types impossible without a validation bypass."""
    def __ne__(self, _):
        return False


class WOSAI_OmniSlider:

    CATEGORY = CATEGORY_PREFIX + "工具"
    # 6 路输出通过 _TS 绕过 V1 静态类型校验，实际类型由 execute() 内各通道
    # cfg.type 决定（INT 通道返回 int 等值浮点，FLOAT 通道返回原始浮点）
    RETURN_TYPES = (
        _TS("FLOAT"), _TS("FLOAT"), _TS("FLOAT"),
        _TS("FLOAT"), _TS("FLOAT"), _TS("FLOAT"),
    )
    RETURN_NAMES = ("C1", "C2", "C3", "C4", "C5", "C6")
    FUNCTION = "execute"
    OUTPUT_NODE = False

    DESCRIPTION = "多通道独立滑条，全通道同时激活，端口数动态匹配"

    @classmethod
    def INPUT_TYPES(cls):
        hidden = {}
        for i in range(1, MAX_CHANNELS + 1):
            hidden[f"ch{i}_cfg"] = (
                "STRING",
                # 标签默认留空：前端滑条显示占位符“右键此处设置滑条”（与 omni-slider.js::defaultCfg 对齐）；
                # 输出端口名由 RETURN_NAMES 兜底为 CN
                {"default": json.dumps(default_config("")), "multiline": False},
            )
        hidden["channel_count"] = ("INT", {"default": 1, "min": 1, "max": MAX_CHANNELS})
        hidden["active_channel"] = ("INT", {"default": 0, "min": 0, "max": MAX_CHANNELS - 1})
        return {
            "required": {
                "active_value": ("FLOAT", {
                    "default": 0.0, "min": -999999, "max": 999999, "step": 0.01,
                    "tooltip": "内部缓存键，自动同步滑条值",
                }),
            },
            "hidden": hidden,
        }

    @classmethod
    def VALIDATE_INPUTS(cls, active_value: float = 0.0,
                        channel_count: int = 1, active_channel: int = 0, **kwargs):
        if not (1 <= channel_count <= MAX_CHANNELS):
            return f"通道数必须在 1-{MAX_CHANNELS} 之间"
        # active_channel 保留但不强制校验范围（全通道激活模式）
        if not (0 <= active_channel < MAX_CHANNELS):
            return f"active_channel 必须在 0-{MAX_CHANNELS - 1} 之间"
        for i in range(1, MAX_CHANNELS + 1):
            cfg_str = cls._cfg_str(kwargs.get(f"ch{i}_cfg", ""))
            if cfg_str:
                try:
                    json.loads(cfg_str)
                except json.JSONDecodeError:
                    return f"通道 {i} 配置格式无效"
        return True

    @staticmethod
    def _cfg_str(raw):
        """规范化 cfg 值：ComfyUI 某些版本可能传递 list 或已解析的 dict"""
        if isinstance(raw, (list, tuple)):
            return str(raw[0]) if raw else ""
        if isinstance(raw, dict):
            # ComfyUI v10 可能自动解析 JSON 字符串为 dict
            return json.dumps(raw)
        return str(raw) if raw is not None else ""

    def execute(self, active_value: float = 0.0,
                channel_count: int = 1, active_channel: int = 0, **kwargs):
        """全通道独立输出：读取所有通道的 cfg 中的 value，各自独立输出到对应端口。
        active_channel 保留参数但不再影响执行逻辑（全通道同时激活）。"""
        values = []
        for i in range(MAX_CHANNELS):
            cfg_str = self._cfg_str(kwargs.get(f"ch{i+1}_cfg", ""))
            if cfg_str:
                try:
                    cfg = json.loads(cfg_str)
                    raw = float(cfg.get("value", 0.0))
                    if str(cfg.get("type", "FLOAT")).upper() == "INT":
                        values.append(int(round(raw)))
                    else:
                        values.append(float(raw))
                except Exception:
                    values.append(0.0)
            else:
                values.append(0.0)
        return tuple(values)

    @classmethod
    def IS_CHANGED(cls, active_value: float = 0.0,
                   channel_count: int = 1, active_channel: int = 0, **kwargs):
        """全通道独立激活：任意通道 cfg 变化即触发重执行。
        active_channel 保留参数但不再影响缓存键（全通道同时激活）。"""
        keys = [active_value, channel_count]
        for i in range(MAX_CHANNELS):
            cfg_str = cls._cfg_str(kwargs.get(f"ch{i+1}_cfg", ""))
            keys.append(cfg_str)
        return tuple(keys)


NODE_CLASS_MAPPINGS = {"WOSAI_OmniSlider": WOSAI_OmniSlider}
NODE_DISPLAY_NAME_MAPPINGS = {"WOSAI_OmniSlider": "万能滑条 OmniSlider"}
