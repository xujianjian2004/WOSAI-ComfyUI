"""Unit tests for ``wosai_core.media_preview``.

The module is deliberately host-agnostic: it only needs ``folder_paths`` and
``PIL`` at call time.  These tests install a fake ``folder_paths`` so the
disk-resolution and payload-building paths can be exercised without a ComfyUI
runtime (``torch`` / ``numpy`` are absent in the packaging environment).
"""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from PIL import Image

from wosai_core import media_preview


class FakeFolderPaths:
    """Minimal stand-in for ComfyUI's ``folder_paths`` module."""

    def __init__(self, root: Path):
        self.dirs = {name: root / name for name in ("input", "output", "temp")}
        for directory in self.dirs.values():
            directory.mkdir(parents=True, exist_ok=True)

    def get_directory_by_type(self, type_name):
        directory = self.dirs.get(str(type_name))
        return str(directory) if directory else None

    def get_input_directory(self):
        return str(self.dirs["input"])

    def get_output_directory(self):
        return str(self.dirs["output"])

    def get_temp_directory(self):
        return str(self.dirs["temp"])

    def annotated_filepath(self, name):
        raw = str(name).strip()
        base = None
        if raw.endswith("]"):
            head, _, annotation = raw.rpartition("[")
            type_name = annotation[:-1].strip().lower()
            if type_name in self.dirs:
                base = self.dirs[type_name]
                raw = head.strip()
        if base is None:
            return raw, None
        path = Path(raw)
        parent = base if str(path.parent) == "." else base / path.parent
        return path.name, str(parent)


class StubTensor:
    """Duck-typed IMAGE tensor: ``shape`` + ``detach`` is all the module needs."""

    def __init__(self, shape):
        self.shape = tuple(shape)

    @property
    def ndim(self):
        return len(self.shape)

    def detach(self):
        return self

    def unsqueeze(self, _dim):
        return self

    def __getitem__(self, item):
        if isinstance(item, slice):
            count = len(range(*item.indices(int(self.shape[0]))))
            return StubTensor((count, *self.shape[1:]))
        return self

    def __iter__(self):
        return iter([self] * int(self.shape[0]))


class StubVideo:
    """Duck-typed VIDEO object exposing only the public probe methods."""

    def __init__(self, source=None, trim=(0.0, 0.0), metadata=None, fail_trim=False):
        self._source = source
        self._trim = trim
        self._metadata = metadata or {}
        self._fail_trim = fail_trim

    def save_to(self, path, **kwargs):  # noqa: ARG002 - probe target only
        raise AssertionError("save_to must not be called when a source file exists")

    def get_components(self):
        return object()

    def get_stream_source(self):
        return str(self._source) if self._source else None

    def get_active_trim_window(self):
        if self._fail_trim:
            raise RuntimeError("trim probe unavailable")
        return self._trim

    def get_dimensions(self):
        return self._metadata.get("dimensions", (0, 0))

    def get_frame_count(self):
        return self._metadata.get("frame_count", 0)

    def get_frame_rate(self):
        return self._metadata.get("frame_rate", 0)

    def get_duration(self):
        return self._metadata.get("duration", 0)


class MediaPreviewTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.folders = FakeFolderPaths(self.root)
        patcher = mock.patch.object(media_preview, "_folder_paths", lambda: self.folders)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write_png(self, relative: str, size=(8, 6)) -> Path:
        path = self.folders.dirs["input"] / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, (12, 34, 56)).save(path)
        return path

    def temp_listing(self):
        return sorted(item.name for item in self.folders.dirs["temp"].iterdir())


