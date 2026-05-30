"""FastAPI application — REST API + WebSocket streaming for code-flash web UI."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Make the project src importable
_PROJECT_SRC = os.path.join(os.path.dirname(__file__), "..", "..", "src")
sys.path.insert(0, _PROJECT_SRC)

from core.config import AppConfig, load_app_config, validate_provider
from core.engine import Engine, AbortedError
from features.compact import CompactService, estimate_tokens, should_compact
from session_manager import WebSessionManager

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("code-flash")

# ---------------------------------------------------------------------------
# App config (loaded once at startup from env / defaults)
# ---------------------------------------------------------------------------

def _build_app_config(
    provider: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> AppConfig:
    """Build AppConfig from environment variables (CLI args are not used in web mode)."""
    from argparse import Namespace
    ns = Namespace(
        prompt=None, print=False, auto_approve=False, config=None,
        provider=provider, api_key=api_key, base_url=base_url,
        model=model, max_tokens=None, effort=None, buddy_model=None,
        resume=None, memory_dir=None, no_auto_dream=False,
        dream_interval=None, dream_min_sessions=None, coordinator=False,
    )
    return load_app_config(ns)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="code-flash Web", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Settings persistence (settings.json)
# ---------------------------------------------------------------------------

_SETTINGS_DIR = Path.home() / ".config" / "code-flash"
_SETTINGS_FILE = _SETTINGS_DIR / "settings.json"


def _load_settings() -> dict[str, Any]:
    """Load saved settings, or return defaults."""
    if _SETTINGS_FILE.exists():
        try:
            return json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to read settings.json, using defaults")
    return {
        "saved_keys": {},        # provider -> list of masked keys
        "saved_base_urls": [],   # list of custom base URLs
        "last_config": {},       # last used provider/model/base_url
    }


def _save_settings(settings: dict[str, Any]) -> None:
    """Atomically write settings.json."""
    _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")


def _mask_key(key: str) -> str:
    """Show first 8 and last 4 chars."""
    if len(key) <= 12:
        return key[:4] + "..." + key[-4:]
    return key[:8] + "..." + key[-4:]


class SettingsUpdate(BaseModel):
    provider: str
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


@app.get("/api/settings")
def get_settings():
    """Return saved settings with masked API keys.

    Supports two formats:
    1. Simple format: { "saved_keys": {...}, "saved_base_urls": [...], "last_config": {...} }
    2. Complex format: { "env": {...}, "modelProviders": {...}, "last_config": {...} }
    """
    settings = _load_settings()

    # Check if it's the complex format (has env and modelProviders)
    if "env" in settings and "modelProviders" in settings:
        env: dict[str, str] = settings.get("env", {})
        providers: dict[str, list[dict]] = settings.get("modelProviders", {})
        last_config = settings.get("last_config", {})

        # Build saved_keys: provider -> list of masked env key names
        saved_keys: dict[str, list[str]] = {}
        saved_base_urls: list[str] = []
        model_configs: dict[str, list[dict]] = {}  # provider -> [{id, name, baseUrl}]

        for provider, models in providers.items():
            keys_set: set[str] = set()
            model_list: list[dict] = []
            for m in models:
                env_key = m.get("envKey", "")
                if env_key and env_key in env:
                    keys_set.add(env_key)
                base_url = m.get("baseUrl", "")
                if base_url and base_url not in saved_base_urls:
                    saved_base_urls.append(base_url)
                model_list.append({
                    "id": m.get("id", ""),
                    "name": m.get("name", ""),
                    "baseUrl": base_url,
                    "envKey": env_key,
                })
            saved_keys[provider] = list(keys_set)
            model_configs[provider] = model_list

        # Masked env: show masked values for display
        masked_env: dict[str, str] = {}
        for key_name, key_value in env.items():
            masked_env[key_name] = _mask_key(key_value)

        return {
            "saved_keys": saved_keys,          # provider -> list of env key names
            "saved_base_urls": saved_base_urls,
            "last_config": last_config,
            "masked_env": masked_env,          # masked env dict (for display only)
            "model_configs": model_configs,     # provider -> [{id, name, baseUrl, envKey}]
        }

    # Simple format
    return {
        "saved_keys": settings.get("saved_keys", {}),
        "saved_base_urls": settings.get("saved_base_urls", []),
        "last_config": settings.get("last_config", {}),
        "masked_env": {},
        "model_configs": {},
    }


@app.get("/api/settings/mcp")
def get_mcp_settings():
    """Return saved MCP server configurations."""
    settings = _load_settings()
    return {"servers": settings.get("mcp_servers", [])}


class MCPServerConfig(BaseModel):
    name: str
    transport: str = "stdio"
    command: str = ""
    args: list[str] = []
    url: str = ""
    enabled: bool = True


@app.post("/api/settings/mcp")
def save_mcp_settings(configs: list[MCPServerConfig]):
    """Save MCP server configurations."""
    settings = _load_settings()
    settings["mcp_servers"] = [c.dict() for c in configs]
    _save_settings(settings)
    logger.info(f"Saved {len(configs)} MCP server configurations")
    return {"success": True}


@app.post("/api/settings")
def post_settings(update: SettingsUpdate):
    """Save or append a new config entry."""
    settings = _load_settings()

    # Save API key (append to list if new)
    if update.api_key:
        keys_list: list[str] = settings.get("saved_keys", {}).get(update.provider, [])
        # Deduplicate by full key value
        existing_full = settings.setdefault("_full_keys", {})
        provider_full: list[str] = existing_full.get(update.provider, [])
        if update.api_key not in provider_full:
            provider_full.append(update.api_key)
            existing_full[update.provider] = provider_full
            keys_list = [_mask_key(k) for k in provider_full]
            settings["saved_keys"][update.provider] = keys_list

    # Save base URL (append if new)
    if update.base_url and update.base_url not in settings["saved_base_urls"]:
        settings["saved_base_urls"].append(update.base_url)

    # Save last config
    settings["last_config"] = {
        "provider": update.provider,
        "model": update.model or "",
        "base_url": update.base_url or "",
    }

    _save_settings(settings)
    logger.info("Settings saved: provider=%s, model=%s", update.provider, update.model)
    return {"ok": True}


class KeyRequest(BaseModel):
    provider: str
    env_key: str  # env key name (e.g. "OPENAI_API_KEY")


@app.post("/api/settings/get_key")
def get_full_key(req: KeyRequest):
    """Return the full API key for an env key name."""
    settings = _load_settings()

    # Complex format: lookup from env dict
    env: dict[str, str] = settings.get("env", {})
    if req.env_key in env:
        return {"key": env[req.env_key]}

    # Simple format: lookup from _full_keys
    full_keys: list[str] = settings.get("_full_keys", {}).get(req.provider, [])
    masked_keys: list[str] = settings.get("saved_keys", {}).get(req.provider, [])
    try:
        idx = masked_keys.index(req.env_key)
        if idx < len(full_keys):
            return {"key": full_keys[idx]}
    except ValueError:
        pass
    return {"key": ""}


# Global state — initialised on startup via /api/init or env vars
_session_mgr: WebSessionManager | None = None
_app_config: AppConfig | None = None
_thread_pool = ThreadPoolExecutor(max_workers=8)
_user_workspace: str | None = None  # 用户指定的工作目录

# Pending permission requests: request_id -> threading.Event + result holder
_permission_pending: dict[str, dict[str, Any]] = {}
_permission_lock = threading.Lock()


def _get_session_mgr() -> WebSessionManager:
    global _session_mgr, _app_config
    if _session_mgr is None:
        try:
            _app_config = _build_app_config()
            _session_mgr = WebSessionManager(_app_config)
        except Exception as e:
            logger.warning(f"Initial session manager creation failed (will retry on first use): {e}")
            # Create a minimal config to keep the server running
            from argparse import Namespace
            ns = Namespace(
                prompt=None, print=False, auto_approve=False, config=None,
                provider="anthropic", api_key="", base_url=None,
                model="claude-sonnet-4-20250514", max_tokens=None, effort=None, buddy_model=None,
                resume=None, memory_dir=None, no_auto_dream=False,
                dream_interval=None, dream_min_sessions=None, coordinator=False,
            )
            _app_config = AppConfig(
                provider="anthropic",
                api_key="",
                api_url="",
                model="claude-sonnet-4-20250514",
                max_tokens=16384,
                effort=None,
                buddy_model=None,
                permitted_commands=set(),
            )
            _session_mgr = WebSessionManager(_app_config)
    return _session_mgr


# ---------------------------------------------------------------------------
# Permission callback — bridges Engine thread ↔ WebSocket
# ---------------------------------------------------------------------------

def _ask_approval_ws(ws: WebSocket, session_id: str, ws_disconnect_event: threading.Event | None = None):
    """Return a callable that the WebPermissionChecker will invoke.

    The callable blocks the Engine thread until the frontend responds via WS.
    If the WebSocket disconnects, all pending permissions are auto-denied.
    """
    loop = asyncio.get_event_loop()

    def _ask(tool_name: str, inputs: dict, request_id: str) -> str:
        event = threading.Event()
        result_holder: dict[str, Any] = {"result": "deny"}

        with _permission_lock:
            _permission_pending[request_id] = {"event": event, "result": result_holder}

        # Check if WebSocket is still connected
        if ws.client_state != 1:  # not CONNECTED
            logger.warning(f"🔐 WS not connected, auto-denying: id={request_id}, tool={tool_name}")
            with _permission_lock:
                _permission_pending.pop(request_id, None)
            return "deny"

        logger.info(f"🔐 Permission request: id={request_id}, tool={tool_name}")

        # Send permission request to frontend
        msg = json.dumps({
            "type": "permission_request",
            "id": request_id,
            "tool_name": tool_name,
            "input": _serialize_inputs(inputs),
        })
        try:
            asyncio.run_coroutine_threadsafe(
                ws.send_text(msg), loop
            ).result(timeout=5)
        except Exception as e:
            logger.error(f"🔐 Failed to send permission request: {e}")
            with _permission_lock:
                _permission_pending.pop(request_id, None)
            return "deny"

        # Block until frontend responds (with periodic WS disconnect checks)
        logger.info(f"🔐 Waiting for permission response: id={request_id}")
        _WAIT_CHUNK = 2.0  # check WS state every 2 seconds
        remaining = 300.0
        while remaining > 0:
            wait = min(_WAIT_CHUNK, remaining)
            if event.wait(timeout=wait):
                break  # got response
            remaining -= wait
            # Check if WS disconnected while waiting
            if ws_disconnect_event and ws_disconnect_event.is_set():
                logger.warning(f"🔐 WS disconnected while waiting, auto-denying: id={request_id}")
                with _permission_lock:
                    _permission_pending.pop(request_id, None)
                return "deny"
        else:
            # Timed out
            logger.warning(f"🔐 Permission timeout (300s): id={request_id}")
            with _permission_lock:
                _permission_pending.pop(request_id, None)
            return "deny"

        with _permission_lock:
            entry = _permission_pending.pop(request_id, None)
        result = entry["result"]["result"] if entry else "deny"
        logger.info(f"🔐 Permission result: id={request_id}, result={result}")
        return result

    return _ask


def _cleanup_pending_permissions(session_id: str) -> None:
    """Auto-deny all pending permission requests (called on WS disconnect).

    This unblocks any engine threads waiting on event.wait() so they don't
    hang for the full 300-second timeout.
    """
    with _permission_lock:
        pending = list(_permission_pending.items())
    if pending:
        logger.info(f"🔐 WS disconnect: auto-denying {len(pending)} pending permission(s)")
    for req_id, entry in pending:
        entry["result"]["result"] = "deny"
        entry["event"].set()


def _serialize_inputs(inputs: dict) -> dict:
    """Ensure inputs are JSON-serializable."""
    safe = {}
    for k, v in inputs.items():
        if isinstance(v, (str, int, float, bool, type(None))):
            safe[k] = v
        elif isinstance(v, (list, dict)):
            try:
                json.dumps(v)
                safe[k] = v
            except (TypeError, ValueError):
                safe[k] = str(v)
        else:
            safe[k] = str(v)
    return safe


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------

class InitRequest(BaseModel):
    provider: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    workspace: str | None = None  # 用户指定的工作目录


class InitResponse(BaseModel):
    provider: str
    model: str
    max_tokens: int


@app.post("/api/init", response_model=InitResponse)
async def init_config(req: InitRequest):
    global _session_mgr, _app_config, _user_workspace
    logger.info(f"Init config: provider={req.provider}, model={req.model}, api_key={'***' if req.api_key else 'env'}, workspace={req.workspace}")
    
    # 保存用户指定的工作目录
    _user_workspace = req.workspace
    
    try:
        _app_config = _build_app_config(
            provider=req.provider,
            api_key=req.api_key,
            base_url=req.base_url,
            model=req.model,
        )
        _session_mgr = WebSessionManager(_app_config)
        logger.info(f"Config applied: provider={_app_config.provider}, model={_app_config.model}")
    except Exception as e:
        logger.warning(f"Init config warning (non-fatal): {e}")
        # Don't crash — allow user to configure settings later
        return InitResponse(
            provider=req.provider or "anthropic",
            model=req.model or "",
            max_tokens=16384,
        )
    return InitResponse(
        provider=_app_config.provider,
        model=_app_config.model,
        max_tokens=_app_config.max_tokens,
    )


@app.get("/api/config")
async def get_config():
    cfg = _get_session_mgr()
    return {
        "provider": _app_config.provider if _app_config else "anthropic",
        "model": _app_config.model if _app_config else "",
        "max_tokens": _app_config.max_tokens if _app_config else 0,
    }


@app.get("/api/sessions")
async def list_sessions():
    return _get_session_mgr().list_sessions()


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    ok = _get_session_mgr().delete_session(session_id)
    return {"ok": ok}


@app.post("/api/sessions/{session_id}/mode")
async def set_mode(session_id: str, body: dict):
    mode = body.get("mode", "default")
    ok = _get_session_mgr().update_permission_mode(session_id, mode)
    return {"ok": ok, "mode": mode}


@app.post("/api/sessions/{session_id}/cycle_mode")
async def cycle_mode(session_id: str):
    label = _get_session_mgr().cycle_permission_mode(session_id)
    return {"mode_label": label}


# ---------------------------------------------------------------------------
# Workspace file browser
# ---------------------------------------------------------------------------

import mimetypes
from starlette.responses import FileResponse

@app.get("/api/sessions/{session_id}/files")
async def list_workspace_files(session_id: str, path: str = ""):
    """List files in a session's workspace directory."""
    workspace = os.path.join("/tmp/code-flash-workspaces", session_id)
    if not os.path.isdir(workspace):
        return {"files": [], "workspace": workspace}

    target = os.path.normpath(os.path.join(workspace, path))
    # Security: ensure target is within workspace
    if not target.startswith(os.path.normpath(workspace)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Directory not found")

    files = []
    for entry in sorted(os.listdir(target)):
        if entry.startswith("."):
            continue
        full_path = os.path.join(target, entry)
        rel_path = os.path.relpath(full_path, workspace)
        is_dir = os.path.isdir(full_path)
        item = {
            "name": entry,
            "path": rel_path,
            "is_dir": is_dir,
        }
        if not is_dir:
            stat = os.stat(full_path)
            item["size"] = stat.st_size
            item["modified"] = stat.st_mtime
            _, ext = os.path.splitext(entry)
            item["ext"] = ext.lower()
        files.append(item)

    return {"files": files, "workspace": workspace, "path": path}


# Image / binary extensions that should be returned as base64
_BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
    ".pdf", ".zip", ".tar", ".gz", ".woff", ".woff2", ".ttf", ".eot",
}


