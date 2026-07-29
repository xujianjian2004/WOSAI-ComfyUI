"""Fault-isolated environment and hardware diagnostics for the WOSAI device panel."""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Callable

from wosai_core.http_security import is_same_origin_request


_CACHE_TTLS = {"static": 300.0, "gpu": 60.0, "paths": 30.0}
_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = Lock()
_IMPORTANT_PACKAGES = ("torch", "torchvision", "xformers", "transformers", "diffusers", "opencv-python")
_REQUIRED_PACKAGES = ("torch",)
_LOGGER = logging.getLogger(__name__)


def _ok(value: Any) -> dict[str, Any]:
    return {"value": value, "status": "ok"}


def _error(error: Exception | str, fallback: str = "") -> dict[str, Any]:
    return {"value": None, "status": "error", "error": str(error), "fallback": fallback}


def _cached(name: str, factory: Callable[[], Any], force: bool = False) -> Any:
    ttl = _CACHE_TTLS[name]
    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(name)
        if not force and entry and now - entry[0] < ttl:
            return entry[1]
    value = factory()
    with _cache_lock:
        _cache[name] = (now, value)
    return value


def _run(command: list[str], timeout: int = 4) -> str | None:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _format_bytes(value: float | int | None) -> str | None:
    if value is None:
        return None
    value = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if abs(value) < 1024 or unit == "PB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} {unit}"
        value /= 1024
    return None


def _safe(call: Callable[[], Any], fallback: str = "") -> dict[str, Any]:
    try:
        return _ok(call())
    except Exception as error:  # diagnostics must never make ComfyUI unavailable
        return _error(error, fallback)


def _collect_static() -> dict[str, Any]:
    return {
        "system": _system_info(),
        "runtime": _runtime_info(),
        "comfyui": _comfyui_info(),
        "dependencies": _dependencies(),
        "network": _network_info(),
    }


def _system_info() -> dict[str, Any]:
    system = platform.system()
    release = platform.release()
    edition = ""
    if system == "Windows":
        try:
            edition = platform.win32_edition()
        except Exception:
            pass
    return {
        "os": _ok(" ".join(part for part in (system, release, edition) if part)),
        "machine": _ok(platform.machine() or "Unknown"),
        "cpu": _ok(_cpu_description()),
        "python": _ok(platform.python_version()),
        "executable": _ok(Path(sys.executable).name),
    }


def _cpu_description() -> str:
    """Return the user-facing CPU model, not the Windows architecture identifier."""
    if platform.system() == "Windows":
        try:
            import winreg

            key_path = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as key:
                name = str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
                mhz = float(winreg.QueryValueEx(key, "~MHz")[0])
            return f"{name} ({mhz / 1000:.2f} GHz)" if name and mhz > 0 else name
        except (ImportError, OSError, ValueError):
            pass
    return platform.processor() or platform.machine() or "Unknown"


def _redacted_arguments(arguments: list[str]) -> list[str]:
    """Expose flag names without leaking local paths, tokens, or values."""

    redacted = []
    for argument in arguments:
        if argument.startswith("-"):
            if "=" in argument:
                name, _ = argument.split("=", 1)
                redacted.append(f"{name}=<value>")
            else:
                redacted.append(argument)
        else:
            redacted.append("<value>")
    return redacted


def _runtime_info() -> dict[str, Any]:
    data: dict[str, Any] = {"arguments": _ok(_redacted_arguments(sys.argv[1:]))}
    try:
        import torch

        data.update({
            "pytorch": _ok(torch.__version__),
            "cuda_runtime": _ok(torch.version.cuda or "Not available"),
            "cudnn": _ok(torch.backends.cudnn.version() or "Not available"),
        })
    except Exception as error:
        data.update({
            "pytorch": _error(error, "PyTorch is not available in this environment."),
            "cuda_runtime": _error(error),
            "cudnn": _error(error),
        })
    return data


def _comfyui_root() -> Path:
    """Resolve the ComfyUI install root without relying on a fixed directory depth.

    Prefers the path exposed by ComfyUI's own ``folder_paths`` module; falls back
    to the historical ``parents[3]`` anchor so behaviour is unchanged when that
    module is unavailable (e.g. during isolated unit tests).
    """
    try:
        import folder_paths

        return Path(folder_paths.__file__).resolve().parent.parent
    except Exception:
        return Path(__file__).resolve().parents[3]


