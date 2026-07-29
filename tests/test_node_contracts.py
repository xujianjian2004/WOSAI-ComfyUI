"""Static contract checks for every WOSAI backend node."""

from __future__ import annotations

import importlib
import inspect
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INPUT_GROUPS = {"required", "optional", "hidden"}


def _node_modules():
    for file_path in sorted((ROOT / "nodes").glob("*.py")):
        if file_path.name == "__init__.py":
            continue
        try:
            yield importlib.import_module(f"nodes.{file_path.stem}")
        except ModuleNotFoundError as error:
            # Torch and other host modules are supplied by ComfyUI. A minimal
            # packaging environment still validates every importable node; the
            # ComfyUI smoke lane validates the complete catalogue.
            if error.name not in {"torch", "comfy_execution"}:
                raise


class NodeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.modules = list(_node_modules())

    def test_node_mapping_keys_are_unique_across_modules(self):
        owners = {}
        for module in self.modules:
            for node_name in getattr(module, "NODE_CLASS_MAPPINGS", {}):
                self.assertNotIn(
                    node_name,
                    owners,
                    f"{node_name} is declared by both {owners.get(node_name)} and {module.__name__}",
                )
                owners[node_name] = module.__name__
        self.assertGreaterEqual(len(owners), 8)

    def test_display_names_match_registered_node_keys(self):
        for module in self.modules:
            classes = set(getattr(module, "NODE_CLASS_MAPPINGS", {}))
            display_names = set(getattr(module, "NODE_DISPLAY_NAME_MAPPINGS", {}))
            self.assertEqual(
                classes,
                display_names,
                f"{module.__name__} display-name mapping must match class mapping",
            )

    def test_registered_nodes_expose_valid_comfyui_contracts(self):
        for module in self.modules:
            for node_name, node_class in getattr(module, "NODE_CLASS_MAPPINGS", {}).items():
                with self.subTest(node=node_name):
                    self.assertTrue(inspect.isclass(node_class))
                    self.assertTrue(callable(getattr(node_class, "INPUT_TYPES", None)))
                    inputs = node_class.INPUT_TYPES()
                    self.assertIsInstance(inputs, dict)
                    self.assertFalse(set(inputs) - INPUT_GROUPS)

                    input_names = []
                    for group_name, group in inputs.items():
                        self.assertIsInstance(group, dict, f"{node_name}.{group_name}")
                        for parameter_name, specification in group.items():
                            self.assertIsInstance(parameter_name, str)
                            self.assertTrue(parameter_name)
                            if group_name == "hidden" and isinstance(specification, str):
                                self.assertTrue(specification)
                            else:
                                self.assertIsInstance(specification, (tuple, list))
                                self.assertGreater(len(specification), 0)
                            input_names.append(parameter_name)
                    self.assertEqual(
                        len(input_names),
                        len(set(input_names)),
                        f"{node_name} repeats an input parameter name",
                    )

                    function_name = getattr(node_class, "FUNCTION", None)
                    self.assertIsInstance(function_name, str)
                    self.assertTrue(callable(getattr(node_class, function_name, None)))

                    return_types = getattr(node_class, "RETURN_TYPES", None)
                    self.assertIsInstance(return_types, tuple)
                    return_names = getattr(node_class, "RETURN_NAMES", None)
                    if return_names is not None:
                        self.assertIsInstance(return_names, tuple)
                        self.assertEqual(len(return_names), len(return_types))

                    category = getattr(node_class, "CATEGORY", None)
                    self.assertIsInstance(category, str)
                    self.assertTrue(category.strip())


if __name__ == "__main__":
    unittest.main()
