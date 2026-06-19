VERSION = "1.1"
AUTHOR = "穿山阅海"
EMAIL = "xujianjian2004@126.com"
STUDIO = "WOSAI STUDIO"
LICENSE = "MIT"
REPO_URL = "https://github.com/xujianjian2004/WOSAI-ComfyUI"

# 节点分类前缀（含品牌 emoji）
CATEGORY_PREFIX = "🟠 WOSAI Studio / "
BRAND_COLOR = "#DD6F4A"
DOM_PREFIX = "wosai"

# 万能滑条默认通道配置（V1/V3 共享）
def default_omni_config(name: str = "Channel") -> dict:
    return {
        "label": name,
        "type": "FLOAT",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "value": 0.5,   # 与前端 defaultCfg 对齐（曾为 0.0/0.5 双源漂移）
        "color": "#DD6F4A",
        "scale": 0.5,
        "style": "float",
        "scale_float": 0.5,
        "scale_fill": 0.5,
        "trackBg": "#2A2A2E",
        "trackColor": "",
        "thumbColor": "",
        "textColor": "#E4E4E7",
    }
