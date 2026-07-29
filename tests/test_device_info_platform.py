"""Platform launcher contracts for the DeviceInfo directory action."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from wosai_core import device_info


class DeviceInfoDirectoryLauncherTests(unittest.TestCase):
    def setUp(self):
        self.path = Path("C:/ComfyUI/output")

    def test_windows_uses_startfile_without_a_shell(self):
        with (
            patch.object(device_info.sys, "platform", "win32"),
            patch.object(device_info.os, "startfile", create=True) as startfile,
            patch.object(device_info.subprocess, "Popen") as popen,
        ):
            device_info._open_directory(self.path)

        startfile.assert_called_once_with(str(self.path))
        popen.assert_not_called()

    def test_macos_and_linux_use_argument_arrays(self):
        for platform, executable in (("darwin", "open"), ("linux", "xdg-open")):
            with self.subTest(platform=platform):
                with (
                    patch.object(device_info.sys, "platform", platform),
                    patch.object(device_info.subprocess, "Popen") as popen,
                ):
                    device_info._open_directory(self.path)

                popen.assert_called_once_with([executable, str(self.path)])


if __name__ == "__main__":
    unittest.main()
