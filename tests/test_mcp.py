"""Tests for MCP client manager and tool wrapper."""
import json
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from core.mcp_client import (
    MCPClientManager,
    MCPServerConfig,
    MCPToolInfo,
    parse_mcp_configs_from_json,
    parse_mcp_configs_from_toml,
)
from core.mcp_tool import MCPTool
from core.tool import ToolResult


# ---------------------------------------------------------------------------
# MCPServerConfig tests
# ---------------------------------------------------------------------------

class TestMCPServerConfig:
    def test_default_values(self):
        cfg = MCPServerConfig(name="test")
        assert cfg.name == "test"
        assert cfg.transport == "stdio"
        assert cfg.command == ""
        assert cfg.args == []
        assert cfg.env == {}
        assert cfg.cwd is None
        assert cfg.url == ""
        assert cfg.enabled is True

    def test_stdio_config(self):
        cfg = MCPServerConfig(
            name="my-server",
            transport="stdio",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-filesystem"],
            env={"HOME": "/tmp"},
        )
        assert cfg.transport == "stdio"
        assert cfg.command == "npx"
        assert len(cfg.args) == 2

    def test_sse_config(self):
        cfg = MCPServerConfig(
            name="remote",
            transport="sse",
            url="http://localhost:8080/sse",
        )
        assert cfg.transport == "sse"
        assert cfg.url == "http://localhost:8080/sse"


# ---------------------------------------------------------------------------
# MCPToolInfo tests
# ---------------------------------------------------------------------------

class TestMCPToolInfo:
    def test_basic_info(self):
        info = MCPToolInfo(
            name="read_file",
            description="Read a file from disk",
            input_schema={"type": "object", "properties": {"path": {"type": "string"}}},
            server_name="filesystem",
        )
        assert info.name == "read_file"
        assert info.server_name == "filesystem"
        assert "path" in info.input_schema.get("properties", {})


# ---------------------------------------------------------------------------
# Config parsing tests
# ---------------------------------------------------------------------------

class TestParseMCPConfigsFromJSON:
    def test_basic_format(self):
        data = {
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                }
            }
        }
        configs = parse_mcp_configs_from_json(data)
        assert len(configs) == 1
        assert configs[0].name == "filesystem"
        assert configs[0].transport == "stdio"
        assert configs[0].command == "npx"

    def test_sse_format(self):
        data = {
            "mcpServers": {
                "remote-server": {
                    "url": "http://localhost:8080/sse",
                }
            }
        }
        configs = parse_mcp_configs_from_json(data)
        assert len(configs) == 1
        assert configs[0].name == "remote-server"
        assert configs[0].transport == "sse"
        assert configs[0].url == "http://localhost:8080/sse"

    def test_disabled_server(self):
        data = {
            "mcpServers": {
                "disabled": {
                    "command": "echo",
                    "enabled": False,
                }
            }
        }
        configs = parse_mcp_configs_from_json(data)
        assert len(configs) == 1
        assert configs[0].enabled is False

    def test_alternative_key(self):
        data = {
            "servers": {
                "my-server": {
                    "command": "python",
                    "args": ["server.py"],
                }
            }
        }
        configs = parse_mcp_configs_from_json(data)
        assert len(configs) == 1
        assert configs[0].name == "my-server"

    def test_empty_config(self):
        configs = parse_mcp_configs_from_json({})
        assert configs == []

    def test_multiple_servers(self):
        data = {
            "mcpServers": {
                "server1": {"command": "cmd1"},
                "server2": {"command": "cmd2", "args": ["arg1"]},
            }
        }
        configs = parse_mcp_configs_from_json(data)
        assert len(configs) == 2
        names = {c.name for c in configs}
        assert names == {"server1", "server2"}

    def test_env_dict(self):
        data = {
            "mcpServers": {
                "server": {
                    "command": "cmd",
                    "env": {"API_KEY": "secret"},
                }
            }
        }
        configs = parse_mcp_configs_from_json(data)
        assert configs[0].env == {"API_KEY": "secret"}


