"""Generic WOSAI routing nodes with lazy fallback support."""

from __future__ import annotations

from wosai_core.config import CATEGORY_PREFIX
from wosai_core.types import ANY
MAX_SWITCH_INPUTS = 32


class WOSAI_NumberSwitch:
    CATEGORY = f"{CATEGORY_PREFIX}Logic"
    DESCRIPTION = "Route one of several generic inputs by zero-based index"
    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("output",)
    FUNCTION = "switch"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "select": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": MAX_SWITCH_INPUTS - 1,
                        "step": 1,
                        "forceInput": True,
                    },
                )
            },
            "optional": {
                f"value{i}": (ANY,) for i in range(MAX_SWITCH_INPUTS)
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, select=0, **kwargs):
        try:
            index = int(select)
        except (TypeError, ValueError):
            return "select must be an integer"
        if not 0 <= index < MAX_SWITCH_INPUTS:
            return f"select must be between 0 and {MAX_SWITCH_INPUTS - 1}"
        return True

    def switch(self, select=0, **values):
        index = int(select)
        if not 0 <= index < MAX_SWITCH_INPUTS:
            raise ValueError(f"select must be between 0 and {MAX_SWITCH_INPUTS - 1}")
        return (values.get(f"value{index}"),)


class WOSAI_LazyFallback:
    CATEGORY = f"{CATEGORY_PREFIX}Logic"
    DESCRIPTION = "Return primary when present; evaluate fallback only when primary is None"
    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("output",)
    FUNCTION = "resolve"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "primary": (ANY,),
                "fallback": (ANY, {"lazy": True}),
            },
        }

    def check_lazy_status(self, primary=None, fallback=None):
        if primary is None and fallback is None:
            return ["fallback"]
        return None

    def resolve(self, primary=None, fallback=None):
        return (primary if primary is not None else fallback,)


NODE_CLASS_MAPPINGS = {
    "WOSAI_NumberSwitch": WOSAI_NumberSwitch,
    "WOSAI_LazyFallback": WOSAI_LazyFallback,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOSAI_NumberSwitch": "Number Switch",
    "WOSAI_LazyFallback": "Lazy Fallback",
}


# Nodes 2.0: use the native Autogrow schema when the current ComfyUI exposes
# it.  Classic installations retain the bounded V1 definition above.
try:
    from comfy_api.latest import io as _io

    class WOSAI_NumberSwitch_V3(_io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return _io.Schema(
                node_id="WOSAI_NumberSwitch",
                display_name="Number Switch",
                category=f"{CATEGORY_PREFIX}Logic",
                description="Route one of several generic inputs by zero-based index",
                inputs=[
                    _io.Int.Input(
                        "select",
                        default=0,
                        min=0,
                        max=MAX_SWITCH_INPUTS - 1,
                        step=1,
                        force_input=True,
                    ),
                    _io.Autogrow.Input(
                        "values",
                        template=_io.Autogrow.TemplatePrefix(
                            _io.AnyType.Input("value"),
                            prefix="value",
                            min=1,
                            max=MAX_SWITCH_INPUTS,
                        ),
                    ),
                ],
                outputs=[_io.AnyType.Output("output")],
            )

        @classmethod
        def validate_inputs(cls, select=0, **kwargs):
            return WOSAI_NumberSwitch.VALIDATE_INPUTS(select, **kwargs)

        @classmethod
        def execute(cls, select=0, values=None):
            values = values or {}
            index = int(select)
            if not 0 <= index < MAX_SWITCH_INPUTS:
                raise ValueError(
                    f"select must be between 0 and {MAX_SWITCH_INPUTS - 1}"
                )
            return _io.NodeOutput(values.get(f"value{index}"))

except (ImportError, AttributeError):
    pass
else:
    NODE_CLASS_MAPPINGS["WOSAI_NumberSwitch"] = WOSAI_NumberSwitch_V3
