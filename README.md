<div align="center">

# ⚡ Code Flash

**Ultra-light AI Agent Scaffolding**

**Agentic** &nbsp;·&nbsp; **Built to Extend** &nbsp;·&nbsp; **~1000 Lines of Python Core**

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

Code Flash is a minimal, hackable AI coding assistant framework. It provides a complete agentic loop with tool execution, permission management, session persistence, and a beautiful terminal UI — all in ~1000 lines of Python.

Inspired by [Claude Code](https://docs.anthropic.com/en/docs/claude-code), based on [cc-mini](https://github.com/nicobailon/cc-mini), extended with features like **Coordinator Mode**, **Buddy (AI Companion Pet)**, **KAIROS Memory**, **Skills System**, and **Sandbox Isolation**.

## ✨ Features

### Core

- **Interactive REPL** with streaming output, command history, slash command autocomplete
- **Agentic tool loop** — LLM calls tools autonomously until the task is complete
- **9 built-in tools**: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash`, `AskUser`, `EnterPlanMode`, `ExitPlanMode`
- **Plan mode** — parallel subagents explore codebase before you implement
- **Permission system** — mode-aware (default/plan), reads auto-approved, writes ask for confirmation
- **Session persistence** — auto-save conversations, `/resume` to continue later
- **Context compression** — auto-compact when approaching token limits
- **Anthropic + OpenAI compatible** — works with any compatible API endpoint

### Advanced

| Feature | Description | Docs |
|---------|-------------|------|
| **Coordinator Mode** | Background workers for parallel research and implementation | [docs →](docs/coordinator.md) |
| **Buddy** | Tamagotchi AI pet with personality, stats, mood, and speech bubbles | [docs →](docs/buddy.md) |
| **KAIROS Memory** | Cross-session memory with auto-consolidation | [docs →](docs/memory.md) |
| **Skills** | One-command workflows: `/review`, `/commit`, `/test`, `/simplify` | [docs →](docs/skills.md) |
| **Sandbox** | Bubblewrap isolation for bash commands (Linux) | [docs →](docs/sandbox.md) |
| **MCP** | Model Context Protocol — connect external tool servers | [see below](#-mcp-model-context-protocol) |

### Web UI

A full-featured web interface with real-time streaming, file explorer, and settings panel.

```bash
cd web && ./start.sh    # Production mode
cd web && ./dev.sh      # Dev mode with hot reload
```

See [web/README.md](web/README.md) for details.

---

## 🚀 Quick Start

### Requirements

- Python 3.11+ (3.12 recommended)
- An API key for [Anthropic](https://console.anthropic.com/) or any OpenAI-compatible provider

### Install

```bash
# One-line install (recommended)
curl -fsSL https://raw.githubusercontent.com/ttchu1221/code-flash/main/install.sh | bash

# Or manual
git clone https://github.com/ttchu1221/code-flash.git
cd code-flash
pip install -e ".[dev]"
```

### Set API Key

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Or OpenAI-compatible
export CODE_FLASH_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://your-gateway.example.com/v1
export CODE_FLASH_MODEL=gpt-...
```

### Run

```bash
code-flash                              # Interactive REPL
code-flash "what tests exist?"          # One-shot prompt
code-flash -p "summarize this codebase" # Print and exit
code-flash --auto-approve               # Skip permission prompts
code-flash --resume 1                   # Resume previous session
code-flash --coordinator                # Coordinator mode
```

---

## 🛠 Tools

| Tool | Description | Permission |
|------|-------------|------------|
| `Read` | Read file contents | auto-approved |
| `Glob` | Find files by pattern | auto-approved |
| `Grep` | Search file contents | auto-approved |
| `Edit` | Edit file (string replacement) | requires confirmation |
| `Write` | Write/create file | requires confirmation |
| `Bash` | Run shell command | requires confirmation |
| `AskUser` | Ask user a question | auto-approved |
| `EnterPlanMode` | Enter plan mode | auto-approved |
| `ExitPlanMode` | Exit plan mode | auto-approved |

Coordinator mode adds: `Agent` (spawn worker), `SendMessage` (continue worker), `TaskStop` (stop worker).

---

## 🔌 MCP (Model Context Protocol)

Code Flash supports the [Model Context Protocol](https://modelcontextprotocol.io/) — connect external tool servers to extend the agent's capabilities with filesystem access, databases, APIs, and more.

### Install MCP SDK

```bash
pip install -e ".[mcp]"
```

### Configuration

Create a `mcp.json` in your project root (or `~/.config/code-flash/mcp.json` for global):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "remote-api": {
      "url": "http://localhost:8080/sse"
    }
  }
}
```

Or use `config.toml`:

```toml
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]