class TestParseMCPConfigsFromTOML:
    def test_basic_toml(self):
        data = {
            "mcp_servers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem"],
                }
            }
        }
        configs = parse_mcp_configs_from_toml(data)
        assert len(configs) == 1
        assert configs[0].name == "filesystem"
        assert configs[0].transport == "stdio"

    def test_sse_toml(self):
        data = {
            "mcp_servers": {
                "remote": {
                    "url": "http://localhost:8080/sse",
                }
            }
        }
        configs = parse_mcp_configs_from_toml(data)
        assert len(configs) == 1
        assert configs[0].transport == "sse"

    def test_empty_toml(self):
        configs = parse_mcp_configs_from_toml({})
        assert configs == []


# ---------------------------------------------------------------------------
# MCPClientManager tests
# ---------------------------------------------------------------------------

class TestMCPClientManager:
    def test_initial_state(self):
        mgr = MCPClientManager()
        assert mgr.tools == {}
        assert mgr.connected_servers == set()
        assert mgr.errors == {}

    def test_add_and_remove_server(self):
        mgr = MCPClientManager()
        cfg = MCPServerConfig(name="test", command="echo")
        mgr.add_server(cfg)
        assert "test" in mgr._configs

        mgr.remove_server("test")
        assert "test" not in mgr._configs

    def test_load_configs(self):
        mgr = MCPClientManager()
        configs = [
            MCPServerConfig(name="s1", command="cmd1"),
            MCPServerConfig(name="s2", command="cmd2", enabled=False),
        ]
        mgr.load_configs(configs)
        # Only enabled servers are loaded
        assert "s1" in mgr._configs
        assert "s2" not in mgr._configs

    def test_get_server_status_empty(self):
        mgr = MCPClientManager()
        assert mgr.get_server_status() == []

    def test_get_server_status_with_configs(self):
        mgr = MCPClientManager()
        mgr.add_server(MCPServerConfig(name="s1", command="cmd"))
        statuses = mgr.get_server_status()
        assert len(statuses) == 1
        assert statuses[0]["name"] == "s1"
        assert statuses[0]["status"] == "disconnected"
        assert statuses[0]["tools"] == 0

    def test_is_mcp_tool_false(self):
        mgr = MCPClientManager()
        assert mgr.is_mcp_tool("Read") is False

    def test_call_tool_unknown(self):
        mgr = MCPClientManager()
        content, is_error = mgr.call_tool("nonexistent", {})
        assert is_error is True
        assert "Unknown MCP tool" in content

    def test_call_tool_disconnected(self):
        mgr = MCPClientManager()
        info = MCPToolInfo(name="test_tool", description="test", input_schema={}, server_name="s1")
        mgr._tools["test_tool"] = info
        # Session not connected
        content, is_error = mgr.call_tool("test_tool", {})
        assert is_error is True
        assert "not connected" in content

    @patch("core.mcp_client.MCPClientManager._ensure_loop")
    @patch("core.mcp_client.MCPClientManager._run_async")
    def test_connect_all_no_configs(self, mock_run_async, mock_ensure_loop):
        mgr = MCPClientManager()
        tools = mgr.connect_all()
        assert tools == []
        mock_ensure_loop.assert_not_called()

    def test_disconnect_all_idempotent(self):
        mgr = MCPClientManager()
        # Should not raise even when nothing is connected
        mgr.disconnect_all()
        mgr.disconnect_all()  # second call should be safe


# ---------------------------------------------------------------------------
# MCPTool wrapper tests
# ---------------------------------------------------------------------------

