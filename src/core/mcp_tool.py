"""MCP tool wrapper — adapts MCP tools to code-flash's Tool interface."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from core.tool import Tool, ToolResult

if TYPE_CHECKING:
    from core.mcp_client import MCPClientManager, MCPToolInfo

logger = logging.getLogger(__name__)


class MCPTool(Tool):
    """Wraps an MCP server tool as a code-flash Tool.

    Each MCPTool instance represents one tool exposed by an MCP server.
    Tool calls are forwarded to the MCPClientManager which routes them
    to the correct server.
    """

    def __init__(self, info: MCPToolInfo, client_manager: MCPClientManager) -> None:
        self._info = info
        self._client = client_manager

    @property
    def name(self) -> str:
        return self._info.name

    @property
    def description(self) -> str:
        server_tag = f" [MCP: {self._info.server_name}]"
        return f"{self._info.description}{server_tag}"

    @property
    def input_schema(self) -> dict:
        schema = dict(self._info.input_schema)
        # Ensure 'type' is set (some MCP servers omit it)
        if "type" not in schema:
            schema["type"] = "object"
        return schema

    def execute(self, **kwargs) -> ToolResult:
        logger.info(f"MCP tool call: {self._info.name} -> {self._info.server_name}")
        try:
            content, is_error = self._client.call_tool(self._info.name, kwargs)
            return ToolResult(content=content, is_error=is_error)
        except Exception as e:
            return ToolResult(content=f"MCP tool execution error: {e}", is_error=True)

    def get_activity_description(self, **kwargs) -> str | None:
        return f"Calling MCP tool: {self._info.name}"

    def is_read_only(self) -> bool:
        # MCP tools are treated as non-read-only by default since we can't
        # determine their side effects from schema alone.
        return False
