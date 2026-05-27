# Skill 自动路由方案（修正版）

## 核心思路

**LLM 就是路由器。** 不需要关键词匹配、不需要额外的分类模型。

Claude Code 的做法是：
1. 把所有 skill 的 `when_to_use` 描述写进 system prompt（code-flash 已实现）
2. 提供一个 **SkillTool**，让 LLM 像调用 `Bash`、`Read` 一样调用 skill（code-flash 缺这个）
3. LLM 根据 `when_to_use` 自行判断何时调用哪个 skill

```
用户: "帮我看看这段代码有没有问题"
  │
  ▼
LLM (system prompt 中知道有 /review 技能，when_to_use="代码审查")
  │
  ├─ LLM 判断：这不就是代码审查吗？→ 调用 SkillTool(name="review")
  │    │
  │    └─ SkillTool 执行 _execute_skill(review, ...)
  │         └─ 注入 review 的 prompt → LLM 按步骤执行
  │
  └─ (如果 LLM 觉得不需要 skill → 正常回答)
```

---

## 改动清单

### 唯一需要新增的：`src/tools/skill_tool.py`

```python
"""SkillTool — 让 LLM 可以调用 skill 的工具。

类似 Claude Code 的 src/tools/SkillTool/SkillTool.ts。
LLM 通过调用此工具来触发 skill，无需用户手动输入斜杠命令。
"""

from __future__ import annotations
from .base import BaseTool, ToolResult


class SkillTool(BaseTool):
    """LLM 可调用的 skill 执行工具。"""

    name = "skill"
    description = (
        "Execute a skill by name. Skills are predefined workflows that "
        "perform multi-step tasks. Available skills and their purposes "
        "are listed in the system prompt."
    )
    parameters = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The skill name to execute (e.g. 'review', 'commit', 'test')",
            },
            "arguments": {
                "type": "string",
                "description": "Optional arguments to pass to the skill",
                "default": "",
            },
        },
        "required": ["name"],
    }

    def execute(self, name: str, arguments: str = "", **kwargs) -> ToolResult:
        from features.skills import get_skill, list_skills

        # 过滤掉 disable_model_invocation 的 skill
        skill = get_skill(name)
        if skill is None:
            available = [s.name for s in list_skills(user_invocable_only=True)]
            return ToolResult(
                output=f"Unknown skill: '{name}'. Available: {', '.join(available)}",
                is_error=True,
            )

        if skill.disable_model_invocation:
            return ToolResult(
                output=f"Skill '{name}' is not available for automatic invocation.",
                is_error=True,
            )

        prompt = skill.get_prompt(arguments)
        if not prompt:
            return ToolResult(output=f"Skill '{name}' produced no prompt.", is_error=True)

        # 返回 skill prompt，由 engine 注入到对话中执行
        return ToolResult(
            output=prompt,
            is_error=False,
            # 标记这是一个需要继续执行的 skill prompt
            _skill_injection=True,
            _skill_name=skill.name,
        )
```

### 需要修改的文件

#### 1. `src/tui/app.py` — 注册 SkillTool

在 `_build_tools_for_mode()` 中加入 SkillTool：

```python
from tools.skill_tool import SkillTool

def _build_tools_for_mode(coordinator_enabled: bool) -> bool:
    tools = _build_base_tools()
    tools.append(SkillTool())          # ← 新增
    tools.append(AskUserQuestionTool())
    # ... 其余不变
```

#### 2. `src/tui/app.py` 或 `src/core/engine.py` — 处理 SkillTool 返回

当 SkillTool 返回带 `_skill_injection=True` 标记的结果时，engine 需要将 skill prompt 作为新的用户消息注入对话，继续让 LLM 执行。

两种实现方式：

**方式 A（推荐）：SkillTool 直接返回 prompt 作为 output，LLM 自行解读执行。**

这是最简单的方式。LLM 调用 `SkillTool(name="review")` 后，收到返回的 prompt 文本，LLM 会按照 prompt 中的指令继续调用 Bash、Read 等工具。不需要特殊处理。

**方式 B：SkillTool 返回后，engine 自动注入 skill prompt 为 user message。**

更接近 Claude Code 的行为，但需要修改 engine 的 tool result 处理逻辑。

---

## System Prompt 增强（可选优化）

当前 `build_skills_prompt_section()` 已经把 skill 列表注入了 system prompt，但可以增强描述，让 LLM 更清楚何时该调用：

```python
def build_skills_prompt_section() -> str:
    skills = list_skills(user_invocable_only=False)
    if not skills:
        return ""

    lines = [
        "# Available Skills",
        "",
        "You have access to the following skills via the SkillTool. ",
        "When the user's request matches a skill's purpose (described below), ",
        "you SHOULD call the SkillTool to execute that skill instead of ",
        "handling it manually.",
        "",
    ]
    for s in skills:
        if s.disable_model_invocation:
            continue  # 不展示给 LLM，避免被调用
        desc = s.description or "(no description)"
        line = f"- **{s.name}**: {desc}"
        if s.when_to_use:
            line += f" — Use when: {s.when_to_use}"
        lines.append(line)

    return "\n".join(lines)
```

---

## `disable_model_invocation` 的作用

这个字段在 Claude Code 中就是用来控制自动触发的：

- `false`（默认）：LLM 可以自动调用
- `true`：只能通过用户手动 `/name` 触发，LLM 不会自动调用

在 SkillTool 中已做检查，在 system prompt 展示时也可跳过这些 skill。

---

## 用户手动触发 vs LLM 自动触发 — 并存

两条路径完全独立，互不干扰：

| 触发方式 | 入口 | 代码路径 |
|---------|------|---------|
| 用户手动 `/review` | `parse_command()` → `handle_command()` → `_execute_skill()` | 现有逻辑，不变 |
| LLM 自动调用 | LLM 调用 `SkillTool(name="review")` → SkillTool.execute() | 新增 |

两条路径最终都调用 `_execute_skill()` 或等价逻辑。

---

## 实施步骤

1. 创建 `src/tools/skill_tool.py` — SkillTool 实现
2. 在 `app.py` 的 `_build_tools_for_mode()` 中注册 SkillTool
3. 增强 `build_skills_prompt_section()` — 引导 LLM 主动调用
4. 在 engine 的 tool result 处理中支持 skill prompt 注入（方式 A 可能不需要额外改动）
5. 编写测试
6. 验证：用户说"帮我 review 代码"→ LLM 自动调用 SkillTool("review")

---

## 方式 A vs 方式 B 对比

| 维度 | 方式 A（LLM 读 prompt 自行执行） | 方式 B（engine 注入 user message） |
|------|-------------------------------|----------------------------------|
| 复杂度 | 低，只加一个 Tool | 高，需改 engine |
| token 消耗 | 较高（prompt 在 assistant 消息中） | 较低（prompt 作为 user 消息） |
| 行为一致性 | LLM 可能不完全按 prompt 执行 | 更像手动 `/review` 的行为 |
| 推荐度 | ✅ 先用这个，快速验证 | 后续优化 |

---

## 总结

**不需要关键词匹配，不需要额外的分类模型。只需要一个 SkillTool。**

Claude Code 的设计精髓：LLM 本身就是最好的意图识别器，给它 skill 描述 + 调用工具，它自己会判断。
