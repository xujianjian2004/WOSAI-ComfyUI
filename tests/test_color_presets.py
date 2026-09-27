"""Regression tests for the color-preset persistence helpers.

The production module registers ComfyUI routes at import time.  These tests
provide minimal module stubs so the file I/O contract remains testable without
requiring a running ComfyUI server or optional third-party test packages.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


class _Routes:
    def get(self, _path):
        return lambda handler: handler

    def post(self, _path):
        return lambda handler: handler


def _load_module():
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(
        instance=types.SimpleNamespace(routes=_Routes())
    )
    aiohttp = types.ModuleType("aiohttp")
    aiohttp.web = types.SimpleNamespace(Response=object, json_response=lambda *args, **kwargs: None)

    previous = {name: sys.modules.get(name) for name in ("server", "aiohttp")}
    sys.modules["server"] = server
    sys.modules["aiohttp"] = aiohttp
    try:
        path = Path(__file__).parents[1] / "wosai_core" / "color_presets.py"
        spec = importlib.util.spec_from_file_location("_color_presets_test_target", path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        for name, original in previous.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original


class ColorPresetPersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp_dir.cleanup)
        self.module._PRESETS_DIR = Path(self.tmp_dir.name) / "presets"
        self.module._PRESETS_FILE = self.module._PRESETS_DIR / "color_presets.json"

    def test_save_is_atomic_and_does_not_leave_a_temp_file(self):
        data = {
            "version": 2,
            "recent": [{"hex": "#123456"}],
            "customSolid": [],
            "customGrad2": [],
            "customGrad3": [],
        }

        self.module._save(data)

        self.assertEqual(json.loads(self.module._PRESETS_FILE.read_text(encoding="utf-8")), data)
        self.assertFalse(self.module._PRESETS_FILE.with_suffix(".json.tmp").exists())

    def test_load_discards_invalid_values_and_applies_caps(self):
        self.module._PRESETS_DIR.mkdir(parents=True)
        self.module._PRESETS_FILE.write_text(
            json.dumps(
                {
                    "version": 99,
                    "recent": [{"hex": "#abcdef"}, {"hex": "not-a-colour"}],
                    "customSolid": [{"type": "solid", "title": "t", "bg": "#123456"}] * 30,
                    "customGrad2": [{
                        "type": "grad2",
                        "dir": "↓",
                        "stops": [{"hex": "#111111", "p": 0}, {"hex": "#222222", "p": 1}],
                    }] * 30,
                    "customGrad3": "not-a-list",
                }
            ),
            encoding="utf-8",
        )

        loaded = self.module._load()

        self.assertEqual(loaded["version"], 2)
        self.assertEqual(loaded["recent"], [{"hex": "#abcdef"}])
        self.assertEqual(len(loaded["customSolid"]), self.module._MAX_CUSTOM)
        self.assertEqual(len(loaded["customGrad2"]), self.module._MAX_CUSTOM)
        self.assertEqual(loaded["customGrad3"], [])

    def test_gradient_sanitizer_keeps_renderable_entries_and_caps_stops(self):
        items = [
            {"type": "grad3", "dir": "→", "stops": [
                {"hex": "#111111", "p": 0}, {"hex": "#222222", "p": 1}]},  # 2 个色标可渲染 → 保留
            {"type": "grad3", "dir": "↓"},                                  # 缺少 stops → 丢弃
            {"type": "grad3", "dir": "?", "stops": [
                {"hex": "#111111", "p": 0}, {"hex": "#222222", "p": 1},
                {"hex": "#333333", "p": 2}, {"hex": "#444444", "p": 3}]},
        ]

        out = self.module._sanitize_gradient_list(items, "grad3", 10)

        self.assertEqual(len(out), 2)
        self.assertEqual(len(out[0]["stops"]), 2)        # 2 个色标原样保留
        self.assertEqual(out[0]["dir"], "→")             # 合法方向保留
        self.assertEqual(len(out[1]["stops"]), 3)        # 超过 3 个色标被截断
        self.assertEqual(out[1]["dir"], "↓")             # 非法方向回退默认
        self.assertEqual(out[1]["stops"][-1]["p"], 1.0)  # 位置钳制到 [0, 1]

    def test_gradient_sanitizer_drops_malformed_colours(self):
        items = [
            {"type": "grad3", "dir": "↓", "stops": [
                {"hex": "not-a-colour", "p": 0}, {"hex": "#222222", "p": 1}]},  # 仅 1 个合法色标 → 丢弃
        ]

        out = self.module._sanitize_gradient_list(items, "grad3", 10)

        self.assertEqual(out, [])

    def test_concurrent_saves_leave_one_complete_json_document(self):
        payloads = [
            {
                "version": 2,
                "recent": [{"hex": f"#{index:06X}"}],
                "customSolid": [],
                "customGrad2": [],
                "customGrad3": [],
            }
            for index in range(16)
        ]

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(self.module._save, payloads))

        saved = json.loads(self.module._PRESETS_FILE.read_text(encoding="utf-8"))
        self.assertIn(saved, payloads)
        self.assertEqual(list(self.module._PRESETS_DIR.glob("*.tmp")), [])