class TestMCPTool:
    def _make_tool(self, name="test_tool", description="A test tool", server_name="test-server"):
        info = MCPToolInfo(
            name=name,
            description=description,
            input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
            server_name=server_name,
        )
        mock_manager = MagicMock(spec=MCPClientManager)
        return MCPTool(info, mock_manager), mock_manager

    def test_name(self):
        tool, _ = self._make_tool()
        assert tool.name == "test_tool"

    def test_description_includes_server(self):
        tool, _ = self._make_tool(description="Does something")
        assert "Does something" in tool.description
        assert "[MCP: test-server]" in tool.description

    def test_input_schema(self):
        tool, _ = self._make_tool()
        schema = tool.input_schema
        assert schema["type"] == "object"
        assert "query" in schema.get("properties", {})

    def test_input_schema_default_type(self):
        info = MCPToolInfo(name="t", description="d", input_schema={}, server_name="s")
        mock_mgr = MagicMock(spec=MCPClientManager)
        tool = MCPTool(info, mock_mgr)
        assert tool.input_schema["type"] == "object"

    def test_execute_success(self):
        tool, mock_mgr = self._make_tool()
        mock_mgr.call_tool.return_value = ("result text", False)
        result = tool.execute(query="hello")
        assert isinstance(result, ToolResult)
        assert result.content == "result text"
        assert result.is_error is False
        mock_mgr.call_tool.assert_called_once_with("test_tool", {"query": "hello"})

    def test_execute_error(self):
        tool, mock_mgr = self._make_tool()
        mock_mgr.call_tool.return_value = ("something went wrong", True)
        result = tool.execute(query="hello")
        assert result.is_error is True
        assert "something went wrong" in result.content

    def test_execute_exception(self):
        tool, mock_mgr = self._make_tool()
        mock_mgr.call_tool.side_effect = RuntimeError("connection lost")
        result = tool.execute(query="hello")
        assert result.is_error is True
        assert "connection lost" in result.content

    def test_is_read_only(self):
        tool, _ = self._make_tool()
        assert tool.is_read_only() is False

    def test_activity_description(self):
        tool, _ = self._make_tool()
        desc = tool.get_activity_description(query="test")
        assert "test_tool" in desc

    def test_to_api_schema(self):
        tool, _ = self._make_tool()
        schema = tool.to_api_schema()
        assert schema["name"] == "test_tool"
        assert "description" in schema
        assert "input_schema" in schema


# ---------------------------------------------------------------------------
# Config loading integration tests
# ---------------------------------------------------------------------------

class TestLoadMCPConfigs:
    def test_load_from_json_file(self, tmp_path):
        from core.config import load_mcp_configs

        mcp_json = tmp_path / "mcp.json"
        mcp_json.write_text(json.dumps({
            "mcpServers": {
                "test-server": {
                    "command": "python",
                    "args": ["server.py"],
                }
            }
        }))

        with patch("core.config._MCP_JSON_PATHS", (mcp_json,)):
            configs = load_mcp_configs()
        assert len(configs) == 1
        assert configs[0].name == "test-server"

    def test_load_from_toml(self, tmp_path):
        from core.config import load_mcp_configs

        toml_path = tmp_path / "config.toml"
        toml_content = """
[mcp_servers.my-server]
command = "npx"
args = ["-y", "server"]
"""
        toml_path.write_text(toml_content)

        with patch("core.config._MCP_JSON_PATHS", ()):
            configs = load_mcp_configs(config_paths=(toml_path,))
        assert len(configs) == 1
        assert configs[0].name == "my-server"

    def test_empty_when_no_files(self):
        from core.config import load_mcp_configs

        with patch("core.config._MCP_JSON_PATHS", ()):
            configs = load_mcp_configs(config_paths=())
        assert configs == []

    def test_deduplication(self, tmp_path):
        """Project-level mcp.json takes precedence over user-level."""
        from core.config import load_mcp_configs

        json1 = tmp_path / "mcp1.json"
        json1.write_text(json.dumps({
            "mcpServers": {"server-a": {"command": "cmd1"}}
        }))
        json2 = tmp_path / "mcp2.json"
        json2.write_text(json.dumps({
            "mcpServers": {"server-a": {"command": "cmd2"}, "server-b": {"command": "cmd3"}}
        }))

        with patch("core.config._MCP_JSON_PATHS", (json1, json2)):
            configs = load_mcp_configs()

        names = [c.name for c in configs]
        assert names.count("server-a") == 1  # not duplicated
        assert "server-b" in names