@app.get("/api/sessions/{session_id}/files/content")
async def get_file_content(session_id: str, path: str):
    """Return file content as JSON for in-app preview.

    Text files → { type: "text", content: "..." }
    Image files → { type: "image", content: "base64...", mime: "image/png" }
    """
    import base64

    workspace = os.path.join("/tmp/code-flash-workspaces", session_id)
    full_path = os.path.normpath(os.path.join(workspace, path))

    if not full_path.startswith(os.path.normpath(workspace)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    _, ext = os.path.splitext(full_path)
    ext = ext.lower()

    if ext in _BINARY_EXTS:
        media_type, _ = mimetypes.guess_type(full_path)
        with open(full_path, "rb") as f:
            content = base64.b64encode(f.read()).decode("ascii")
        return {"type": "image" if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"} else "binary", "content": content, "mime": media_type or "application/octet-stream"}

    # Text file — read as UTF-8 with fallback
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        with open(full_path, "r", encoding="latin-1") as f:
            content = f.read()

    return {"type": "text", "content": content, "ext": ext, "name": os.path.basename(full_path)}


@app.get("/api/sessions/{session_id}/files/{file_path:path}")
async def download_workspace_file(session_id: str, file_path: str):
    """Download or serve a file from the session's workspace."""
    workspace = os.path.join("/tmp/code-flash-workspaces", session_id)
    full_path = os.path.normpath(os.path.join(workspace, file_path))

    # Security: ensure file is within workspace
    if not full_path.startswith(os.path.normpath(workspace)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    # Determine media type
    media_type, _ = mimetypes.guess_type(full_path)
    if media_type is None:
        media_type = "application/octet-stream"

    filename = os.path.basename(full_path)
    return FileResponse(
        full_path,
        media_type=media_type,
        filename=filename,
    )


@app.get("/api/files/any")
async def list_any_files(path: str = ""):
    """List files in any directory (for browsing local skills, etc.)."""
    if not path:
        path = os.path.expanduser("~")
    target = os.path.normpath(os.path.expanduser(path))

    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Directory not found")

    files = []
    try:
        for entry in sorted(os.listdir(target)):
            if entry.startswith("."):
                continue
            full_path = os.path.join(target, entry)
            is_dir = os.path.isdir(full_path)
            item = {
                "name": entry,
                "path": full_path,
                "is_dir": is_dir,
            }
            if not is_dir:
                try:
                    stat = os.stat(full_path)
                    item["size"] = stat.st_size
                    _, ext = os.path.splitext(entry)
                    item["ext"] = ext.lower()
                except OSError:
                    pass
            files.append(item)
    except PermissionError:
        pass

    return {"files": files, "path": target}


@app.get("/api/files/any/download")
async def download_any_file(path: str):
    """Download any file by absolute path."""
    full_path = os.path.normpath(os.path.expanduser(path))

    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    media_type, _ = mimetypes.guess_type(full_path)
    if media_type is None:
        media_type = "application/octet-stream"

    return FileResponse(
        full_path,
        media_type=media_type,
        filename=os.path.basename(full_path),
    )


# ---------------------------------------------------------------------------
# WebSocket — streaming chat
# ---------------------------------------------------------------------------

@app.websocket("/ws/chat/{session_id}")
async def ws_chat(ws: WebSocket, session_id: str):
    await ws.accept()
    logger.info(f"WebSocket connected: session={session_id}")
    mgr = _get_session_mgr()

    # Track WS disconnect so permission waiters can bail out early
    ws_disconnect_event = threading.Event()

    # Permission callback that bridges to this WS connection
    ask_approval = _ask_approval_ws(ws, session_id, ws_disconnect_event)

    # Reuse or create session
    engine = None
    try:
        engine = mgr.get_engine(session_id)
        if engine is None:
            # 使用用户指定的工作目录，或自动创建隔离空间
            cwd = _user_workspace if _user_workspace else None
            sid, engine = mgr.create_session(ask_approval=ask_approval, session_id=session_id, cwd=cwd)
            logger.info(f"New session created: {sid}, provider={_app_config.provider}, model={_app_config.model}, cwd={cwd or 'isolated'}")
        else:
            # Re-wire permission checker for new WS connection
            session_data = mgr.get_session(session_id)
            if session_data:
                session_data["permissions"]._ask_approval = ask_approval
    except Exception as e:
        logger.error(f"Engine creation failed: {e}")
        await ws.send_text(json.dumps({
            "type": "error",
            "content": f"⚠️ 引擎初始化失败: {str(e)}\n\n请在侧边栏「设置」中配置 API Key 后重试。"
        }))
        # Keep connection alive, don't close
        # User can configure settings and try again

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            # -- Permission response from frontend --
            if msg_type == "permission_response":
                req_id = data.get("id", "")
                approved = data.get("approved", False)
                always = data.get("always", False)
                logger.info(f"🔐 Permission response received: id={req_id}, approved={approved}, always={always}")
                with _permission_lock:
                    entry = _permission_pending.get(req_id)
                if entry:
                    if always:
                        entry["result"]["result"] = "always"
                    elif approved:
                        entry["result"]["result"] = "allow"
                    else:
                        entry["result"]["result"] = "deny"
                    entry["event"].set()
                    logger.info(f"🔐 Permission event set: id={req_id}")
                else:
                    logger.warning(f"🔐 Permission response for unknown request: id={req_id}")
                continue

            # -- User message --
            if msg_type == "message":
                content = data.get("content", "")
                if not content.strip():
                    continue

                logger.info(f"User message received: session={session_id}, len={len(content)}")

                # Check if engine is ready
                if engine is None:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "content": "⚠️ 引擎未就绪！请先在侧边栏「设置」中配置 API Key，然后重新连接。"
                    }))
                    continue

                # Handle slash commands
                if content.strip().startswith("/"):
                    handled = await _handle_slash_command(ws, session_id, content.strip(), engine)
                    if handled:
                        continue

                # Run engine.submit() in thread pool and stream events to WS
                await _stream_engine_response(ws, engine, content, session_id)

                # Auto-compact check after each response
                await _maybe_auto_compact(ws, session_id, engine)

            # -- Compact (frontend button) --
            if msg_type == "compact":
                session_data = _get_session_mgr().get_session(session_id)
                if session_data:
                    compact_svc = session_data.get("compact_service")
                    if compact_svc:
                        try:
                            messages = engine.get_messages()
                            pre_tokens = estimate_tokens(messages)
                            new_msgs, _ = await asyncio.get_event_loop().run_in_executor(
                                _thread_pool,
                                lambda: compact_svc.compact(
                                    messages, engine.system_prompt,
                                    custom_instructions=data.get("instructions", ""),
                                ),
                            )
                            engine.set_messages(new_msgs)
                            post_tokens = estimate_tokens(new_msgs)
                            await ws.send_text(json.dumps({
                                "type": "compact_done",
                                "pre_tokens": pre_tokens,
                                "post_tokens": post_tokens,
                                "pre_messages": len(messages),
                                "post_messages": len(new_msgs),
                            }))
                        except Exception as e:
                            await ws.send_text(json.dumps({
                                "type": "error",
                                "content": f"压缩失败: {e}"
                            }))

            # -- Abort --
            if msg_type == "abort":
                engine.abort()

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: session={session_id}")
    except Exception as exc:
        logger.error(f"WebSocket error: session={session_id}, error={exc}")
        try:
            await ws.send_text(json.dumps({"type": "error", "content": str(exc)}))
        except Exception:
            pass
    finally:
        # Signal disconnect so any pending permission waiters unblock immediately
        ws_disconnect_event.set()
        _cleanup_pending_permissions(session_id)


