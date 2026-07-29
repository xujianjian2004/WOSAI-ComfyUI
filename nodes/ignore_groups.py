"""WOSAI 忽略编组 IgnoreGroups — 通过开关控制工作流中各编组的忽略/旁路状态"""
import logging
from wosai_core.config import CATEGORY_PREFIX

logger = logging.getLogger(__name__)
logger.debug("[WOSAI] 忽略编组 IgnoreGroups 已加载")


class WOSAI_IgnoreGroups:
    """忽略编组：控制工作流中各编组的忽略/旁路状态"""

    DESCRIPTION = "Batch control node bypass/disable by selecting groups"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = CATEGORY_PREFIX + "画布"
    OUTPUT_NODE = True

    def execute(self) -> tuple:
        return ()


NODE_CLASS_MAPPINGS = {
    "WOSAI_IgnoreGroups": WOSAI_IgnoreGroups,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_IgnoreGroups": "IgnoreGroups",
}
