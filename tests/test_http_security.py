"""Tests for browser-origin and device-report redaction boundaries."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from wosai_core.device_info import _network_info, _redacted_arguments
from wosai_core.http_security import is_same_origin_request


class _Request:
    def __init__(self, headers=None, host="127.0.0.1:8188"):
        self.headers = headers or {}
        self.host = host


class HttpSecurityTests(unittest.TestCase):
    def test_allows_same_origin_browser_request(self):
        request = _Request({"Origin": "http://127.0.0.1:8188", "Sec-Fetch-Site": "same-origin"})
        self.assertTrue(is_same_origin_request(request))

    def test_rejects_cross_site_browser_request(self):
        request = _Request({"Origin": "https://example.invalid", "Sec-Fetch-Site": "cross-site"})
        self.assertFalse(is_same_origin_request(request))

    def test_allows_non_browser_local_client_without_origin(self):
        self.assertTrue(is_same_origin_request(_Request()))

    def test_rejects_origin_when_request_host_is_unknown(self):
        self.assertFalse(is_same_origin_request(_Request({"Origin": "http://127.0.0.1:8188"}, host="")))

    def test_redacts_argument_values_but_keeps_flag_names(self):
        arguments = ["--listen", "0.0.0.0", "--user-directory=C:/private", "workflow.json"]
        self.assertEqual(
            _redacted_arguments(arguments),
            ["--listen", "<value>", "--user-directory=<value>", "<value>"],
        )

    def test_proxy_values_are_never_exposed(self):
        with patch.dict(
            os.environ,
            {"HTTP_PROXY": "http://user:password@proxy", "HTTPS_PROXY": "", "NO_PROXY": "localhost"},
            clear=False,
        ):
            network = _network_info()
        self.assertEqual(network["http_proxy"]["value"], "Set")
        self.assertEqual(network["https_proxy"]["value"], "Not set")
        self.assertEqual(network["no_proxy"]["value"], "Set")
        self.assertNotIn("password", repr(network))


if __name__ == "__main__":
    unittest.main()
