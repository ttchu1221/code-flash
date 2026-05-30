"""Slash command system — parsing and dispatch.

Modelled after claude-code's ``src/commands.ts``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from rich.console import Console
from rich.table import Table

from features.coordinator import current_session_mode, match_session_mode

if TYPE_CHECKING:
    from features.compact import CompactService
    from core.config import AppConfig
    from features.cost_tracker import CostTracker
    from core.engine import Engine
    from core.permissions import PermissionChecker
    from core.session import SessionStore


# ---------------------------------------------------------------------------
# Context bundle passed to every command handler
# ---------------------------------------------------------------------------

@dataclass
class CommandContext:
    engine: Engine
    session_store: SessionStore | None
    compact_service: CompactService
    console: Console
    app_config: AppConfig
    memory_dir: Path | None = None
    permissions: PermissionChecker | None = None
    run_dream: object = None
    cost_tracker: CostTracker | None = None
    new_session_store: object = None
    reconfigure_mode: object = None
    plan_manager: object = None
    mcp_manager: object = None  # MCPClientManager instance
    pending_query: str | None = None  # set by commands that want a follow-up model query


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_command(text: str) -> tuple[str, str] | None:
    """If *text* starts with ``/``, return ``(command_name, args)``."""
    text = text.strip()
    if not text.startswith("/"):
        return None
    parts = text.split(None, 1)
    name = parts[0][1:].lower()  # strip leading /
    args = parts[1] if len(parts) > 1 else ""
    return name, args


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _cmd_help(ctx: CommandContext, args: str) -> None:
    table = Table(title="可用命令", show_header=True, header_style="bold cyan")
    table.add_column("命令", style="green")
    table.add_column("描述")
    for name, desc, _ in _COMMAND_TABLE:
        table.add_row(f"/{name}", desc)
    ctx.console.print(table)


def _cmd_compact(ctx: CommandContext, args: str) -> None:
    from features.compact import estimate_tokens

    messages = ctx.engine.get_messages()
    if len(messages) < 4:
        ctx.console.print("[dim]消息太少，无法压缩。[/dim]")
        return

    pre_tokens = estimate_tokens(messages)
    ctx.console.print(f"[dim]正在压缩 {len(messages)} 条消息（约 {pre_tokens:,} tokens）…[/dim]")

    new_msgs, summary = ctx.compact_service.compact(
        messages, ctx.engine.system_prompt, custom_instructions=args,
    )
    ctx.engine.set_messages(new_msgs)

    # Persist compacted state to a fresh session store if available
    if ctx.session_store is not None:
        _persist_compacted(ctx, new_msgs)

    post_tokens = estimate_tokens(new_msgs)
    ctx.console.print(
        f"[green]✓[/green] 压缩完成: {pre_tokens:,} → {post_tokens:,} tokens "
        f"({len(messages)} → {len(new_msgs)} 条消息)"
    )


def _persist_compacted(ctx: CommandContext, new_msgs: list[dict]) -> None:
    """Re-write the current session with compacted messages."""
    if ctx.session_store is None:
        return
    # Create a new session store pointing to the same session id,
    # overwrite the JSONL with the compacted messages.
    import json
    from core.session import _serialize_message, _now_iso
    path = ctx.session_store._jsonl_path
    with open(path, "w", encoding="utf-8") as fh:
        for msg in new_msgs:
            safe = _serialize_message(msg)
            safe["_ts"] = _now_iso()
            fh.write(json.dumps(safe, ensure_ascii=False) + "\n")
    ctx.session_store._message_count = len(new_msgs)
    ctx.session_store._save_meta()


def _cmd_history(ctx: CommandContext, args: str) -> None:
    from core.session import SessionStore

    cwd = str(os.getcwd())
    sessions = SessionStore.list_sessions(cwd)
    if not sessions:
        ctx.console.print("[dim]当前目录没有保存的会话。[/dim]")
        return

    table = Table(title="会话历史", show_header=True, header_style="bold cyan")
    table.add_column("#", style="dim", width=4)
    table.add_column("ID", style="dim", width=10)
    table.add_column("标题")
    table.add_column("消息数", justify="right", width=8)
    table.add_column("更新时间", width=20)

    for i, meta in enumerate(sessions, 1):
        table.add_row(
            str(i),
            meta.session_id[:8],
            meta.title[:50],
            str(meta.message_count),
            meta.updated_at[:19].replace("T", " "),
        )
    ctx.console.print(table)


def _cmd_resume(ctx: CommandContext, args: str) -> None:
    from core.session import SessionStore

    cwd = str(os.getcwd())
    sessions = SessionStore.list_sessions(cwd)

    if not sessions:
        ctx.console.print("[dim]没有可恢复的会话。[/dim]")
        return

    if not args:
        # Show list and ask user to pick
        _cmd_history(ctx, "")
        ctx.console.print("\n[dim]用法: /resume <序号> 或 /resume <会话ID>[/dim]")
        return

    # Try as numeric index
    target_meta = None
    try:
        idx = int(args.strip()) - 1
        if 0 <= idx < len(sessions):
            target_meta = sessions[idx]
    except ValueError:
        pass

    # Try as session-id prefix
    if target_meta is None:
        needle = args.strip().lower()
        for meta in sessions:
            if meta.session_id.lower().startswith(needle):
                target_meta = meta
                break

    if target_meta is None:
        ctx.console.print(f"[red]未找到会话: {args}[/red]")
        return

    # Skip if resuming the current session
    if ctx.session_store and target_meta.session_id == ctx.session_store.session_id:
        ctx.console.print("[dim]当前已在该会话中。[/dim]")
        return

    # Load messages
    meta, messages = SessionStore.load_session(target_meta.session_id, cwd)
    if not messages:
        ctx.console.print("[red]会话中没有消息。[/red]")
        return

    warning = None
    session_mode = meta.mode if meta is not None else None
    if callable(ctx.reconfigure_mode):
        warning = ctx.reconfigure_mode(session_mode)
    else:
        warning = match_session_mode(session_mode)

    # Create new session store pointing to the resumed session
    new_store = ctx.new_session_store  # type: ignore[call-arg]
    resumed_store = type(ctx.session_store)(  # type: ignore[arg-type]
        cwd=cwd,
        model=ctx.app_config.model,
        session_id=target_meta.session_id,
        mode=current_session_mode(),
    ) if ctx.session_store else None

    ctx.engine.set_messages(messages)
    if resumed_store is not None:
        ctx.engine.set_session_store(resumed_store)
        ctx.session_store = resumed_store  # type: ignore[assignment]

    ctx.console.print(
        f"[green]✓[/green] 已恢复会话 [bold]{target_meta.session_id[:8]}[/bold]: "
        f"{target_meta.title[:50]}  ({len(messages)} 条消息)"
    )
    if warning:
        ctx.console.print(f"[yellow]{warning}[/yellow]")


def _cmd_clear(ctx: CommandContext, args: str) -> None:
    ctx.engine.set_messages([])
    if callable(ctx.new_session_store):
        new_store = ctx.new_session_store()
        ctx.engine.set_session_store(new_store)
        ctx.session_store = new_store  # type: ignore[assignment]
    ctx.console.print("[green]✓[/green] 对话已清除。新会话已开始。")


def _cmd_memory(ctx: CommandContext, args: str) -> None:
    from features.memory import load_memory_index

    if ctx.memory_dir is None:
        ctx.console.print("[dim]记忆系统未配置。[/dim]")
        return
    index = load_memory_index(ctx.memory_dir)
    if index:
        ctx.console.print(index)
    else:
        ctx.console.print("[dim]暂无记忆。使用 /dream 整合每日日志。[/dim]")


def _cmd_remember(ctx: CommandContext, args: str) -> None:
    from features.memory import append_to_daily_log

    if ctx.memory_dir is None:
        ctx.console.print("[dim]记忆系统未配置。[/dim]")
        return
    if not args.strip():
        ctx.console.print("[dim]用法: /remember <文本>[/dim]")
        return
    append_to_daily_log(ctx.memory_dir, args.strip())
    ctx.console.print("[dim]已保存到每日日志。[/dim]")


def _cmd_dream(ctx: CommandContext, args: str) -> None:
    if ctx.run_dream is None or not callable(ctx.run_dream):
        ctx.console.print("[dim]Dream 功能不可用。[/dim]")
        return
    ctx.run_dream()


def _cmd_skills(ctx: CommandContext, args: str) -> None:
    """List all available skills."""
    from features.skills import list_skills

    skills = list_skills(user_invocable_only=True)
    if not skills:
        ctx.console.print("[dim]暂无可用技能。[/dim]")
        return

    table = Table(title="可用技能", show_header=True, header_style="bold cyan")
    table.add_column("命令", style="green")
    table.add_column("来源", style="dim", width=8)
    table.add_column("描述")
    for s in skills:
        hint = f" [{s.argument_hint}]" if s.argument_hint else ""
        table.add_row(f"/{s.name}{hint}", s.source, s.description)
    ctx.console.print(table)
def _cmd_cost(ctx: CommandContext, args: str) -> None:
    if ctx.cost_tracker is None:
        ctx.console.print("[dim]成本跟踪不可用。[/dim]")
        return
    ctx.console.print(ctx.cost_tracker.format_cost())


def _cmd_model(ctx: CommandContext, args: str) -> None:
    import json
    from core.config import resolve_model, default_max_tokens_for_model, DEFAULT_MODEL

    provider = ctx.app_config.provider
    
    # 从 settings.json 加载环境变量
    config_paths = [
        Path.home() / ".config" / "code-flash" / "settings.json",
        Path(__file__).parent.parent.parent.parent / "settings.json",
    ]
    for path in config_paths:
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                env_vars = settings.get("env", {})
                for key, value in env_vars.items():
                    if key not in os.environ:
                        os.environ[key] = value
            except Exception:
                pass
            break

    if args:
        ctx.engine.set_model(args.strip())
        actual = ctx.engine.get_model()
        ctx.console.print(
            f"[green]✓[/green] 模型已设置为 [bold]{actual}[/bold]  "
            f"(max_tokens={default_max_tokens_for_model(actual, provider=provider)})")
        return

    current = ctx.engine.get_model()

    # 使用之前查找的 settings.json 路径
    settings_path = path if path.exists() else None
    
    custom_models = []
    if settings_path is not None and settings_path.exists():
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
            model_providers = settings.get("modelProviders", {})
            # 优先使用 openai 接口（兼容 OpenAI 格式）
            openai_models = model_providers.get("openai", [])
            for model in openai_models:
                model_id = model.get("id", "")
                model_name = model.get("name", model_id)
                base_url = model.get("baseUrl", "")
                if model_id:
                    desc = base_url if base_url else "OpenAI 兼容接口"
                    custom_models.append((model_id, model_name, desc))

            # 也加载 anthropic 接口的模型（跳过 "claude" 占位符）
            anthropic_models = model_providers.get("anthropic", [])
            for model in anthropic_models:
                model_id = model.get("id", "")
                model_name = model.get("name", model_id)
                base_url = model.get("baseUrl", "")
                if model_id and model_id != "claude":  # 跳过占位符
                    desc = base_url if base_url else "API 接口"
                    custom_models.append((model_id, model_name, desc))
        except Exception as e:
            import sys
            print(f"[debug] 加载 settings.json 失败: {e}", file=sys.stderr)
            pass

    # 如果设置了自定义模型，使用自定义列表；否则使用内置 Anthropic 模型
    if custom_models:
        options = custom_models
    else:
        # 对于非 Anthropic provider 且没有自定义模型的情况
        if provider != "anthropic":
            ctx.console.print(
                f"[dim]当前模型: {current}[/dim]\n"
                f"[dim]使用 /model <名称> 切换 {provider} 提供商的模型。[/dim]"
            )
            return
        
        # Marketing name lookup（仅在使用内置 Anthropic 模型时）
        _NAMES = {
            "claude-sonnet-4-6": "Sonnet 4.6", "claude-sonnet-4-5": "Sonnet 4.5",
            "claude-sonnet-4": "Sonnet 4", "claude-opus-4-6": "Opus 4.6",
            "claude-opus-4-5": "Opus 4.5", "claude-opus-4-1": "Opus 4.1",
            "claude-opus-4": "Opus 4", "claude-haiku-4-5": "Haiku 4.5",
            "claude-3-5-haiku": "Haiku 3.5",
        }
        display = next((n for p, n in _NAMES.items() if p in current), "Sonnet 4.6")

        # (alias, label, description) — from modelOptions.ts PAYG 1P path
        options = [
            (DEFAULT_MODEL, "默认 (推荐)", f"使用默认模型 (当前 {display}) · $3/$15 per Mtok"),
            ("sonnet",      "Sonnet",                "Sonnet 4.6 · 适合日常任务 · $3/$15 per Mtok"),
            ("opus",        "Opus",                  "Opus 4.6 · 适合复杂工作 · $5/$25 per Mtok"),
            ("haiku",       "Haiku",                 "Haiku 4.5 · 快速回答 · $1/$5 per Mtok"),
        ]

    # 使用 prompt_toolkit 显示选择界面
    from prompt_toolkit import Application
    from prompt_toolkit.key_binding import KeyBindings
    from prompt_toolkit.layout import Layout
    from prompt_toolkit.layout.containers import Window
    from prompt_toolkit.layout.controls import FormattedTextControl

    cursor = [0]
    for i, (alias, _, _) in enumerate(options):
        if resolve_model(alias) == current:
            cursor[0] = i
            break

    result: list[str | None] = [None]
    max_label = max(len(l) for _, l, _ in options)

    kb = KeyBindings()

    @kb.add("up")
    def _(e): cursor.__setitem__(0, (cursor[0] - 1) % len(options))
    @kb.add("down")
    def _(e): cursor.__setitem__(0, (cursor[0] + 1) % len(options))
    @kb.add("enter")
    def _(e):
        result[0] = options[cursor[0]][0]
        e.app.exit()

    for i in range(min(len(options), 9)):
        @kb.add(str(i + 1))
        def _(e, idx=i):
            cursor[0] = idx
            result[0] = options[idx][0]
            e.app.exit()

    @kb.add("escape")
    @kb.add("c-c")
    def _(e): e.app.exit()

    def _tokens():
        t = [("bold ansibrightcyan", "  选择模型\n"),
             ("ansigray", "  切换模型。适用于当前会话及未来会话。\n"
                          "  对于其他/之前的模型名称，请使用 --model指定。\n\n")]
        for i, (alias, label, desc) in enumerate(options):
            is_cur = i == cursor[0]
            is_active = resolve_model(alias) == current
            ptr = "❯" if is_cur else " "
            sty = "ansibrightcyan" if is_cur else ""
            chk = " ✔" if is_active else ""
            t.append((sty, f"  {ptr} {i+1}. {(label + chk).ljust(max_label + 3)}"))
            t.append(("ansigray", desc))
            t.append(("", "\n"))
        t.append(("ansigray", "  ↑↓ 选择 · ↵ 确认 · esc 取消"))
        return t

    app: Application = Application(
        layout=Layout(Window(FormattedTextControl(_tokens))),
        key_bindings=kb, full_screen=False)

    try:
        app.run()
    except (EOFError, KeyboardInterrupt):
        pass

    if result[0] is None:
        ctx.console.print(f"[dim]保持模型为 {current}[/dim]")
        return

    # 获取选择的模型配置（包括 API key 和 base_url）
    selected_model = result[0]
    model_config = None
    for m in custom_models:
        if m[0] == selected_model:
            model_config = m
            break
    
    # 设置模型
    ctx.engine.set_model(selected_model)
    actual = ctx.engine.get_model()
    
    # 如果有模型配置，尝试更新 API key 和 base_url
    if model_config and len(model_config) >= 3:
        # 从 settings.json 加载对应的 envKey 并判断 provider
        if settings_path is not None:
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                model_providers = settings.get("modelProviders", {})

                # 判断选中的模型属于哪个 provider
                resolved_provider = None
                openai_models = model_providers.get("openai", [])
                anthropic_models = model_providers.get("anthropic", [])
                for m in openai_models:
                    if m.get("id") == selected_model:
                        resolved_provider = "openai"
                        break
                if resolved_provider is None:
                    for m in anthropic_models:
                        if m.get("id") == selected_model:
                            resolved_provider = "anthropic"
                            break

                all_models = openai_models + anthropic_models
                for m in all_models:
                    if m.get("id") == selected_model:
                        env_key = m.get("envKey")
                        base_url = m.get("baseUrl")
                        if env_key and env_key in os.environ:
                            api_key = os.environ[env_key]
                            # 确定使用哪个 provider
                            use_provider = resolved_provider or "openai"
                            # 更新 engine 的 provider 和配置
                            ctx.engine._provider = use_provider
                            # 重新创建 LLM 客户端
                            from core.llm import LLMClient
                            ctx.engine._client = LLMClient(
                                provider=use_provider,
                                api_key=api_key,
                                base_url=base_url,
                            )
                            ctx.console.print(f"[dim]已加载 API Key ({env_key}) 和 Base URL ({use_provider})[/dim]")
                        break
            except Exception:
                pass
    
    ctx.console.print(
        f"[green]✓[/green] 模型已设置为 [bold]{actual}[/bold]  "
        f"(max_tokens={default_max_tokens_for_model(actual, provider=provider)})"
    )

    # 暂时禁用model_state功能
    # Persist model state for next launch
    # from core.model_state import save_model_state
    # save_model_state(
    #     model=actual,
    #     provider=ctx.engine._provider,
    #     base_url=ctx.engine._client._base_url or "",
    # )


def _cmd_plan(ctx: CommandContext, args: str) -> None:
    """Enter plan mode or show current plan."""
    from features.plan import PlanModeManager
    pm: PlanModeManager | None = ctx.plan_manager  # type: ignore[assignment]
    if pm is None:
        ctx.console.print("[red]计划模式不可用。[/red]")
        return
    if pm.is_active:
        content = pm.get_plan_content()
        if content:
            ctx.console.print(f"[bold]当前计划[/bold] ({pm.plan_file_path}):\n")
            ctx.console.print(content)
        else:
            ctx.console.print(f"[dim]计划模式已激活，但尚未写入计划。文件: {pm.plan_file_path}[/dim]")
    else:
        pm.enter()
        ctx.console.print("[green]已启用计划模式[/green]")
        # If user provided a description, queue it as a follow-up query
        # Matches TS: onDone('Enabled plan mode', { shouldQuery: true })
        description = args.strip()
        if description:
            ctx.pending_query = description


def _cmd_advisor(ctx: CommandContext, args: str) -> None:
    """Toggle advisor mode (consult a stronger model during inference)."""
    engine = ctx.engine
    if engine._provider != "anthropic":
        ctx.console.print("[red]Advisor 仅适用于 Anthropic 提供商[/red]")
        return
    enabled = engine.toggle_advisor()
    status = "已启用" if enabled else "已禁用"
    ctx.console.print(
        f"[green]Advisor {status}[/green]"
        f"  (模型: {engine._advisor_model}, 最大使用次数: {engine._advisor_max_uses})"
    )


def _cmd_mcp(ctx: CommandContext, args: str) -> None:
    """Show MCP server status, list tools, or reconnect."""
    mgr = ctx.mcp_manager
    if mgr is None:
        ctx.console.print("[dim]MCP 未初始化。[/dim]")
        return

    subcmd = args.strip().lower()

    if subcmd == "reconnect":
        ctx.console.print("[dim]正在重新连接 MCP 服务器…[/dim]")
        mgr.disconnect_all()
        from core.mcp_client import MCPClientManager
        from core.config import load_mcp_configs
        mcp_configs = load_mcp_configs(ctx.app_config.config_paths)
        if mcp_configs:
            mgr.load_configs(mcp_configs)
            tools = mgr.connect_all()
            ctx.console.print(f"[green]✓[/green] 已重连, 发现 {len(tools)} 个工具")
            # Update engine tools
            ctx.engine.set_tools(_rebuild_engine_tools(ctx, mgr))
        else:
            ctx.console.print("[dim]未找到 MCP 服务器配置。[/dim]")
        return

    # Default: show status
    statuses = mgr.get_server_status()
    if not statuses:
        ctx.console.print("[dim]未配置 MCP 服务器。[/dim]")
        ctx.console.print("[dim]在 mcp.json 或 config.toml 的 [mcp_servers] 中配置。[/dim]")
        return

    table = Table(title="MCP 服务器", show_header=True, header_style="bold cyan")
    table.add_column("名称", style="green")
    table.add_column("传输", style="dim", width=6)
    table.add_column("状态", width=12)
    table.add_column("工具数", justify="right", width=6)
    table.add_column("错误", style="red")

    for s in statuses:
        status_icon = "[green]● 已连接[/green]" if s["status"] == "connected" else "[red]● 断开[/red]"
        error = s.get("error", "")
        if error:
            error = error[:60] + "…" if len(error) > 60 else error
        table.add_row(s["name"], s["transport"], status_icon, str(s["tools"]), error)

    ctx.console.print(table)

    # List tools
    tools = mgr.tools
    if tools:
        ctx.console.print()
        tool_table = Table(title="MCP 工具", show_header=True, header_style="bold cyan")
        tool_table.add_column("工具名", style="green")
        tool_table.add_column("服务器", style="dim", width=12)
        tool_table.add_column("描述")

        for name, info in sorted(tools.items()):
            desc = info.description[:60] + "…" if len(info.description) > 60 else info.description
            tool_table.add_row(name, info.server_name, desc)

        ctx.console.print(tool_table)


def _rebuild_engine_tools(ctx: CommandContext, mcp_mgr) -> list:
    """Rebuild the engine's tool list with current MCP tools."""
    from core.mcp_tool import MCPTool
    tools = []
    for name, tool in ctx.engine._tools.items():
        if not isinstance(tool, MCPTool):
            tools.append(tool)
    for info in mcp_mgr.tools.values():
        tools.append(MCPTool(info, mcp_mgr))
    return tools


