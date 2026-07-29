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
        data = {"version": 1, "recent": [{"hex": "#123456"}], "custom": []}

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
                    "custom": [{"hex": "#123456"}] * 30,
                }
            ),
            encoding="utf-8",
        )

        loaded = self.module._load()

        self.assertEqual(loaded["version"], 1)
        self.assertEqual(loaded["recent"], [{"hex": "#abcdef"}])
        self.assertEqual(len(loaded["custom"]), self.module._MAX_CUSTOM)

    def test_concurrent_saves_leave_one_complete_json_document(self):
        payloads = [
            {"version": 1, "recent": [{"hex": f"#{index:06X}"}], "custom": []}
            for index in range(16)
        ]

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(self.module._save, payloads))

        saved = json.loads(self.module._PRESETS_FILE.read_text(encoding="utf-8"))
        self.assertIn(saved, payloads)
        self.assertEqual(list(self.module._PRESETS_DIR.glob("*.tmp")), [])
