"""媒体预览载荷：把 IMAGE / VIDEO 输入解析为浏览器可直接引用的资源描述。

设计目标
--------
1. **优先直引、不落盘**：能在磁盘上定位到源文件时，直接给出 ComfyUI ``/view``
   所需的 ``{filename, subfolder, type}``，不在 temp 目录产生副本，同时保住原始
   分辨率、动画帧与元数据。
2. **鸭子类型判定**：不 import 只有新版宿主才有的 VIDEO 类型，只按公开方法名探测，
   低版本 ComfyUI 不会因为缺模块而加载失败。
3. **批次可控**：图像批次最多导出 :data:`MAX_BATCH_PREVIEWS` 帧供前端切换。
4. **可降级**：任何一步失败都退回「写 temp 副本」，最差退回 ``{"kind": "unknown"}``。

载荷结构（``ui.wosai_compare``）::

    {
      "version": 2,
      "kind": "image",
      "a": {"kind": "image", "filename": ..., "subfolder": ..., "type": "temp",
            "width": 1024, "height": 768},
      "b": {"kind": "video", "filename": ..., "subfolder": ..., "type": "output",
            "width": 1280, "height": 720, "frame_count": 240,
            "frame_rate": 24.0, "duration": 10.0}
    }

两侧都未连接时返回 ``{"version": 2, "preserve": True, "a": None, "b": None}``，
由前端决定是保留上一次预览还是清空（旧前端读到空值即清空，与既有行为一致）。
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif"}
)
VIDEO_EXTENSIONS = frozenset({".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".gif"})
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

MAX_BATCH_PREVIEWS = 10
COMPARE_PAYLOAD_VERSION = 2

MANAGED_TYPES = ("input", "output", "temp")

# 公开方法名探测：满足任意一个即认为是宿主的新版 VIDEO 对象。
_VIDEO_PROBE_METHODS = ("save_to", "get_components", "get_frame_rate", "get_duration")


def unknown_preview() -> dict[str, Any]:
    """空载荷。每次返回新 dict，避免调用方修改后污染其他分支。"""
    return {"kind": "unknown"}


# ── 宿主能力（延迟 import，保证无 ComfyUI 的单测环境仍可导入本模块） ──


def _folder_paths():
    import folder_paths

    return folder_paths


def managed_directories() -> tuple[tuple[str, Path], ...]:
    """按 ``input / output / temp`` 顺序返回已配置的托管目录。"""
    try:
        folder_paths = _folder_paths()
    except Exception:
        return ()
    directories: list[tuple[str, Path]] = []
    for type_name in MANAGED_TYPES:
        try:
            directory = folder_paths.get_directory_by_type(type_name)
        except Exception:
            continue
        if directory:
            directories.append((type_name, Path(directory)))
    return tuple(directories)


def _temp_directory() -> Path | None:
    try:
        return Path(_folder_paths().get_temp_directory())
    except Exception:
        return None


# ── 类型判定 ──


def _is_image_tensor(value: Any) -> bool:
    if not (hasattr(value, "shape") and hasattr(value, "detach")):
        return False
    shape = tuple(value.shape)
    return len(shape) in (3, 4) and shape[-1] in (1, 3, 4)


def _suffix_of(value: Any) -> str:
    """从路径 / widget 值 / 字典里取小写扩展名。

    ComfyUI 的 loader widget 值可能带 ``[input]`` 这类目录标注，先按 ``[`` 截断。
    """
    if isinstance(value, (str, os.PathLike)):
        raw = str(value)
    elif isinstance(value, dict):
        raw = str(value.get("filename") or value.get("path") or value.get("file") or "")
    else:
        return ""
    if not raw:
        return ""
    return Path(raw.split("[")[0].strip()).suffix.lower()


def media_kind(value: Any) -> str:
    """返回 ``"image"`` / ``"video"`` / ``"unknown"``。"""
    if value is None:
        return "unknown"
    if _is_image_tensor(value):
        return "image"
    if any(callable(getattr(value, name, None)) for name in _VIDEO_PROBE_METHODS):
        return "video"
    suffix = _suffix_of(value)
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    return "unknown"


def image_batch_size(value: Any) -> int:
    if not hasattr(value, "shape"):
        return 0
    shape = tuple(value.shape)
    if len(shape) == 4 and shape[-1] in (1, 3, 4):
        return int(shape[0])
    if len(shape) == 3 and shape[-1] in (1, 3, 4):
        return 1
    return 0


# ── 磁盘定位与 /view 引用 ──


def resolve_source_path(value: Any) -> Path | None:
    """把输入解析为磁盘上真实存在的文件；解析不出来返回 ``None``。"""
    if value is None:
        return None
    if isinstance(value, (str, os.PathLike)):
        return _resolve_path_string(str(value))
    if isinstance(value, dict):
        for key in ("path", "file", "file_path"):
            raw = value.get(key)
            if isinstance(raw, (str, os.PathLike)):
                found = _resolve_path_string(str(raw))
                if found is not None:
                    return found
        filename = value.get("filename")
        if filename:
            try:
                base = _folder_paths().get_directory_by_type(str(value.get("type") or "temp"))
            except Exception:
                base = None
            if base:
                candidate = Path(base) / str(value.get("subfolder") or "") / str(filename)
                if candidate.is_file():
                    return candidate
        return None
    for name in ("path", "file_path", "filename", "get_stream_source"):
        raw = getattr(value, name, None)
        if callable(raw):
            try:
                raw = raw()
            except Exception:
                continue
        if isinstance(raw, (str, os.PathLike)):
            found = _resolve_path_string(str(raw))
            if found is not None:
                return found
    return None


def _resolve_path_string(raw: str) -> Path | None:
    if not raw:
        return None
    try:
        filename, base = _folder_paths().annotated_filepath(raw)
    except Exception:
        filename, base = raw, None
    if base:
        candidate = Path(base) / filename
        return candidate if candidate.is_file() else None
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate if candidate.is_file() else None
    for _, directory in managed_directories():
        probe = directory / raw
        if probe.is_file():
            return probe
    return None


def reference_for_path(path: Path | None) -> dict[str, Any] | None:
    """把托管目录内的文件转成 ``/view`` 引用；不在托管目录内返回 ``None``。

    与「扫描同名文件」的做法不同，这里只做确定性映射：引用里带上 ``type`` 与
    ``subfolder``，``/view`` 解析结果唯一，且不需要遍历目录（大文件夹下开销可观）。
    """
    if path is None:
        return None
    for type_name, directory in managed_directories():
        try:
            relative = path.resolve().relative_to(directory.resolve())
        except (OSError, ValueError):
            continue
        parent = relative.parent.as_posix()
        return {
            "filename": relative.name,
            "subfolder": "" if parent in ("", ".") else parent,
            "type": type_name,
        }
    return None


# ── 沿执行图反查上游文件引用 ──


def _prompt_node(prompt: Any, node_id: Any) -> dict[str, Any] | None:
    if not isinstance(prompt, dict) or node_id is None:
        return None
    for key in (str(node_id), node_id):
        candidate = prompt.get(key)
        if isinstance(candidate, dict):
            return candidate
    return None


def prompt_source_reference(prompt: Any, unique_id: Any, slot: str) -> dict[str, Any] | None:
    """反查本节点 ``slot`` 输入的上游节点，尝试拿到可直引的文件引用。

    只用于「输入本来就是磁盘上的文件」的情况（如 LoadImage / 视频加载器），
    命中即可省掉一次 temp 副本；未命中返回 ``None``，由调用方回退到落盘。
    """
    current = _prompt_node(prompt, unique_id)
    if current is None:
        return None
    raw_input = (current.get("inputs") or {}).get(slot)
    if not isinstance(raw_input, (list, tuple)) or not raw_input:
        return None
    upstream = _prompt_node(prompt, raw_input[0])
    if upstream is None:
        return None
    inputs = upstream.get("inputs") or {}
    ordered: list[Any] = [inputs.get(key) for key in ("image", "video", "file", "filename", "path")]
    ordered.extend(value for value in inputs.values() if not isinstance(value, (list, tuple, dict)))
    for candidate in ordered:
        if not isinstance(candidate, (str, os.PathLike)):
            continue
        if _suffix_of(candidate) not in MEDIA_EXTENSIONS:
            continue
        found = _resolve_path_string(str(candidate))
        if found is None:
            continue
        reference = reference_for_path(found)
        if reference is not None:
            return reference
    return None


# ── 图像：写 temp 副本（仅在前两条路都走不通时） ──


def _write_image_file(tensor: Any, side: str) -> dict[str, Any] | None:
    # 预览是尽力而为的能力：缺 numpy / Pillow、图像尺寸异常、temp 目录不可写时
    # 一律降级为 None（调用方回退到 unknown 占位），绝不因为预览失败而中断执行。
    try:
        import numpy as np
        from PIL import Image
    except Exception:
        return None

    directory = _temp_directory()
    if directory is None:
        return None
    try:
        frame = tensor.detach().cpu().float().numpy()
        frame = np.nan_to_num(frame, nan=0.0, posinf=1.0, neginf=0.0)
        frame = np.clip(frame * 255.0, 0.0, 255.0).astype(np.uint8)
        if frame.ndim == 3 and frame.shape[-1] == 1:
            frame = frame[..., 0]
        filename = f"wosai_compare_{side}_{uuid.uuid4().hex}.png"
        Image.fromarray(frame).save(directory / filename, compress_level=4)
    except Exception:
        return None
    return {
        "kind": "image",
        "filename": filename,
        "subfolder": "",
        "type": "temp",
        "width": int(frame.shape[1]),
        "height": int(frame.shape[0]),
    }


def save_image_preview(value: Any, side: str) -> dict[str, Any]:
    """把 IMAGE 张量写成 temp PNG；批次最多写 :data:`MAX_BATCH_PREVIEWS` 帧。

    只接受图像张量。路径类输入若无法直引（文件已被移动或删除），宁可回退到
    unknown 占位，也不要把它当作张量去解码。
    """
    if not _is_image_tensor(value):
        return unknown_preview()
    batch = value if len(tuple(value.shape)) == 4 else value.unsqueeze(0)
    previews: list[dict[str, Any]] = []
    for item in batch[:MAX_BATCH_PREVIEWS]:
        written = _write_image_file(item, side)
        if written is None:
            break
        previews.append(written)
    if not previews:
        return unknown_preview()
    if len(previews) == 1:
        return previews[0]
    return {
        **previews[0],
        "batch": previews,
        "batch_size": len(previews),
        "batch_index": 0,
    }


def _read_image_size(reference: dict[str, Any]) -> tuple[int, int] | None:
    try:
        directory = _folder_paths().get_directory_by_type(str(reference.get("type") or "temp"))
    except Exception:
        return None
    if not directory:
        return None
    path = Path(directory) / str(reference.get("subfolder") or "") / str(reference["filename"])
    try:
        from PIL import Image

        with Image.open(path) as image:
            return int(image.width), int(image.height)
    except Exception:
        return None


# ── 视频：优先直引，其次拷贝，最后转码 ──


def video_metadata(value: Any) -> dict[str, Any]:
    """探测视频元数据；宿主未实现的方法一律降级为 0，不影响预览可用性。"""
    metadata: dict[str, Any] = {
        "width": 0,
        "height": 0,
        "frame_count": 0,
        "frame_rate": 0.0,
        "duration": 0.0,
    }
    dimensions = _probe(value, "get_dimensions", (0, 0))
    try:
        metadata["width"], metadata["height"] = int(dimensions[0]), int(dimensions[1])
    except Exception:
        pass
    for key, method, cast in (
        ("frame_count", "get_frame_count", int),
        ("frame_rate", "get_frame_rate", float),
        ("duration", "get_duration", float),
    ):
        try:
            metadata[key] = cast(_probe(value, method, 0))
        except Exception:
            pass
    return metadata


def _probe(value: Any, name: str, default: Any) -> Any:
    method = getattr(value, name, None)
    if not callable(method):
        return default
    try:
        return method()
    except Exception:
        return default


def _stream_source(value: Any) -> Path | None:
    getter = getattr(value, "get_stream_source", None)
    if not callable(getter):
        return None
    try:
        raw = getter()
    except Exception:
        return None
    if isinstance(raw, (str, os.PathLike)):
        candidate = Path(raw)
        if candidate.is_file():
            return candidate
    return None


def _has_active_trim(value: Any) -> bool:
    """被裁剪过的 VIDEO 不能直引原文件——浏览器会放出裁剪窗口之外的帧。"""
    window = getattr(value, "get_active_trim_window", None)
    if not callable(window):
        return False
    try:
        start, duration = window()
        return abs(float(start)) > 1e-9 or abs(float(duration)) > 1e-9
    except Exception:
        # 探测失败时按「有裁剪」处理，宁可多写一份副本也不放错帧。
        return True


def _copy_file(source: Path, target: Path) -> None:
    with open(source, "rb") as reader, open(target, "wb") as writer:
        while True:
            chunk = reader.read(1024 * 1024)
            if not chunk:
                break
            writer.write(chunk)


def _export_video(value: Any, save_to: Any, target: Path) -> None:
    """优先请求浏览器友好的 MP4 / H.264，宿主不支持该参数时退回按后缀推断。"""
    try:
        from comfy_api.latest._util.video_types import VideoCodec, VideoContainer
    except Exception:
        save_to(str(target))
        return
    try:
        save_to(str(target), format=VideoContainer.MP4, codec=VideoCodec.H264)
    except (TypeError, AttributeError, ValueError):
        save_to(str(target))


def save_video_preview(value: Any, side: str) -> dict[str, Any]:
    metadata = video_metadata(value)
    source = resolve_source_path(value) or _stream_source(value)
    if source is not None and not _has_active_trim(value):
        reference = reference_for_path(source)
        if reference is not None:
            return {"kind": "video", **reference, **metadata}
    directory = _temp_directory()
    if directory is None:
        return unknown_preview()
    filename = f"wosai_compare_{side}_{uuid.uuid4().hex}.mp4"
    target = directory / filename
    try:
        if source is not None:
            _copy_file(source, target)
        else:
            save_to = getattr(value, "save_to", None)
            if not callable(save_to):
                return unknown_preview()
            _export_video(value, save_to, target)
    except Exception:
        return unknown_preview()
    return {
        "kind": "video",
        "filename": filename,
        "subfolder": "",
        "type": "temp",
        **metadata,
    }


# ── 对外入口 ──


def build_preview(value: Any, side: str, reference: dict[str, Any] | None = None) -> dict[str, Any]:
    """构造单侧载荷。``reference`` 是执行图反查得到的直引候选。"""
    if value is None:
        return unknown_preview()
    kind = media_kind(value)
    if kind == "video":
        return save_video_preview(value, side)
    if kind != "image":
        return unknown_preview()
    if image_batch_size(value) > 1:
        return save_image_preview(value, side)
    source = resolve_source_path(value)
    direct = reference_for_path(source) if source is not None else None
    direct = direct or reference
    if direct is not None:
        size = _read_image_size(direct)
        if size is not None:
            return {"kind": "image", **direct, "width": size[0], "height": size[1]}
    return save_image_preview(value, side)


def build_compare_payload(
    media_a: Any,
    media_b: Any,
    prompt: Any = None,
    unique_id: Any = None,
) -> dict[str, Any]:
    """构造 ``ui.wosai_compare`` 载荷。"""
    if media_a is None and media_b is None:
        return {
            "version": COMPARE_PAYLOAD_VERSION,
            "preserve": True,
            "kind": "unknown",
            "a": None,
            "b": None,
        }

    kinds = {"image": 0, "video": 0}
    for value in (media_a, media_b):
        kind = media_kind(value)
        if kind in kinds:
            kinds[kind] += 1
    if kinds["image"] and kinds["video"]:
        raise TypeError("WOSAI ImageCompare：两侧输入必须同为图像或同为视频，不支持混合。")

    return {
        "version": COMPARE_PAYLOAD_VERSION,
        "kind": "video" if kinds["video"] else ("image" if kinds["image"] else "unknown"),
        "a": build_preview(media_a, "a", prompt_source_reference(prompt, unique_id, "image_a")),
        "b": build_preview(media_b, "b", prompt_source_reference(prompt, unique_id, "image_b")),
    }