# (name, description, handler)
_COMMAND_TABLE: list[tuple[str, str, object]] = [
    ("help",     "显示可用命令",                         _cmd_help),
    ("compact",  "压缩对话上下文 [指令]",    _cmd_compact),
    ("resume",   "恢复过去的会话 [序号|会话ID]",       _cmd_resume),
    ("history",  "列出当前目录保存的会话",          _cmd_history),
    ("clear",    "清除对话，开始新会话",           _cmd_clear),
    ("memory",   "显示当前记忆索引",                       _cmd_memory),
    ("remember", "保存笔记到每日日志 [文本]",             _cmd_remember),
    ("dream",    "将每日日志整合为主题文件",          _cmd_dream),
    ("skills",   "列出所有可用技能",                       _cmd_skills),
    ("cost",    "显示 Token 使用和成本摘要",               _cmd_cost),
    ("model",   "显示或切换模型 [模型名称]",               _cmd_model),
    ("plan",    "进入计划模式或显示当前计划",             _cmd_plan),
    ("advisor", "切换 Advisor 模式 (咨询更强大的模型)",  _cmd_advisor),
    ("mcp",     "查看 MCP 服务器状态和工具 [reconnect]", _cmd_mcp),
]

_HANDLERS: dict[str, object] = {name: handler for name, _, handler in _COMMAND_TABLE}