class MediaKindTests(MediaPreviewTestCase):
    def test_unknown_for_none_and_plain_values(self):
        self.assertEqual(media_preview.media_kind(None), "unknown")
        self.assertEqual(media_preview.media_kind(12345), "unknown")
        self.assertEqual(media_preview.media_kind({"no": "filename"}), "unknown")

    def test_image_tensor_is_detected_by_shape_and_detach(self):
        self.assertEqual(media_preview.media_kind(StubTensor((1, 8, 6, 3))), "image")
        self.assertEqual(media_preview.media_kind(StubTensor((8, 6, 4))), "image")
        self.assertEqual(media_preview.media_kind(StubTensor((8, 6))), "unknown")

    def test_video_object_is_detected_by_public_methods(self):
        self.assertEqual(media_preview.media_kind(StubVideo()), "video")

    def test_extension_variants(self):
        self.assertEqual(media_preview.media_kind("clip.png"), "image")
        self.assertEqual(media_preview.media_kind("clip.WEBP"), "image")
        self.assertEqual(media_preview.media_kind("clip.mp4"), "video")
        self.assertEqual(media_preview.media_kind({"filename": "clip.mkv"}), "video")
        self.assertEqual(media_preview.media_kind({"filename": "clip.gif"}), "video")
        self.assertEqual(media_preview.media_kind("clip.psd"), "unknown")

    def test_widget_annotation_is_stripped(self):
        self.assertEqual(media_preview._suffix_of("sub/clip.png [input]"), ".png")
        self.assertEqual(media_preview.media_kind("sub/clip.mp4 [output]"), "video")

    def test_batch_size(self):
        self.assertEqual(media_preview.image_batch_size(StubTensor((4, 8, 6, 3))), 4)
        self.assertEqual(media_preview.image_batch_size(StubTensor((8, 6, 3))), 1)
        self.assertEqual(media_preview.image_batch_size(StubTensor((4, 8, 6))), 0)
        self.assertEqual(media_preview.image_batch_size(object()), 0)


class PathResolutionTests(MediaPreviewTestCase):
    def test_managed_directories_follow_input_output_temp_order(self):
        self.assertEqual(
            [name for name, _ in media_preview.managed_directories()],
            ["input", "output", "temp"],
        )

    def test_reference_is_relative_and_typed(self):
        self.write_png("a.png")
        reference = media_preview.reference_for_path(self.folders.dirs["input"] / "a.png")
        self.assertEqual(reference, {"filename": "a.png", "subfolder": "", "type": "input"})

    def test_reference_keeps_subfolder_with_forward_slashes(self):
        self.write_png("nested/deep/b.png")
        path = self.folders.dirs["input"] / "nested" / "deep" / "b.png"
        self.assertEqual(
            media_preview.reference_for_path(path)["subfolder"],
            "nested/deep",
        )

    def test_reference_is_none_outside_managed_directories(self):
        outside = self.root / "elsewhere.png"
        Image.new("RGB", (4, 4), (0, 0, 0)).save(outside)
        self.assertIsNone(media_preview.reference_for_path(outside))
        self.assertIsNone(media_preview.reference_for_path(None))

    def test_resolve_absolute_path(self):
        path = self.write_png("c.png")
        self.assertEqual(media_preview.resolve_source_path(str(path)), path)

    def test_resolve_annotated_widget_value(self):
        path = self.write_png("d.png")
        self.assertEqual(media_preview.resolve_source_path("d.png [input]"), path)

    def test_resolve_dict_and_object_values(self):
        path = self.write_png("e.png")
        self.assertEqual(
            media_preview.resolve_source_path(
                {"filename": "e.png", "subfolder": "", "type": "input"}
            ),
            path,
        )
        self.assertEqual(media_preview.resolve_source_path(StubVideo(source=path)), path)

    def test_resolve_returns_none_for_missing_files(self):
        self.assertIsNone(media_preview.resolve_source_path("nope.png"))
        self.assertIsNone(media_preview.resolve_source_path(None))
        self.assertIsNone(
            media_preview.resolve_source_path(
                {"filename": "nope.png", "subfolder": "", "type": "input"}
            )
        )