async def _handle_slash_command(ws: WebSocket, session_id: str, cmd: str, engine: Engine) -> bool:
    """Handle slash commands. Returns True if handled."""
    parts = cmd.strip().split(maxsplit=1)
    command = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""

    if command in ("/clear", "/new"):
        engine.set_messages([])
        await ws.send_text(json.dumps({"type": "system", "content": "会话已清空"}))
        return True

    if command == "/model":
        if args:
            engine.set_model(args.strip())
            await ws.send_text(json.dumps({
                "type": "system",
                "content": f"模型已切换为: {engine.get_model()}"
            }))
        else:
            await ws.send_text(json.dumps({
                "type": "system",
                "content": f"当前模型: {engine.get_model()}"
            }))
        return True

    if command == "/compact":
        session_data = _get_session_mgr().get_session(session_id)
        if session_data:
            compact_svc = session_data.get("compact_service")
            if compact_svc:
                try:
                    messages = engine.get_messages()
                    pre_tokens = estimate_tokens(messages)
                    new_msgs, _ = await asyncio.get_event_loop().run_in_executor(
                        _thread_pool,
                        lambda: compact_svc.compact(
                            messages, engine.system_prompt, custom_instructions=args,
                        ),
                    )
                    engine.set_messages(new_msgs)
                    post_tokens = estimate_tokens(new_msgs)
                    await ws.send_text(json.dumps({
                        "type": "system",
                        "content": f"✅ 上下文已压缩: {pre_tokens:,} → {post_tokens:,} tokens "
                                   f"({len(messages)} → {len(new_msgs)} 条消息)"
                    }))
                except Exception as e:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "content": f"压缩失败: {e}"
                    }))
        return True

    if command == "/cost":
        session_data = _get_session_mgr().get_session(session_id)
        if session_data:
            ct = session_data.get("cost_tracker")
            if ct:
                await ws.send_text(json.dumps({
                    "type": "system",
                    "content": ct.format_cost()
                }))
        return True

    # Not handled — pass through to engine as normal message
    return False


