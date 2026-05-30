"""MCP (Model Context Protocol) client manager.

Connects to MCP servers via stdio or SSE transport, discovers tools,
and provides synchronous wrappers for tool execution.

The MCP SDK is async; we run a background event loop thread so the
rest of code-flash (which is synchronous/threaded) can call into it.
"""

from __future__ import annotations

import asyncio
import atexit
import logging
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class MCPServerConfig:
    """Configuration for a single MCP server."""
    name: str
    transport: str = "stdio"  # "stdio" or "sse"
    # stdio
    command: str = ""
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    cwd: str | None = None
    # sse
    url: str = ""
    # common
    enabled: bool = True


@dataclass
class MCPToolInfo:
    """Metadata for a tool discovered from an MCP server."""
    name: str
    description: str
    input_schema: dict
    server_name: str


class MCPClientManager:
    """Manages connections to multiple MCP servers.

    Lifecycle:
      1. Construct with a list of MCPServerConfig
      2. Call connect_all() to start servers and discover tools
      3. Use call_tool() to invoke tools
      4. Call disconnect_all() on shutdown (also registered via atexit)
    """

    def __init__(self) -> None:
        self._configs: dict[str, MCPServerConfig] = {}
        self._sessions: dict[str, Any] = {}  # server_name -> ClientSession
        self._transport_ctxs: dict[str, Any] = {}  # server_name -> context manager
        self._hold_tasks: dict[str, asyncio.Task] = {}  # keep transports alive
        self._tools: dict[str, MCPToolInfo] = {}  # tool_name -> info
        self._connected: set[str] = set()
        self._errors: dict[str, str] = {}
        self._lock = threading.Lock()

        # Background event loop
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: threading.Thread | None = None
        self._loop_ready = threading.Event()
        self._shutdown = False

        atexit.register(self.disconnect_all)

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    def add_server(self, config: MCPServerConfig) -> None:
        self._configs[config.name] = config

    def remove_server(self, name: str) -> None:
        self._configs.pop(name, None)

    def load_configs(self, configs: list[MCPServerConfig]) -> None:
        for cfg in configs:
            if cfg.enabled:
                self._configs[cfg.name] = cfg

    # ------------------------------------------------------------------
    # Event loop management
    # ------------------------------------------------------------------

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is not None and self._loop.is_running():
            return self._loop

        self._loop_ready.clear()

        def _run_loop():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            self._loop_ready.set()
            self._loop.run_forever()

        self._loop_thread = threading.Thread(target=_run_loop, daemon=True, name="mcp-loop")
        self._loop_thread.start()
        self._loop_ready.wait(timeout=10)
        if self._loop is None:
            raise RuntimeError("Failed to start MCP event loop")
        return self._loop

    def _run_async(self, coro, timeout: float = 30):
        """Run an async coroutine on the background loop, wait for result."""
        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result(timeout=timeout)

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def connect_all(self) -> list[MCPToolInfo]:
        """Connect to all configured servers and discover tools.

        Returns a flat list of all discovered MCPToolInfo.
        """
        if not self._configs:
            return []

        self._ensure_loop()

        all_tools: list[MCPToolInfo] = []
        for name, cfg in self._configs.items():
            try:
                tools = self._run_async(self._connect_server(cfg))
                all_tools.extend(tools)
                logger.info(f"MCP: connected to '{name}', discovered {len(tools)} tool(s)")
            except Exception as e:
                err = f"Failed to connect to MCP server '{name}': {e}"
                logger.warning(err)
                self._errors[name] = err

        return all_tools

    async def _connect_server(self, cfg: MCPServerConfig) -> list[MCPToolInfo]:
        """Connect to a single MCP server and return its tools."""
        try:
            from mcp import ClientSession
        except ImportError:
            raise RuntimeError(
                "MCP SDK not installed. Run: pip install mcp\n"
                "See: https://github.com/modelcontextprotocol/python-sdk"
            )

        if cfg.transport == "stdio":
            return await self._connect_stdio(cfg)
        elif cfg.transport == "sse":
            return await self._connect_sse(cfg)
        else:
            raise ValueError(f"Unknown MCP transport: {cfg.transport}")

    async def _connect_stdio(self, cfg: MCPServerConfig) -> list[MCPToolInfo]:
        from mcp import ClientSession
        from mcp.client.stdio import StdioServerParameters, stdio_client

        params = StdioServerParameters(
            command=cfg.command,
            args=cfg.args,
            env=cfg.env if cfg.env else None,
            cwd=cfg.cwd,
        )

        transport_ctx = stdio_client(params)
        read_stream, write_stream = await transport_ctx.__aenter__()
        self._transport_ctxs[cfg.name] = transport_ctx

        session = ClientSession(read_stream, write_stream)
        await session.__aenter__()
        self._sessions[cfg.name] = session

        # Keep transport alive with a hold task
        hold_future = self._loop.create_future()
        self._hold_tasks[cfg.name] = hold_future

        # Initialize and discover tools
        await session.initialize()
        result = await session.list_tools()

        tools = []
        for t in result.tools:
            info = MCPToolInfo(
                name=t.name,
                description=t.description or "",
                input_schema=t.inputSchema if t.inputSchema else {},
                server_name=cfg.name,
            )
            tools.append(info)
            self._tools[t.name] = info

        self._connected.add(cfg.name)
        return tools

    async def _connect_sse(self, cfg: MCPServerConfig) -> list[MCPToolInfo]:
        from mcp import ClientSession
        from mcp.client.sse import sse_client

        transport_ctx = sse_client(cfg.url)
        read_stream, write_stream = await transport_ctx.__aenter__()
        self._transport_ctxs[cfg.name] = transport_ctx

        session = ClientSession(read_stream, write_stream)
        await session.__aenter__()
        self._sessions[cfg.name] = session

        # Keep transport alive
        hold_future = self._loop.create_future()
        self._hold_tasks[cfg.name] = hold_future

        await session.initialize()
        result = await session.list_tools()

        tools = []
        for t in result.tools:
            info = MCPToolInfo(
                name=t.name,
                description=t.description or "",
                input_schema=t.inputSchema if t.inputSchema else {},
                server_name=cfg.name,
            )
            tools.append(info)
            self._tools[t.name] = info

        self._connected.add(cfg.name)
        return tools

    def disconnect_all(self) -> None:
        """Disconnect from all servers and stop the event loop."""
        if self._shutdown:
            return
        self._shutdown = True

        if self._loop is None or not self._loop.is_running():
            return

        async def _cleanup():
            for name in list(self._sessions.keys()):
                try:
                    await self._sessions[name].__aexit__(None, None, None)
                except Exception:
                    pass
            for name in list(self._transport_ctxs.keys()):
                try:
                    await self._transport_ctxs[name].__aexit__(None, None, None)
                except Exception:
                    pass
            for name in list(self._hold_tasks.keys()):
                task = self._hold_tasks[name]
                if not task.done():
                    task.cancel()

        try:
            future = asyncio.run_coroutine_threadsafe(_cleanup(), self._loop)
            future.result(timeout=5)
        except Exception:
            pass

        self._sessions.clear()
        self._transport_ctxs.clear()
        self._hold_tasks.clear()
        self._connected.clear()
        self._tools.clear()

        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._loop.stop)

    async def disconnect_server(self, name: str) -> None:
        """Disconnect from a single server."""
        if name in self._sessions:
            try:
                await self._sessions[name].__aexit__(None, None, None)
            except Exception:
                pass
            del self._sessions[name]
        if name in self._transport_ctxs:
            try:
                await self._transport_ctxs[name].__aexit__(None, None, None)
            except Exception:
                pass
            del self._transport_ctxs[name]
        if name in self._hold_tasks:
            task = self._hold_tasks[name]
            if not task.done():
                task.cancel()
            del self._hold_tasks[name]
        self._connected.discard(name)
        # Remove tools from this server
        to_remove = [n for n, t in self._tools.items() if t.server_name == name]
        for n in to_remove:
            del self._tools[n]

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------

    def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> tuple[str, bool]:
        """Call an MCP tool synchronously.

        Returns (content_string, is_error).
        """
        tool_info = self._tools.get(tool_name)
        if tool_info is None:
            return f"Unknown MCP tool: {tool_name}", True

        server_name = tool_info.server_name
        session = self._sessions.get(server_name)
        if session is None:
            return f"MCP server '{server_name}' is not connected", True

        async def _call():
            result = await session.call_tool(tool_name, arguments)
            # Extract text content
            parts = []
            for item in result.content:
                if hasattr(item, "text"):
                    parts.append(item.text)
                else:
                    parts.append(str(item))
            content = "\n".join(parts) if parts else "(empty result)"
            return content, result.isError if hasattr(result, "isError") else False

        try:
            return self._run_async(_call(), timeout=120)
        except Exception as e:
            return f"MCP tool error: {e}", True

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    @property
    def tools(self) -> dict[str, MCPToolInfo]:
        return dict(self._tools)

    @property
    def connected_servers(self) -> set[str]:
        return set(self._connected)

    @property
    def errors(self) -> dict[str, str]:
        return dict(self._errors)

    def get_server_status(self) -> list[dict[str, Any]]:
        """Return status for all configured servers."""
        statuses = []
        for name, cfg in self._configs.items():
            tool_count = sum(1 for t in self._tools.values() if t.server_name == name)
            status = "connected" if name in self._connected else "disconnected"
            error = self._errors.get(name)
            statuses.append({
                "name": name,
                "transport": cfg.transport,
                "status": status,
                "tools": tool_count,
                "error": error,
            })
        return statuses

    def is_mcp_tool(self, tool_name: str) -> bool:
        return tool_name in self._tools


