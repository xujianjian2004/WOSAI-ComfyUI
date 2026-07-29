from __future__ import annotations

import importlib.util
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def load_script(name: str):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"wosai_test_{name}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_release = load_script("build_release")
verify_release = load_script("verify_release")


class ReleaseToolTests(unittest.TestCase):
    def test_release_archive_is_deterministic_and_checksum_is_verified(self):
        with tempfile.TemporaryDirectory(prefix=".release-test-", dir=ROOT) as temp:
            first = Path(temp) / "first.zip"
            second = Path(temp) / "second.zip"
            first_count, first_digest = build_release.write_archive(first)
            second_count, second_digest = build_release.write_archive(second)

            self.assertEqual(first_count, second_count)
            self.assertEqual(first_digest, second_digest)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            verify_release.validate_checksum(first)

            with zipfile.ZipFile(first) as archive:
                members = verify_release.validate_members(archive)
            self.assertIn("web/shared/node-color-state.js", members)
            self.assertIn("web/shared/save-node-query.js", members)
            self.assertNotIn("web/shared/node-color-state.test.mjs", members)

    def test_release_member_validation_rejects_duplicate_entries(self):
        with tempfile.TemporaryDirectory(prefix=".release-test-", dir=ROOT) as temp:
            archive_path = Path(temp) / "duplicate.zip"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(archive_path, "w") as archive:
                    archive.writestr("WOSAI-ComfyUI/README.md", "first")
                    archive.writestr("WOSAI-ComfyUI/README.md", "second")
            with zipfile.ZipFile(archive_path) as archive:
                with self.assertRaisesRegex(AssertionError, "duplicate"):
                    verify_release.validate_members(archive)


if __name__ == "__main__":
    unittest.main()