async def _maybe_auto_compact(ws: WebSocket, session_id: str, engine: Engine) -> None:
    """Check if auto-compact is needed after a response and run it if so."""
    session_data = _get_session_mgr().get_session(session_id)
    if not session_data:
        return
    compact_svc = session_data.get("compact_service")
    cost_tracker = session_data.get("cost_tracker")
    if not compact_svc:
        return

    messages = engine.get_messages()
    last_input_tokens = getattr(cost_tracker, "last_input_tokens", None) if cost_tracker else None

    if not should_compact(messages, model=_app_config.model if _app_config else None,
                          last_input_tokens=last_input_tokens):
        return

    try:
        pre_tokens = estimate_tokens(messages)
        logger.info(f"Auto-compact triggered: session={session_id}, tokens≈{pre_tokens}")
        new_msgs, _ = await asyncio.get_event_loop().run_in_executor(
            _thread_pool,
            lambda: compact_svc.compact(messages, engine.system_prompt),
        )
        engine.set_messages(new_msgs)
        post_tokens = estimate_tokens(new_msgs)
        await ws.send_text(json.dumps({
            "type": "compact_done",
            "pre_tokens": pre_tokens,
            "post_tokens": post_tokens,
            "pre_messages": len(messages),
            "post_messages": len(new_msgs),
            "auto": True,
        }))
    except Exception as e:
        logger.error(f"Auto-compact failed: session={session_id}, error={e}")


