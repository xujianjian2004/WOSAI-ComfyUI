"""Request-level integration tests for WOSAI's local aiohttp endpoints."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from wosai_core import device_info


def _register_routes() -> tuple[web.RouteTableDef, object]:
    """Load route modules against a real aiohttp route table."""

    routes = web.RouteTableDef()
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(
        instance=types.SimpleNamespace(routes=routes)
    )
    previous = sys.modules.get("server")
    sys.modules["server"] = server
    try:
        path = Path(__file__).parents[1] / "wosai_core" / "color_presets.py"
        spec = importlib.util.spec_from_file_location(
            "_color_presets_http_test_target",
            path,
        )
        assert spec and spec.loader
        color_presets = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(color_presets)
        device_info.setup_routes()
    finally:
        if previous is None:
            sys.modules.pop("server", None)
        else:
            sys.modules["server"] = previous
    return routes, color_presets


_ROUTES, _COLOR_PRESETS = _register_routes()


class HttpRouteIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp_dir.cleanup)
        _COLOR_PRESETS._PRESETS_DIR = Path(self.tmp_dir.name) / "presets"
        _COLOR_PRESETS._PRESETS_FILE = (
            _COLOR_PRESETS._PRESETS_DIR / "color_presets.json"
        )

        app = web.Application(client_max_size=_COLOR_PRESETS._MAX_BODY * 2)
        app.add_routes(_ROUTES)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_color_presets_round_trip_sanitizes_values(self):
        response = await self.client.post(
            "/wosai/color_presets",
            json={
                "version": 99,
                "recent": [{"hex": "#abcdef"}, {"hex": "invalid"}],
                "custom": [{"hex": "#123456"}],
            },
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.json(), {"ok": True})

        response = await self.client.get("/wosai/color_presets")
        self.assertEqual(response.status, 200)
        self.assertEqual(
            await response.json(),
            {
                "version": 1,
                "recent": [{"hex": "#abcdef"}],
                "custom": [{"hex": "#123456"}],
            },
        )

    async def test_color_presets_rejects_cross_origin_request(self):
        response = await self.client.post(
            "/wosai/color_presets",
            json={"recent": [], "custom": []},
            headers={
                "Origin": "https://example.invalid",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(response.status, 403)

    async def test_color_presets_rejects_invalid_json_and_payload_shape(self):
        invalid_json = await self.client.post(
            "/wosai/color_presets",
            data=b"{",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(invalid_json.status, 400)

        invalid_shape = await self.client.post(
            "/wosai/color_presets",
            data=json.dumps([]).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(invalid_shape.status, 400)

    async def test_color_presets_rejects_oversized_body(self):
        response = await self.client.post(
            "/wosai/color_presets",
            data=b"x" * (_COLOR_PRESETS._MAX_BODY + 1),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(response.status, 413)

    async def test_device_info_refresh_uses_requested_cache_scope(self):
        payload = {"health": {"score": 100}}
        with patch.object(device_info, "collect_device_info", return_value=payload) as collect:
            response = await self.client.get("/wosai/device_info?refresh=dynamic")
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.json(), payload)
        collect.assert_called_once_with(False, True)

    async def test_open_path_rejects_cross_origin_request(self):
        response = await self.client.post(
            "/wosai/device_info/open_path",
            json={"key": "output", "index": 0},
            headers={
                "Origin": "https://example.invalid",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(response.status, 403)

    async def test_open_path_rejects_invalid_json_and_unknown_directory(self):
        invalid_json = await self.client.post(
            "/wosai/device_info/open_path",
            data=b"{",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(invalid_json.status, 400)

        with patch.object(device_info, "_known_path", return_value=None):
            unknown = await self.client.post(
                "/wosai/device_info/open_path",
                json={"key": "output", "index": 0},
            )
        self.assertEqual(unknown.status, 404)

    async def test_open_path_only_opens_a_resolved_known_directory(self):
        known = Path(self.tmp_dir.name).resolve()
        with (
            patch.object(device_info, "_known_path", return_value=known) as resolve,
            patch.object(device_info, "_open_directory") as open_directory,
        ):
            response = await self.client.post(
                "/wosai/device_info/open_path",
                json={"key": "output", "index": 0},
            )
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.json(), {"path": str(known)})
        resolve.assert_called_once_with("output", 0)
        open_directory.assert_called_once_with(known)


if __name__ == "__main__":
    unittest.main()
