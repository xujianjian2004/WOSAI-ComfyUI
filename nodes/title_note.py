"""WOSAI 标题注释 TitleNote — 纯前端节点存根
Registry.discover_nodes 自动发现并注册到 NODE_CLASS_MAPPINGS。
实际渲染逻辑在 web/title-note.js 中（LGraphNode 子类）。
"""
import logging
from wosai_core.config import CATEGORY_PREFIX

logger = logging.getLogger(__name__)
logger.info("[WOSAI] 标题注释 TitleNote 存根已加载")


class WOSAI_TitleNote:
    """标题注释：画布标题/注释节点（纯前端，无执行逻辑）。"""

    DESCRIPTION = "Canvas text annotation with font-size, line-height, letter-spacing, animation, and color"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "note"
    CATEGORY = CATEGORY_PREFIX + "画布"

    def note(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "WOSAI_TitleNote": WOSAI_TitleNote,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_TitleNote": "TitleNote",
}