[mcp_servers.remote-api]
url = "http://localhost:8080/sse"
```

### Commands

- `/mcp` — Show connected servers and available tools
- `/mcp reconnect` — Reconnect to all MCP servers

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CODE_FLASH_MODEL` | Model name (e.g. `claude-sonnet-4-5`) |
| `CODE_FLASH_MAX_TOKENS` | Max output tokens |
| `CODE_FLASH_EFFORT` | Reasoning effort (`low`, `medium`, `high`) |
| `CODE_FLASH_PROVIDER` | `anthropic` or `openai` |
| `CODE_FLASH_BUDDY_MODEL` | Model for companion pet reactions |
| `CODE_FLASH_BUDDY_SEED` | Override buddy seed for specific companion |

### TOML Config Files

Loaded in order (later overrides earlier):

1. `~/.config/code-flash/config.toml`
2. `.code-flash.toml` in the current working directory

```toml
# Example: .code-flash.toml
[anthropic]
api_key = "sk-ant-..."
model = "claude-sonnet-4"

[sandbox]
enabled = true
auto_allow_bash = true
```

See [docs/configuration.md](docs/configuration.md) for full details.

---

## 📁 Data Paths

| Data | Path |
|------|------|
| Installation (source code) | `~/.code-flash/` |
| Sessions | `~/.config/code-flash/sessions/` |
| Memory (KAIROS) | `~/.config/code-flash/memory/` |
| Plans | `~/.config/code-flash/plans/` |
| REPL history | `~/.config/code-flash/history` |
| Companion data | `~/.config/code-flash/companion.json` |
| User skills | `~/.config/code-flash/skills/` |
| Project skills | `{cwd}/.code-flash/skills/` |
| Project config | `.code-flash.toml` |

---

## 💬 Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/compact` | Compress conversation context |
| `/resume` | Resume a past session |
| `/history` | List saved sessions |
| `/clear` | Clear conversation, start new session |
| `/skills` | List all available skills |
| `/buddy` | Companion pet — hatch, pet, stats, mood |
| `/review` | Code review (skill) |
| `/commit` | Git commit (skill) |
| `/test` | Run tests (skill) |
| `/simplify` | Review and fix code (skill) |
| `/plan` | Enter plan mode |
| `/model` | Switch model |
| `/mcp` | Show MCP server status and tools |
| `/advisor` | Toggle advisor mode |

Type `/` to see autocomplete suggestions.

---

## 🏗 Project Structure

```
src/
├── core/                  # Pure harness — engine, LLM, config
│   ├── engine.py          # Streaming API loop + tool execution
│   ├── llm.py             # LLM client (Anthropic + OpenAI)
│   ├── config.py          # Configuration (CLI, env, TOML, MCP)
│   ├── context.py         # System prompt builder
│   ├── tool.py            # Base Tool protocol + ToolResult
│   ├── permissions.py     # Permission checker
│   ├── session.py         # Session persistence
│   ├── mcp_client.py      # MCP client manager (stdio/SSE)
│   └── mcp_tool.py        # MCP tool wrapper → Tool interface
│
├── tools/                 # Tool implementations (one per file)
│   ├── bash.py            # Shell command execution
│   ├── file_read.py       # Read files
│   ├── file_edit.py       # Edit files (string replacement)
│   ├── file_write.py      # Write/create files
│   ├── glob_tool.py       # Find files by pattern
│   ├── grep_tool.py       # Search file contents
│   ├── ask_user.py        # Ask user questions
│   ├── plan_tools.py      # EnterPlanMode / ExitPlanMode
│   └── agent.py           # Coordinator agent tools
│
├── features/              # Pluggable capabilities
│   ├── compact.py         # Context compression
│   ├── coordinator.py     # Coordinator mode
│   ├── cost_tracker.py    # Token usage tracking
│   ├── memory.py          # KAIROS memory system
│   ├── plan.py            # Plan mode logic
│   ├── skills.py          # Skill loader and registry
│   ├── skills_bundled.py  # Built-in skills
│   └── sandbox/           # Bubblewrap sandbox subsystem
│
├── tui/                   # Terminal UI
│   ├── app.py             # CLI entry point + REPL
│   ├── query.py           # Query submission + streaming display
│   ├── rendering.py       # Rich console rendering
│   └── prompt.py          # Input prompt
│
├── commands/              # Slash command handlers
├── buddy/                 # AI companion pet system
│   ├── companion.py       # Deterministic companion generation
│   ├── mood.py            # Mood engine
│   ├── sprites.py         # ASCII sprite art
│   └── poke_game/         # Idle adventure game
│
web/                       # Web UI
├── backend/               # FastAPI + WebSocket
└── frontend/              # React + TypeScript + Tailwind
```

---

## 🧪 Running Tests

```bash
pytest tests/ -v
pytest tests/ -v -k "not integration"  # skip bwrap tests
```

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| Configuration | [docs/configuration.md](docs/configuration.md) |
| Buddy (AI Companion) | [docs/buddy.md](docs/buddy.md) |
| Coordinator Mode | [docs/coordinator.md](docs/coordinator.md) |
| KAIROS Memory System | [docs/memory.md](docs/memory.md) |
| Skills | [docs/skills.md](docs/skills.md) |
| Sandbox | [docs/sandbox.md](docs/sandbox.md) |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`pytest tests/ -v`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
