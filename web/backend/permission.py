"""WebSocket-aware permission checker — replaces terminal prompt with WS round-trip."""
from __future__ import annotations

import threading
from typing import Any, Callable

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from core.permissions import PermissionChecker, PermissionBehavior
from core.tool import Tool


class WebPermissionChecker(PermissionChecker):
    """PermissionChecker that delegates user prompts to the web frontend via callback.

    Parameters
    ----------
    ask_approval : Callable[[str, dict, str], str]
        Async-safe callable(tool_name, inputs, request_id) -> "allow" | "deny" | "always".
        Runs in the Engine's thread; must block until the frontend responds.
    auto_approve : bool
        If True, skip all prompts (equivalent to --auto-approve).
    """

    def __init__(
        self,
        ask_approval: Callable[[str, dict, str], str],
        auto_approve: bool = False,
    ):
        super().__init__(auto_approve=auto_approve)
        self._ask_approval = ask_approval
        self._request_counter = 0
        self._lock = threading.Lock()

    def _next_request_id(self) -> str:
        with self._lock:
            self._request_counter += 1
            return f"perm-{self._request_counter}"

    def _prompt_user(self, tool: Tool, inputs: dict) -> PermissionBehavior:
        req_id = self._next_request_id()
        try:
            result = self._ask_approval(tool.name, inputs, req_id)
        except Exception:
            return "deny"
        if result == "always":
            self._always_allow.add(tool.name)
            return "allow"
        return "allow" if result == "allow" else "deny"