async def _stream_engine_response(ws: WebSocket, engine: Engine, content: str, session_id: str = ""):
    """Run engine.submit() in a thread and forward events to the WebSocket."""
    loop = asyncio.get_event_loop()
    import time as _time

    def _run():
        """Run the synchronous generator and put events into an async queue."""
        logger.info(f"Engine processing started: session={session_id}, msg_len={len(content)}, history_len={len(engine.get_messages())}")
        t_start = _time.monotonic()
        t_first_event = None
        event_count = 0
        try:
            for event in engine.submit(content):
                if t_first_event is None:
                    t_first_event = _time.monotonic()
                    logger.info(f"⏱ First event after {t_first_event - t_start:.2f}s (API TTFT)")
                event_count += 1
                event_type = event[0]
                if event_type == "text":
                    asyncio.run_coroutine_threadsafe(
                        ws.send_text(json.dumps({"type": "text", "content": event[1]})),
                        loop,
                    ).result(timeout=10)
                elif event_type == "tool_call":
                    name, inputs, activity = event[1], event[2], event[3]
                    asyncio.run_coroutine_threadsafe(
                        ws.send_text(json.dumps({
                            "type": "tool_call",
                            "name": name,
                            "input": _serialize_inputs(inputs),
                            "activity": activity,
                        }, ensure_ascii=False)),
                        loop,
                    ).result(timeout=10)
                elif event_type == "tool_executing":
                    name, inputs, activity = event[1], event[2], event[3]
                    asyncio.run_coroutine_threadsafe(
                        ws.send_text(json.dumps({
                            "type": "tool_executing",
                            "name": name,
                            "input": _serialize_inputs(inputs),
                            "activity": activity,
                        }, ensure_ascii=False)),
                        loop,
                    ).result(timeout=10)
                elif event_type == "tool_result":
                    name, inputs, result = event[1], event[2], event[3]
                    asyncio.run_coroutine_threadsafe(
                        ws.send_text(json.dumps({
                            "type": "tool_result",
                            "name": name,
                            "input": _serialize_inputs(inputs),
                            "content": result.content[:5000] if result.content else "",
                            "is_error": result.is_error,
                        }, ensure_ascii=False)),
                        loop,
                    ).result(timeout=10)
                elif event_type == "waiting":
                    asyncio.run_coroutine_threadsafe(
                        ws.send_text(json.dumps({"type": "waiting"})),
                        loop,
                    ).result(timeout=10)
                elif event_type == "error":
                    asyncio.run_coroutine_threadsafe(
                        ws.send_text(json.dumps({"type": "error", "content": event[1]})),
                        loop,
                    ).result(timeout=10)
                elif event_type == "usage":
                    usage = event[1]
                    asyncio.run_coroutine_threadsafe(
                        ws.send_text(json.dumps({
                            "type": "usage",
                            "input_tokens": getattr(usage, "input_tokens", 0),
                            "output_tokens": getattr(usage, "output_tokens", 0),
                        })),
                        loop,
                    ).result(timeout=10)
        except AbortedError:
            asyncio.run_coroutine_threadsafe(
                ws.send_text(json.dumps({"type": "system", "content": "已中断"})),
                loop,
            ).result(timeout=5)
        except Exception as e:
            logger.error(f"Engine error: session={session_id}, error={e}", exc_info=True)
            asyncio.run_coroutine_threadsafe(
                ws.send_text(json.dumps({"type": "error", "content": str(e)})),
                loop,
            ).result(timeout=5)
        finally:
            t_end = _time.monotonic()
            logger.info(f"⏱ Engine done: session={session_id}, events={event_count}, total={t_end - t_start:.2f}s, first_event={t_first_event - t_start:.2f}s" if t_first_event else f"⏱ Engine done: session={session_id}, events={event_count}, total={t_end - t_start:.2f}s")
            asyncio.run_coroutine_threadsafe(
                ws.send_text(json.dumps({"type": "done"})),
                loop,
            ).result(timeout=5)

    await loop.run_in_executor(_thread_pool, _run)


