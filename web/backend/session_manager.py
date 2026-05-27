"""Manage per-connection Engine sessions for the web interface."""
from __future__ import annotations

import sys
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

# Make the project src importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from core.config import AppConfig
from core.context import build_system_prompt
from core.engine import Engine
from core.session import SessionStore
from features.compact import CompactService
from features.cost_tracker import CostTracker
from features.todo import TodoManager

from permission import WebPermissionChecker


class SessionInfo:
    """Metadata for a single conversation session."""

    def __init__(self, session_id: str, title: str, created_at: str, cwd: str):
        self.session_id = session_id
        self.title = title
        self.created_at = created_at
        self.cwd = cwd


class WebSessionManager:
    """Creates and manages Engine instances for web clients.

    Each WebSocket connection maps to one active session.  Sessions can be
    listed, resumed, and deleted via the REST API.
    """

    def __init__(self, app_config: AppConfig):
        self._app_config = app_config
        self._sessions: dict[str, dict[str, Any]] = {}  # session_id -> {engine, tools, ...}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _build_base_tools(self, sandbox_mgr=None) -> list:
        from tools import (
            FileReadTool, GlobTool, GrepTool,
            FileEditTool, FileWriteTool, BashTool,
            AskUserQuestionTool,
            TodoWriteTool, TodoUpdateTool,
            EnterPlanModeTool, ExitPlanModeTool,
        )
        return [
            FileReadTool(), GlobTool(), GrepTool(),
            FileEditTool(), FileWriteTool(),
            BashTool(sandbox_manager=sandbox_mgr),
            AskUserQuestionTool(),
            TodoWriteTool(TodoManager()),
            TodoUpdateTool(TodoManager()),
        ]

    def _build_system_prompt(self, cwd: str) -> str:
        memory_dir = self._app_config.memory_dir
        return build_system_prompt(cwd=cwd, model=self._app_config.model, memory_dir=memory_dir)

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    def create_session(
        self,
        ask_approval: Callable,
        cwd: str | None = None,
        session_id: str | None = None,
    ) -> tuple[str, Engine]:
        """Create a new session and return (session_id, engine)."""
        sid = session_id or datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]

        # 使用隔离的工作空间，避免暴露服务器本地文件
        if cwd is None:
            workspace_base = Path("/tmp/code-flash-workspaces")
            workspace_base.mkdir(parents=True, exist_ok=True)
            cwd = str(workspace_base / sid)
            Path(cwd).mkdir(parents=True, exist_ok=True)

        permissions = WebPermissionChecker(
            ask_approval=ask_approval,
            auto_approve=False,
        )

        tools = self._build_base_tools()
        system_prompt = self._build_system_prompt(cwd)

        cost_tracker = CostTracker()
        session_store = SessionStore(cwd=cwd, model=self._app_config.model, session_id=sid)

        engine = Engine(
            tools=tools,
            system_prompt=system_prompt,
            permission_checker=permissions,
            provider=self._app_config.provider,
            api_key=self._app_config.api_key,
            base_url=self._app_config.base_url,
            model=self._app_config.model,
            max_tokens=self._app_config.max_tokens,
            effort=self._app_config.effort,
            session_store=session_store,
            cost_tracker=cost_tracker,
        )

        compact_service = CompactService(
            client=engine._client,
            model=self._app_config.model,
            effort=self._app_config.effort,
        )

        with self._lock:
            self._sessions[sid] = {
                "engine": engine,
                "permissions": permissions,
                "session_store": session_store,
                "cost_tracker": cost_tracker,
                "compact_service": compact_service,
                "cwd": cwd,
                "created_at": datetime.now().isoformat(),
            }

        return sid, engine

    def get_engine(self, session_id: str) -> Engine | None:
        with self._lock:
            entry = self._sessions.get(session_id)
        return entry["engine"] if entry else None

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._sessions.get(session_id)

    def list_sessions(self) -> list[dict[str, str]]:
        with self._lock:
            return [
                {
                    "session_id": sid,
                    "created_at": entry["created_at"],
                    "cwd": entry["cwd"],
                    "model": self._app_config.model,
                }
                for sid, entry in self._sessions.items()
            ]

    def delete_session(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def update_permission_mode(self, session_id: str, mode: str) -> bool:
        with self._lock:
            entry = self._sessions.get(session_id)
        if not entry:
            return False
        entry["permissions"].set_mode(mode)
        return True

    def cycle_permission_mode(self, session_id: str) -> str | None:
        with self._lock:
            entry = self._sessions.get(session_id)
        if not entry:
            return None
        return entry["permissions"].cycle_mode()


# Fix the import for type hint
from typing import Callable
