import importlib.util
import sys
from pathlib import Path


class Registry:
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}

    @classmethod
    def discover_nodes(cls, nodes_dir: Path):
        """Scan nodes/ directory and auto-register all node classes.

        On hot-reload (ComfyUI --watch), mappings are cleared before each
        discovery pass to prevent duplicate entries from accumulating.
        """
        if not nodes_dir.is_dir():
            return

        # Ensure project root is on sys.path so node files can use
        # absolute imports like `from wosai_core.config import CATEGORY_PREFIX`
        project_root = str(nodes_dir.parent.absolute())
        if project_root not in sys.path:
            sys.path.insert(0, project_root)

        # Reset on re-scan (hot-reload safety)
        cls.NODE_CLASS_MAPPINGS.clear()
        cls.NODE_DISPLAY_NAME_MAPPINGS.clear()

        for file_path in sorted(nodes_dir.rglob("*.py")):
            if file_path.name == "__init__.py":
                continue
            # Skip __pycache__ and other dunder dirs/files
            if any(p.startswith("__") for p in file_path.parts):
                continue

            rel = file_path.relative_to(nodes_dir.parent)
            module_name = str(rel.with_suffix("")).replace("\\", ".").replace("/", ".")

            spec = importlib.util.spec_from_file_location(module_name, file_path)
            if spec is None or spec.loader is None:
                continue

            try:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                if hasattr(mod, "NODE_CLASS_MAPPINGS"):
                    cls.NODE_CLASS_MAPPINGS.update(mod.NODE_CLASS_MAPPINGS)
                if hasattr(mod, "NODE_DISPLAY_NAME_MAPPINGS"):
                    cls.NODE_DISPLAY_NAME_MAPPINGS.update(mod.NODE_DISPLAY_NAME_MAPPINGS)
            except Exception as e:
                print(f"[WOSAI-ComfyUI] Failed to load {file_path.name}: {e}")