# ---------------------------------------------------------------------------
# Config parsing helpers
# ---------------------------------------------------------------------------

def parse_mcp_configs_from_json(data: dict[str, Any]) -> list[MCPServerConfig]:
    """Parse MCP server configs from a JSON/dict (Claude Desktop format).

    Expected format:
    {
        "mcpServers": {
            "server-name": {
                "command": "...",
                "args": [...],
                "env": {...}
            }
        }
    }
    """
    configs = []
    servers = data.get("mcpServers", data.get("servers", {}))
    for name, srv in servers.items():
        if not isinstance(srv, dict):
            continue
        command = srv.get("command", "")
        args = srv.get("args", [])
        env = srv.get("env", {})
        url = srv.get("url", "")
        cwd = srv.get("cwd")
        enabled = srv.get("enabled", True)

        transport = "sse" if url and not command else "stdio"
        configs.append(MCPServerConfig(
            name=name,
            transport=transport,
            command=command,
            args=args if isinstance(args, list) else [],
            env=env if isinstance(env, dict) else {},
            cwd=cwd,
            url=url,
            enabled=enabled,
        ))
    return configs


def parse_mcp_configs_from_toml(data: dict[str, Any]) -> list[MCPServerConfig]:
    """Parse MCP server configs from TOML [mcp_servers.name] sections.

    Expected format:
    [mcp_servers.server-name]
    command = "..."
    args = ["..."]
    env = { KEY = "value" }
    """
    configs = []
    servers = data.get("mcp_servers", {})
    for name, srv in servers.items():
        if not isinstance(srv, dict):
            continue
        command = srv.get("command", "")
        args = srv.get("args", [])
        env = srv.get("env", {})
        url = srv.get("url", "")
        cwd = srv.get("cwd")
        enabled = srv.get("enabled", True)

        transport = "sse" if url and not command else "stdio"
        configs.append(MCPServerConfig(
            name=name,
            transport=transport,
            command=command,
            args=args if isinstance(args, list) else [],
            env=env if isinstance(env, dict) else {},
            cwd=cwd,
            url=url,
            enabled=enabled,
        ))
    return configs


def parse_mcp_configs_from_list(data: list[dict[str, Any]]) -> list[MCPServerConfig]:
    """Parse MCP server configs from a list of dicts (UI settings format).

    Expected format:
    [
        {
            "name": "server-name",
            "transport": "stdio",
            "command": "...",
            "args": ["..."],
            "url": "",
            "enabled": true
        }
    ]
    """
    configs = []
    for srv in data:
        if not isinstance(srv, dict):
            continue
        name = srv.get("name", "")
        if not name:
            continue
            
        command = srv.get("command", "")
        args = srv.get("args", [])
        env = srv.get("env", {})
        url = srv.get("url", "")
        cwd = srv.get("cwd")
        enabled = srv.get("enabled", True)
        transport = srv.get("transport", "stdio")

        configs.append(MCPServerConfig(
            name=name,
            transport=transport,
            command=command,
            args=args if isinstance(args, list) else [],
            env=env if isinstance(env, dict) else {},
            cwd=cwd,
            url=url,
            enabled=enabled,
        ))
    return configs
