import importlib.util
import logging
import sys
import threading
from pathlib import Path

logger = logging.getLogger(__name__)


class Registry:
    NODE_CLASS_MAPPINGS: dict = {}
    NODE_DISPLAY_NAME_MAPPINGS: dict = {}
    _lock: threading.Lock = threading.Lock()

    @classmethod
    def discover_nodes(cls, nodes_dir: Path) -> None:
        """Scan nodes/ directory and auto-register all node classes.

        On hot-reload (ComfyUI --watch), mappings are cleared before each
        discovery pass to prevent duplicate entries from accumulating.
        Thread-safe via cls._lock.
        """
        if not nodes_dir.is_dir():
            return

        # Ensure project root is on sys.path so node files can use
        # absolute imports like `from wosai_core.config import CATEGORY_PREFIX`
        project_root = str(nodes_dir.parent.absolute())
        path_inserted = False
        if project_root not in sys.path:
            sys.path.insert(0, project_root)
            path_inserted = True

        discovered: dict = {}
        displayed: dict = {}
        failures: list[str] = []

        try:
            # Heavy module imports (may pull in torch) run OUTSIDE the lock so a
            # hot-reload never blocks the server thread for their duration. Only
            # the final swap of the shared mappings is guarded by the lock.
            for file_path in sorted(nodes_dir.rglob("*.py")):
                if file_path.name == "__init__.py":
                    continue
                # Skip __pycache__ directories
                if "__pycache__" in file_path.parts:
                    continue

                # Use posix path for cross-platform module name
                rel = file_path.relative_to(nodes_dir.parent)
                module_name = str(rel.with_suffix("")).replace("\\", ".").replace("/", ".")

                spec = importlib.util.spec_from_file_location(module_name, file_path)
                if spec is None or spec.loader is None:
                    continue

                # Register in sys.modules to prevent duplicate execution
                if module_name in sys.modules:
                    mod = sys.modules[module_name]
                else:
                    mod = importlib.util.module_from_spec(spec)
                    sys.modules[module_name] = mod

                try:
                    spec.loader.exec_module(mod)
                except Exception as e:  # import-time fatal errors must be visible
                    logger.error("Failed to load node module %s: %s", file_path.name, e)
                    failures.append(file_path.name)
                    continue
                if hasattr(mod, "NODE_CLASS_MAPPINGS"):
                    discovered.update(mod.NODE_CLASS_MAPPINGS)
                if hasattr(mod, "NODE_DISPLAY_NAME_MAPPINGS"):
                    displayed.update(mod.NODE_DISPLAY_NAME_MAPPINGS)

            with cls._lock:
                cls.NODE_CLASS_MAPPINGS.clear()
                cls.NODE_CLASS_MAPPINGS.update(discovered)
                cls.NODE_DISPLAY_NAME_MAPPINGS.clear()
                cls.NODE_DISPLAY_NAME_MAPPINGS.update(displayed)
        finally:
            if path_inserted:
                try:
                    sys.path.remove(project_root)
                except ValueError:
                    pass

        if failures:
            logger.error(
                "WOSAI node discovery finished with %d failed module(s): %s",
                len(failures), ", ".join(failures),
            )