# ---------------------------------------------------------------------------
# Skills API
# ---------------------------------------------------------------------------

_SKILLS_DIR = os.path.expanduser("~/.config/code-flash/skills")
_USER_SKILLS_DIR = "/tmp/code-flash-workspaces"


def _parse_skill_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from SKILL.md."""
    info: dict = {}
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            fm = parts[1].strip()
            for line in fm.split("\n"):
                line = line.strip()
                if line.startswith("name:"):
                    info["name"] = line.split(":", 1)[1].strip().strip("'\"")
                elif line.startswith("description:"):
                    desc = line.split(":", 1)[1].strip().strip("'\"")
                    info["description"] = desc
                elif line.startswith("emoji:"):
                    info["emoji"] = line.split(":", 1)[1].strip().strip("'\"")
    return info


def _scan_global_skills() -> list[dict]:
    """Scan ~/.config/code-flash/skills/ for all available skills."""
    skills: list[dict] = []
    if not os.path.isdir(_SKILLS_DIR):
        return skills

    for entry in sorted(os.listdir(_SKILLS_DIR)):
        cat_path = os.path.join(_SKILLS_DIR, entry)
        if not os.path.isdir(cat_path) or entry.startswith("."):
            continue

        # Category name: strip numeric prefix like "01_"
        cat_name = entry
        if len(entry) > 2 and entry[0:2].isdigit() and entry[2] == "_":
            cat_name = entry[3:]

        for skill_entry in sorted(os.listdir(cat_path)):
            skill_path = os.path.join(cat_path, skill_entry)
            if not os.path.isdir(skill_path) or skill_entry.startswith("."):
                continue

            skill_info: dict = {
                "id": f"{cat_name}/{skill_entry}",
                "name": skill_entry,
                "description": "",
                "category": cat_name,
                "type": "unknown",
                "emoji": "🧊",
                "path": skill_path,
            }

            # Try openclaw.plugin.json
            plugin_json = os.path.join(skill_path, "openclaw.plugin.json")
            if os.path.isfile(plugin_json):
                try:
                    with open(plugin_json, encoding="utf-8") as f:
                        pj = json.load(f)
                    skill_info["type"] = "plugin"
                    skill_info["name"] = pj.get("id", skill_entry)
                except Exception:
                    pass

            # Try SKILL.md
            skill_md = os.path.join(skill_path, "SKILL.md")
            if os.path.isfile(skill_md):
                try:
                    with open(skill_md, encoding="utf-8") as f:
                        content = f.read()
                    fm = _parse_skill_frontmatter(content)
                    if fm.get("name"):
                        skill_info["name"] = fm["name"]
                    if fm.get("description"):
                        skill_info["description"] = fm["description"]
                    if fm.get("emoji"):
                        skill_info["emoji"] = fm["emoji"]
                    skill_info["type"] = "markdown"
                except Exception:
                    pass

            # Try package.json for description
            if not skill_info["description"]:
                pkg_json = os.path.join(skill_path, "package.json")
                if os.path.isfile(pkg_json):
                    try:
                        with open(pkg_json, encoding="utf-8") as f:
                            pkg = json.load(f)
                        if pkg.get("description"):
                            skill_info["description"] = pkg["description"]
                    except Exception:
                        pass

            skills.append(skill_info)

    return skills


@app.get("/api/skills")
async def list_skills(q: str = "", category: str = ""):
    """List all available skills from global skills directory."""
    try:
        skills = _scan_global_skills()
        # Filter by search query
        if q:
            q_lower = q.lower()
            skills = [
                s for s in skills
                if q_lower in s["name"].lower()
                or q_lower in s.get("description", "").lower()
                or q_lower in s["category"].lower()
            ]
        # Filter by category
        if category:
            skills = [s for s in skills if s["category"] == category]
        # Collect all categories
        all_categories = sorted({s["category"] for s in _scan_global_skills()})
        return {"skills": skills, "categories": all_categories}
    except Exception as e:
        logger.error(f"Failed to list skills: {e}", exc_info=True)
        return {"skills": [], "categories": [], "error": str(e)}


@app.get("/api/skills/content")
async def get_skill_content(id: str = ""):
    """Return the full content of a skill (SKILL.md or openclaw.plugin.json)."""
    try:
        if not id:
            return {"success": False, "error": "缺少 id 参数"}

        all_skills = _scan_global_skills()
        skill = next((s for s in all_skills if s["id"] == id), None)
        if not skill:
            return {"success": False, "error": f"技能 {id} 未找到"}

        skill_path = skill["path"]

        # Try SKILL.md first
        skill_md = os.path.join(skill_path, "SKILL.md")
        if os.path.isfile(skill_md):
            with open(skill_md, encoding="utf-8") as f:
                content = f.read()
            return {"success": True, "content": content, "format": "markdown", "name": skill["name"]}

        # Try openclaw.plugin.json
        plugin_json = os.path.join(skill_path, "openclaw.plugin.json")
        if os.path.isfile(plugin_json):
            with open(plugin_json, encoding="utf-8") as f:
                content = f.read()
            return {"success": True, "content": content, "format": "json", "name": skill["name"]}

        # Try README.md as fallback
        readme = os.path.join(skill_path, "README.md")
        if os.path.isfile(readme):
            with open(readme, encoding="utf-8") as f:
                content = f.read()
            return {"success": True, "content": content, "format": "markdown", "name": skill["name"]}

        return {"success": False, "error": "技能无可用内容文件"}
    except Exception as e:
        logger.error(f"Failed to get skill content: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/api/skills/install")
async def install_skill(req: Request):
    """Install a skill to user's workspace by copying from global directory."""
    try:
        body = await req.json()
        skill_id = body.get("skill_id", "")  # e.g. "AI-LLM模型提供商/openai"
        session_id = body.get("session_id", "default")
        if not skill_id:
            return {"success": False, "error": "缺少 skill_id"}

        # Find the skill in global directory
        all_skills = _scan_global_skills()
        skill = next((s for s in all_skills if s["id"] == skill_id), None)
        if not skill:
            return {"success": False, "error": f"技能 {skill_id} 不存在"}

        # Create user skills directory
        user_skills_dir = os.path.join(_USER_SKILLS_DIR, session_id, "skills")
        os.makedirs(user_skills_dir, exist_ok=True)

        # Copy skill to user workspace
        src = skill["path"]
        skill_dest_name = skill_id.replace("/", "__")
        dst = os.path.join(user_skills_dir, skill_dest_name)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst)

        logger.info(f"Skill installed: {skill_id} -> {dst}")
        return {"success": True, "installed_path": dst}
    except Exception as e:
        logger.error(f"Failed to install skill: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.get("/api/skills/installed")
async def list_installed_skills(session_id: str = "default"):
    """List skills installed in user's workspace."""
    try:
        user_skills_dir = os.path.join(_USER_SKILLS_DIR, session_id, "skills")
        if not os.path.isdir(user_skills_dir):
            return {"skills": []}

        installed: list[dict] = []
        for entry in sorted(os.listdir(user_skills_dir)):
            skill_path = os.path.join(user_skills_dir, entry)
            if not os.path.isdir(skill_path):
                continue

            info: dict = {
                "id": entry.replace("__", "/"),
                "name": entry.split("__")[-1] if "__" in entry else entry,
                "description": "",
                "type": "unknown",
                "path": skill_path,
            }

            skill_md = os.path.join(skill_path, "SKILL.md")
            if os.path.isfile(skill_md):
                try:
                    with open(skill_md, encoding="utf-8") as f:
                        content = f.read()
                    fm = _parse_skill_frontmatter(content)
                    if fm.get("name"):
                        info["name"] = fm["name"]
                    if fm.get("description"):
                        info["description"] = fm["description"]
                    info["type"] = "markdown"
                except Exception:
                    pass

            plugin_json = os.path.join(skill_path, "openclaw.plugin.json")
            if os.path.isfile(plugin_json):
                info["type"] = "plugin"
                try:
                    with open(plugin_json, encoding="utf-8") as f:
                        pj = json.load(f)
                    if pj.get("id"):
                        info["name"] = pj["id"]
                except Exception:
                    pass

            installed.append(info)
        return {"skills": installed}
    except Exception as e:
        logger.error(f"Failed to list installed skills: {e}", exc_info=True)
        return {"skills": [], "error": str(e)}


@app.post("/api/skills/uninstall")
async def uninstall_skill(req: Request):
    """Remove an installed skill from user's workspace."""
    try:
        body = await req.json()
        skill_id = body.get("skill_id", "")
        session_id = body.get("session_id", "default")
        if not skill_id:
            return {"success": False, "error": "缺少 skill_id"}

        skill_dest_name = skill_id.replace("/", "__")
        dst = os.path.join(_USER_SKILLS_DIR, session_id, "skills", skill_dest_name)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
            logger.info(f"Skill uninstalled: {skill_id}")
            return {"success": True}
        return {"success": False, "error": "技能未安装"}
    except Exception as e:
        logger.error(f"Failed to uninstall skill: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.get("/api/skills/marketplace")
async def search_marketplace(
    q: str = "",
    page: int = 1,
    limit: int = 20,
    sort_by: str = "stars",
    category: str = "",
):
    """Marketplace search — currently disabled."""
    return {"skills": [], "pagination": {}, "error": None}


def _github_tree_to_raw(url: str, filename: str = "SKILL.md") -> str:
    """Convert a GitHub tree URL to a raw file URL.

    Example:
      https://github.com/owner/repo/tree/main/path/to/skill
      -> https://raw.githubusercontent.com/owner/repo/main/path/to/skill/SKILL.md
    """
    # /tree/main/... -> raw.githubusercontent.com/owner/repo/main/...
    raw = url.replace("https://github.com/", "https://raw.githubusercontent.com/")
    raw = raw.replace("/tree/", "/")
    return f"{raw}/{filename}"


@app.post("/api/skills/install_from_marketplace")
async def install_from_marketplace(req: Request):
    """Download a skill from GitHub (via skillsmp.com metadata) and install to user workspace."""
    try:
        import httpx

        body = await req.json()
        skill_name = body.get("name", "")
        github_url = body.get("githubUrl", "")
        session_id = body.get("session_id", "default")
        description = body.get("description", "")

        if not skill_name or not github_url:
            return {"success": False, "error": "缺少技能名称或 GitHub 地址"}

        # Try to download SKILL.md from GitHub
        raw_url = _github_tree_to_raw(github_url, "SKILL.md")
        logger.info(f"Downloading skill from: {raw_url}")

        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(raw_url)

        if resp.status_code != 200:
            return {"success": False, "error": f"无法下载 SKILL.md (HTTP {resp.status_code})"}

        skill_md_content = resp.text

        # Create user skills directory
        safe_name = skill_name.replace("/", "-").replace("\\", "-").replace(" ", "-")
        user_skills_dir = os.path.join(_USER_SKILLS_DIR, session_id, "skills", f"marketplace__{safe_name}")
        os.makedirs(user_skills_dir, exist_ok=True)

        # Write SKILL.md
        skill_md_path = os.path.join(user_skills_dir, "SKILL.md")
        with open(skill_md_path, "w", encoding="utf-8") as f:
            f.write(skill_md_content)

        # Write metadata
        meta_path = os.path.join(user_skills_dir, "skill-meta.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({
                "name": skill_name,
                "description": description,
                "githubUrl": github_url,
                "source": "skillsmp.com",
                "installedAt": datetime.now().isoformat(),
            }, f, ensure_ascii=False, indent=2)

        logger.info(f"Marketplace skill installed: {skill_name} -> {user_skills_dir}")
        return {"success": True, "installed_path": user_skills_dir}
    except Exception as e:
        logger.error(f"Failed to install from marketplace: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Serve frontend static files
# ---------------------------------------------------------------------------

_FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve the React frontend. Falls back to index.html for SPA routing."""
    file_path = os.path.join(_FRONTEND_DIST, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    index = os.path.join(_FRONTEND_DIST, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    return {"error": "Frontend not built. Run: cd web/frontend && npm run build"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)
