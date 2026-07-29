"""WOSAI LogicSwitch — 逻辑开关节点（移植自 ComfyUI-OverrideSwitch，重命名为 LogicSwitch）

逻辑来源：ComfyUI-OverrideSwitch/override_switch.py
功能：根据布尔条件在 true_input / false_input 之间切换输出；
      当 condition 未连接时，由 Default_Input 开关决定回落到哪一路。
"""
import logging
from typing import Optional

from wosai_core.config import CATEGORY_PREFIX

logger = logging.getLogger(__name__)
logger.debug("[WOSAI] LogicSwitch 已加载")


# Helper class and instance from ComfyUI-LogicUtils/autonode.py
# to mimic their generic type handling
class AllTrue(str):
    def __init__(self, representation=None) -> None:
        self.repr = representation
        pass

    def __ne__(self, __value: object) -> bool:
        return False

    def __instancecheck__(self, instance):
        return True

    def __subclasscheck__(self, subclass):
        return True

    def __bool__(self):
        return True

    def __str__(self):
        return self.repr or "*"

    def __jsonencode__(self):
        return self.repr or "*"

    def __repr__(self) -> str:
        return self.repr or "*"

    def __eq__(self, __value: object) -> bool:
        return True


anytype = AllTrue("*")


class WOSAI_LogicSwitch:
    """
    A node that switches between two inputs based on a boolean condition.
    - Uses custom 'anytype' for generic typing for broad compatibility.
    - Inputs 'condition', 'true_input', and 'false_input' are optional.
    - A 'Default_Input' widget (True/False) determines which input (true_input or false_input respectively)
      is used if the 'condition' input is not provided.
    """

    DESCRIPTION = "Switch between two inputs by boolean condition (fallback to default when condition is unconnected)"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            # Add widget to control default behavior when condition is missing
            "required": {
                "Default_Input": ("BOOLEAN", {"default": False}),  # Changed default to False
            },
            "optional": {
                "condition": (anytype, {}),  # Optional condition
                "true_input": (anytype, {}),  # Input if condition is True
                "false_input": (anytype, {}),  # Input if condition is False
            },
        }

    # RETURN_TYPES still uses anytype
    RETURN_TYPES = (anytype,)
    RETURN_NAMES = ("output",)
    FUNCTION = "switch"
    CATEGORY = CATEGORY_PREFIX + "逻辑"

    # Adjust logic for the new default behavior control
    def switch(
        self,
        Default_Input: bool = False,
        condition: Optional[bool] = None,
        true_input: Optional[object] = None,
        false_input: Optional[object] = None,
        **translated_inputs: object,
    ) -> tuple:
        # 兼容旧版 i18N 曾把端口显示名写入 kwargs 的工作流；内部参数始终使用稳定英文名。
        if "默认输入" in translated_inputs:
            Default_Input = translated_inputs["默认输入"]
        elif "Default Input" in translated_inputs:
            Default_Input = translated_inputs["Default Input"]
        if "条件" in translated_inputs:
            condition = translated_inputs["条件"]
        if "真值输入" in translated_inputs:
            true_input = translated_inputs["真值输入"]
        if "假值输入" in translated_inputs:
            false_input = translated_inputs["假值输入"]

        # If condition is not provided or None, use the Default_Input setting
        if condition is None:
            if Default_Input:  # Use renamed parameter
                # Defaulting to true_input (return None if true_input is missing)
                return (true_input,)
            else:
                # Defaulting to false_input (return None if false_input is missing)
                return (false_input,)

        # --- Condition is provided (True or False), proceed with normal logic ---

        # If true_input is missing and condition is True, use false_input
        if condition and true_input is None:
            # If false_input is also None, output actual None
            return (false_input if false_input is not None else None,)

        # If false_input is missing and condition is False, return None (as per original Goals.md#3)
        if not condition and false_input is None:
            return (None,)

        # Normal switch behavior (inputs are present or handled above)
        selected_output = true_input if condition else false_input
        return (selected_output,)


# Node class mappings for ComfyUI
NODE_CLASS_MAPPINGS = {
    "WOSAI_LogicSwitch": WOSAI_LogicSwitch,
}

# Node display names
NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_LogicSwitch": "LogicSwitch",
}
