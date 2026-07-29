"""Small request-origin checks for local ComfyUI routes with side effects."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit


def is_same_origin_request(request: Any) -> bool:
    """Reject explicit cross-site browser requests while allowing local clients."""

    headers = getattr(request, "headers", {}) or {}
    fetch_site = str(headers.get("Sec-Fetch-Site", "")).strip().lower()
    if fetch_site == "cross-site":
        return False

    origin = str(headers.get("Origin", "")).strip()
    if not origin:
        return True

    parsed_origin = urlsplit(origin)
    if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc:
        return False

    request_host = str(getattr(request, "host", "") or headers.get("Host", "")).strip()
    if not request_host:
        return False

    return parsed_origin.netloc.casefold() == request_host.casefold()