def handle_command(name: str, args: str, ctx: CommandContext) -> bool:
    """Dispatch slash command. Returns True if handled, False otherwise.

    If *name* does not match a built-in command, checks the skill registry
    and executes the skill inline (prompt injection) or forked (isolated turn).
    """
    handler = _HANDLERS.get(name)
    if handler is not None:
        handler(ctx, args)  # type: ignore[operator]
        return True

    # Try as a skill invocation
    from features.skills import get_skill
    skill = get_skill(name)
    if skill is not None:
        return _execute_skill(skill, args, ctx)

    ctx.console.print(f"[red]未知命令: /{name}[/red]  (try /help 或 /skills)")
    return False


def _execute_skill(skill, args: str, ctx: CommandContext) -> bool:
    """Execute a skill — inline or forked.

    Inline (default): inject the skill prompt as a user message into the
    current conversation and let the engine process it.

    Forked: run the skill in an isolated turn (save messages, clear, run,
    restore original messages).  Matches claude-code's ``context: 'fork'``.
    """
    from tui.query import run_query

    prompt = skill.get_prompt(args)
    if not prompt:
        ctx.console.print(f"[dim]技能 /{skill.name} 未生成提示词。[/dim]")
        return True

    ctx.console.print(f"[dim]正在运行技能: /{skill.name}…[/dim]")

    if skill.context == "fork":
        # Forked execution: isolated turn
        saved = list(ctx.engine.get_messages())
        ctx.engine.set_messages([])
        try:
            permissions = ctx.permissions
            run_query(ctx.engine, prompt, print_mode=False, permissions=permissions)
        finally:
            # Restore original messages (forked result is ephemeral)
            ctx.engine.set_messages(saved)
    else:
        # Inline execution: inject prompt into ongoing conversation
        permissions = ctx.permissions
        run_query(ctx.engine, prompt, print_mode=False, permissions=permissions)

    return True