class PromptReferenceTests(MediaPreviewTestCase):
    def build_prompt(self, widget_value):
        return {
            "1": {"class_type": "LoadImage", "inputs": {"image": widget_value}},
            "2": {"class_type": "WOSAI_ImageCompare", "inputs": {"image_a": ["1", 0]}},
        }

    def test_reference_is_recovered_from_the_upstream_loader(self):
        self.write_png("src.png")
        reference = media_preview.prompt_source_reference(
            self.build_prompt("src.png [input]"), 2, "image_a"
        )
        self.assertEqual(reference, {"filename": "src.png", "subfolder": "", "type": "input"})

    def test_returns_none_without_graph_context(self):
        self.assertIsNone(media_preview.prompt_source_reference(None, 2, "image_a"))
        self.assertIsNone(media_preview.prompt_source_reference(self.build_prompt("x.png"), None, "image_a"))
        self.assertIsNone(media_preview.prompt_source_reference(self.build_prompt("x.png"), 99, "image_a"))

    def test_returns_none_when_the_slot_is_not_linked(self):
        self.assertIsNone(media_preview.prompt_source_reference({}, 2, "image_b"))

    def test_returns_none_for_non_media_widget_values(self):
        self.assertIsNone(
            media_preview.prompt_source_reference(self.build_prompt(42), 2, "image_a")
        )


class ImagePreviewTests(MediaPreviewTestCase):
    def test_file_backed_image_is_referenced_without_writing_a_copy(self):
        self.write_png("direct.png", size=(64, 32))
        before = self.temp_listing()
        preview = media_preview.build_preview("direct.png [input]", "a")
        self.assertEqual(self.temp_listing(), before, "direct references must not create temp copies")
        self.assertEqual(preview["kind"], "image")
        self.assertEqual(preview["width"], 64)
        self.assertEqual(preview["height"], 32)
        self.assertEqual(preview["type"], "input")

    def test_prompt_reference_is_used_when_the_value_is_not_a_path(self):
        self.write_png("via_prompt.png", size=(20, 10))
        preview = media_preview.build_preview(
            StubTensor((1, 4, 4, 3)),
            "a",
            {"filename": "via_prompt.png", "subfolder": "", "type": "input"},
        )
        self.assertEqual(preview["kind"], "image")
        self.assertEqual(preview["filename"], "via_prompt.png")

    def test_batch_cap_and_payload_shape(self):
        written = []

        def fake_write(_tensor, side):
            written.append(side)
            return {"kind": "image", "filename": f"f{len(written)}.png", "subfolder": "", "type": "temp"}

        with mock.patch.object(media_preview, "_write_image_file", fake_write):
            preview = media_preview.save_image_preview(StubTensor((40, 4, 4, 3)), "a")

        self.assertEqual(len(written), media_preview.MAX_BATCH_PREVIEWS)
        self.assertEqual(preview["batch_size"], media_preview.MAX_BATCH_PREVIEWS)
        self.assertEqual(len(preview["batch"]), media_preview.MAX_BATCH_PREVIEWS)
        self.assertEqual(preview["batch_index"], 0)

    def test_single_frame_payload_has_no_batch_keys(self):
        with mock.patch.object(
            media_preview,
            "_write_image_file",
            lambda _t, _s: {"kind": "image", "filename": "only.png", "subfolder": "", "type": "temp"},
        ):
            preview = media_preview.save_image_preview(StubTensor((1, 4, 4, 3)), "b")
        self.assertNotIn("batch", preview)
        self.assertEqual(preview["filename"], "only.png")

    def test_write_failure_degrades_to_unknown(self):
        with mock.patch.object(media_preview, "_write_image_file", lambda _t, _s: None):
            self.assertEqual(
                media_preview.save_image_preview(StubTensor((1, 4, 4, 3)), "a"),
                {"kind": "unknown"},
            )