def _comfyui_info() -> dict[str, Any]:
    root = _comfyui_root()
    version = None
    for name in ("comfyui_version.py", "VERSION"):
        candidate = root / name
        if candidate.is_file():
            try:
                version = candidate.read_text(encoding="utf-8").strip()[:200]
                break
            except OSError:
                pass
    if not version:
        version = _run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"])
    return {
        "root": _ok(str(root)),
        "version": _ok(version or "Unknown"),
        "git": _ok(_git_version() or "Unknown"),
    }


def _git_version() -> str | None:
    output = _run(["git", "--version"])
    match = re.search(r"\d+\.\d+(?:\.\d+)?", output or "")
    return match.group(0) if match else None


def _dependencies() -> dict[str, Any]:
    import importlib.metadata

    found: dict[str, Any] = {}
    for package in _IMPORTANT_PACKAGES:
        try:
            found[package] = _ok(importlib.metadata.version(package))
        except importlib.metadata.PackageNotFoundError:
            found[package] = {"value": "Not installed", "status": "missing"}
    return found


def _network_info() -> dict[str, Any]:
    values = {key.lower(): os.environ.get(key) for key in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY")}
    return {key: _ok("Set" if value else "Not set") for key, value in values.items()}


def _collect_gpu(force: bool = False) -> list[dict[str, Any]]:
    def factory() -> list[dict[str, Any]]:
        try:
            import torch
            if not torch.cuda.is_available():
                return [{"id": 0, "name": _ok("CUDA not available"), "status": "unavailable"}]
            smi_rows = _nvidia_smi()
            result: list[dict[str, Any]] = []
            for index in range(torch.cuda.device_count()):
                properties = torch.cuda.get_device_properties(index)
                smi = smi_rows[index] if index < len(smi_rows) else {}
                result.append({
                    "id": index,
                    "name": _ok(torch.cuda.get_device_name(index)),
                    "total": _ok(_format_bytes(smi.get("memory_total_mib", 0) * 1024 * 1024) if smi else _format_bytes(properties.total_memory)),
                    "pytorch_allocated": _ok(_format_bytes(torch.cuda.memory_allocated(index))),
                    "pytorch_reserved": _ok(_format_bytes(torch.cuda.memory_reserved(index))),
                    "smi_used": _ok(_format_bytes(smi.get("memory_used_mib", 0) * 1024 * 1024) if smi else None),
                    "smi_free": _ok(_format_bytes((smi.get("memory_total_mib", 0) - smi.get("memory_used_mib", 0)) * 1024 * 1024) if smi else None),
                    "temperature": _ok(f"{smi['temperature_c']} °C" if smi.get("temperature_c") is not None else None),
                    "power": _ok(f"{smi['power_w']} W" if smi.get("power_w") is not None else None),
                    "driver": _ok(smi.get("driver") or "Unknown"),
                    "status": "ok",
                })
            return result
        except Exception as error:
            return [{"id": 0, "name": _error(error, "GPU details are unavailable."), "status": "error"}]
    return _cached("gpu", factory, force)


def _nvidia_smi() -> list[dict[str, Any]]:
    output = _run([
        "nvidia-smi",
        "--query-gpu=memory.used,memory.total,temperature.gpu,power.draw,driver_version",
        "--format=csv,noheader,nounits",
    ])
    if not output:
        return []
    records = []
    for row in output.splitlines():
        parts = [part.strip() for part in row.split(",")]
        if len(parts) != 5:
            continue
        records.append({
            "memory_used_mib": float(parts[0]) if parts[0] != "[N/A]" else 0,
            "memory_total_mib": float(parts[1]) if parts[1] != "[N/A]" else 0,
            "temperature_c": float(parts[2]) if parts[2] != "[N/A]" else None,
            "power_w": float(parts[3]) if parts[3] != "[N/A]" else None,
            "driver": parts[4],
        })
    return records


def _collect_dynamic(force: bool = False) -> dict[str, Any]:
    memory: dict[str, Any]
    try:
        import psutil
        stats = psutil.virtual_memory()
        memory = {"used": _ok(_format_bytes(stats.used)), "total": _ok(_format_bytes(stats.total)), "available": _ok(_format_bytes(stats.available)), "percent": _ok(stats.percent)}
    except Exception as error:
        memory = {"used": _error(error), "total": _error(error), "available": _error(error), "percent": _error(error)}
    return {"gpus": _collect_gpu(force), "memory": memory, "disks": _disks()}


def _paths() -> dict[str, Any]:
    try:
        import folder_paths
        root = Path(folder_paths.__file__).resolve().parent.parent
        entries: dict[str, Any] = {
            "comfyui": str(root),
            "user": folder_paths.get_user_directory(),
            "input": folder_paths.get_input_directory(),
            "output": folder_paths.get_output_directory(),
            "temp": folder_paths.get_temp_directory(),
        }
        for model_type in ("checkpoints", "loras", "vae", "unet", "text_encoders", "controlnet"):
            entries[f"models_{model_type}"] = folder_paths.get_folder_paths(model_type)
        return {key: _path_state(value) for key, value in entries.items()}
    except Exception as error:
        return {"comfyui": _error(error, "ComfyUI folder paths are unavailable.")}


def _path_state(value: Any) -> dict[str, Any]:
    values = value if isinstance(value, list) else [value]
    states = []
    seen: set[str] = set()
    for raw in values:
        path = Path(raw)
        if not path.is_dir():
            continue
        resolved = path.resolve()
        identity = os.path.normcase(str(resolved))
        if identity in seen:
            continue
        seen.add(identity)
        states.append({"path": str(resolved), "exists": True, "writable": os.access(resolved, os.W_OK)})
    return _ok(states)


def _known_path(key: str, index: int) -> Path | None:
    """Resolve only a directory reported by the collector; never accept raw paths."""
    entry = _cached("paths", _paths).get(key, {})
    values = entry.get("value", []) if isinstance(entry, dict) else []
    if not isinstance(index, int) or index < 0 or index >= len(values):
        return None
    try:
        candidate = Path(values[index]["path"]).resolve(strict=True)
        return candidate if candidate.is_dir() else None
    except (KeyError, OSError, RuntimeError):
        return None


def _open_directory(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(str(path))  # type: ignore[attr-defined]  # Windows-only API
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def _disks() -> list[dict[str, Any]]:
    paths = _cached("paths", _paths)
    seen: set[str] = set()
    disks = []
    for item in paths.values():
        if item.get("status") != "ok":
            continue
        for entry in item["value"]:
            path = entry["path"]
            try:
                drive = Path(path).anchor or path
                if drive in seen:
                    continue
                seen.add(drive)
                usage = shutil.disk_usage(path)
                disks.append({"path": drive, "used": _ok(_format_bytes(usage.used)), "total": _ok(_format_bytes(usage.total)), "free": _ok(_format_bytes(usage.free)), "percent": _ok(round(usage.used / usage.total * 100, 1))})
            except OSError:
                continue
    return disks


def _health(data: dict[str, Any]) -> dict[str, Any]:
    score = 100
    issues: list[str] = []
    for disk in data["dynamic"]["disks"]:
        if disk["percent"]["value"] >= 90:
            score -= 20
            issues.append("disk_low")
    gpus = data["dynamic"]["gpus"]
    if gpus and gpus[0].get("status") == "unavailable":
        issues.append("cuda_unavailable")
    if any(data["static"]["dependencies"].get(package, {}).get("status") == "missing" for package in _REQUIRED_PACKAGES):
        score -= 5
        issues.append("dependency_missing")
    return {"score": max(score, 0), "issues": issues}


def collect_device_info(force: bool = False, dynamic_force: bool = False) -> dict[str, Any]:
    static = _cached("static", _collect_static, force)
    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "static": static,
        "dynamic": _collect_dynamic(dynamic_force),
        "paths": _cached("paths", _paths, force),
    }
    data["health"] = _health(data)
    return data


def setup_routes() -> None:
    """Register once with ComfyUI's native aiohttp route table."""
    from aiohttp import web
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.get("/wosai/device_info")
    async def wosai_device_info(request: Any) -> web.Response:
        refresh = request.rel_url.query.get("refresh", "")
        force = refresh == "all"
        dynamic_force = refresh in {"all", "dynamic"}
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, collect_device_info, force, dynamic_force)
            return web.json_response(result)
        except Exception:
            _LOGGER.exception("Failed to collect WOSAI device information")
            return web.json_response({"error": "could not collect device information"}, status=500)

    @routes.post("/wosai/device_info/open_path")
    async def wosai_open_device_path(request: Any) -> web.Response:
        if not is_same_origin_request(request):
            return web.json_response({"error": "cross-origin request rejected"}, status=403)
        try:
            body = await request.json()
            key = body.get("key", "") if isinstance(body, dict) else ""
            index = int(body.get("index", -1)) if isinstance(body, dict) else -1
            path = _known_path(key, index)
            if not path:
                return web.json_response({"error": "Unknown or unavailable directory."}, status=404)
            _open_directory(path)
            return web.json_response({"path": str(path)})
        except (TypeError, ValueError):
            return web.json_response({"error": "invalid request"}, status=400)
        except Exception:
            _LOGGER.exception("Failed to open a WOSAI device path")
            return web.json_response({"error": "could not open directory"}, status=500)
