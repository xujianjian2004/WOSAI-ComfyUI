"""Shared ComfyUI socket types used by WOSAI routing-style nodes."""


class AnyType(str):
    """Wildcard socket compatible with classic ComfyUI type comparisons."""

    def __ne__(self, other):
        return False

    def __eq__(self, other):
        return True


ANY = AnyType("*")