class VideoPreviewTests(MediaPreviewTestCase):
    def write_mp4(self, relative: str = "clip.mp4") -> Path:
        path = self.folders.dirs["output"] / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00\x00\x00\x18ftypmp42")
        return path

    def test_metadata_is_probed_with_safe_defaults(self):
        video = StubVideo(
            metadata={"dimensions": (1920, 1080), "frame_count": 240, "frame_rate": 24, "duration": 10}
        )
        self.assertEqual(
            media_preview.video_metadata(video),
            {
                "width": 1920,
                "height": 1080,
                "frame_count": 240,
                "frame_rate": 24.0,
                "duration": 10.0,
            },
        )
        self.assertEqual(media_preview.video_metadata(object())["width"], 0)

    def test_untrimmed_video_is_referenced_without_writing_a_copy(self):
        source = self.write_mp4()
        video = StubVideo(source=source, metadata={"dimensions": (640, 360), "duration": 5})
        before = self.temp_listing()
        preview = media_preview.save_video_preview(video, "a")
        self.assertEqual(self.temp_listing(), before, "direct references must not create temp copies")
        self.assertEqual(preview["kind"], "video")
        self.assertEqual(preview["type"], "output")
        self.assertEqual(preview["filename"], "clip.mp4")
        self.assertEqual(preview["width"], 640)
        self.assertEqual(preview["duration"], 5.0)

    def test_trimmed_video_falls_back_to_a_copy(self):
        source = self.write_mp4("trimmed.mp4")
        video = StubVideo(source=source, trim=(1.5, 3.0))
        preview = media_preview.save_video_preview(video, "b")
        self.assertEqual(preview["type"], "temp")
        self.assertEqual(preview["filename"].endswith(".mp4"), True)
        self.assertEqual(len(self.temp_listing()), 1)

    def test_unknown_trim_window_is_treated_as_trimmed(self):
        self.assertTrue(media_preview._has_active_trim(StubVideo(fail_trim=True)))
        self.assertFalse(media_preview._has_active_trim(StubVideo(trim=(0.0, 0.0))))
        self.assertFalse(media_preview._has_active_trim(object()))

    def test_missing_temp_directory_degrades_to_unknown(self):
        video = StubVideo(source=None)
        with mock.patch.object(media_preview, "_temp_directory", lambda: None):
            self.assertEqual(media_preview.save_video_preview(video, "a"), {"kind": "unknown"})


class ComparePayloadTests(MediaPreviewTestCase):
    def test_preserve_payload_when_both_sides_are_empty(self):
        payload = media_preview.build_compare_payload(None, None)
        self.assertTrue(payload["preserve"])
        self.assertIsNone(payload["a"])
        self.assertIsNone(payload["b"])
        self.assertEqual(payload["version"], media_preview.COMPARE_PAYLOAD_VERSION)

    def test_mixed_image_and_video_is_rejected(self):
        with self.assertRaises(TypeError):
            media_preview.build_compare_payload(StubTensor((1, 4, 4, 3)), StubVideo())

    def test_image_payload_keeps_the_legacy_field_names(self):
        self.write_png("left.png", size=(30, 20))
        self.write_png("right.png", size=(10, 40))
        payload = media_preview.build_compare_payload("left.png [input]", "right.png [input]")
        self.assertEqual(payload["kind"], "image")
        self.assertFalse(payload.get("preserve", False))
        for side, (width, height) in (("a", (30, 20)), ("b", (10, 40))):
            self.assertEqual(payload[side]["kind"], "image")
            self.assertEqual(payload[side]["width"], width)
            self.assertEqual(payload[side]["height"], height)
            # 旧前端只读这三个字段，必须保持不变
            self.assertIn("filename", payload[side])
            self.assertIn("subfolder", payload[side])
            self.assertIn("type", payload[side])

    def test_video_payload_declares_video_kind(self):
        source = self.write_mp4_placeholder()
        payload = media_preview.build_compare_payload(StubVideo(source=source), None)
        self.assertEqual(payload["kind"], "video")
        self.assertEqual(payload["a"]["kind"], "video")
        self.assertEqual(payload["b"], {"kind": "unknown"})

    def test_unresolvable_input_keeps_declared_kind_but_degrades_the_side(self):
        # 扩展名决定声明类型（前端据此选择视图），但文件已消失时该侧只能降级为
        # unknown 占位；两者语义不同，不能混为一谈。
        payload = media_preview.build_compare_payload("ghost.png", None)
        self.assertEqual(payload["kind"], "image")
        self.assertEqual(payload["a"], {"kind": "unknown"})

    def write_mp4_placeholder(self) -> Path:
        path = self.folders.dirs["output"] / "payload.mp4"
        path.write_bytes(b"\x00\x00\x00\x18ftypmp42")
        return path


if __name__ == "__main__":
    unittest.main()
