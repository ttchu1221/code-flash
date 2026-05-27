from __future__ import annotations
import os
import sys
import select
from typing import Literal, TYPE_CHECKING
from .tool import Tool

if TYPE_CHECKING:
    from tui.keylistener import EscListener
    from features.sandbox.manager import SandboxManager
    from features.plan import PlanModeManager

PermissionBehavior = Literal["allow", "deny"]

# Tools allowed in plan mode (read-only + plan file writes + agent tools)
_PLAN_MODE_ALLOWED_TOOLS = {
    "Read", "Glob", "Grep", "AskUserQuestion",
    "EnterPlanMode", "ExitPlanMode",
    "Agent", "SendMessage", "TaskStop",
}
_PLAN_MODE_WRITE_TOOLS = {"Edit", "Write"}  # allowed only for plan file

# The 4 permission modes, cycled by Shift+Tab
MODES: list[str] = ["default", "plan", "auto_edit", "auto_approve"]
_MODE_LABELS: dict[str, str] = {
    "default":      "Default",
    "plan":         "Plan",
    "auto_edit":    "Auto Edit",
    "auto_approve": "Auto",
}


class PermissionChecker:
    """Read-only tools are auto-allowed. Bash/writes prompt the user (y/n/always).

    Supports 4 modes cycled via Shift+Tab:
      - default:      read-only auto, writes need confirm
      - plan:         read-only only (plan file edit only)
      - auto_edit:    read-only + Edit/Write auto-approved, Bash needs confirm
      - auto_approve: everything auto-approved (full trust)
    """

    def __init__(
        self,
        auto_approve: bool = False,
        sandbox_manager: SandboxManager | None = None,
    ):
        self._auto_approve = auto_approve
        self._always_allow: set[str] = set()
        self._esc_listener: EscListener | None = None
        self._sandbox = sandbox_manager
        self._plan_manager: PlanModeManager | None = None
        # Permission mode tracking
        self._mode: str = "auto_approve" if auto_approve else "default"
        self._pre_plan_mode: str | None = None
        self._pre_plan_always_allow: set[str] | None = None
        # Dream mode: restrict writes to memory directory only
        self._dream_mode: bool = False
        self._dream_memory_dir: str | None = None

    def set_plan_manager(self, plan_manager: PlanModeManager) -> None:
        self._plan_manager = plan_manager

    # -- Mode cycling (Shift+Tab) ------------------------------------------

    @property
    def mode_label(self) -> str:
        """Human-readable label for the current mode."""
        return _MODE_LABELS.get(self._mode, self._mode)

    def cycle_mode(self) -> str:
        """Cycle to the next mode. Returns the new mode label."""
        idx = MODES.index(self._mode) if self._mode in MODES else 0
        # Skip plan if PlanModeManager is already active (full plan workflow)
        for _ in range(len(MODES)):
            idx = (idx + 1) % len(MODES)
            new_mode = MODES[idx]
            if new_mode == "plan" and self._plan_manager and self._plan_manager.is_active:
                continue  # skip — already in full plan mode via /plan
            self.set_mode(new_mode)
            return self.mode_label
        return self.mode_label

    def set_mode(self, mode: str) -> None:
        """Switch to a specific mode, handling plan-mode transitions."""
        if mode == self._mode:
            return
        # Leaving plan mode (if currently in plan via cycle)
        if self._mode == "plan" and not (self._plan_manager and self._plan_manager.is_active):
            self.exit_plan_mode()
        # Entering plan mode (lightweight: permission-only, no plan file)
        if mode == "plan":
            if not (self._plan_manager and self._plan_manager.is_active):
                self.enter_plan_mode()
            return
        self._mode = mode

    def enter_dream_mode(self, memory_dir: str) -> None:
        """Enable dream permission isolation — writes only within memory_dir."""
        self._dream_mode = True
        self._dream_memory_dir = os.path.realpath(memory_dir)

    def exit_dream_mode(self) -> None:
        self._dream_mode = False
        self._dream_memory_dir = None

    def set_esc_listener(self, listener: EscListener | None):
        self._esc_listener = listener

    @property
    def mode(self) -> str:
        return self._mode

    def enter_plan_mode(self) -> None:
        """Stash current permission state and switch to plan mode.

        Corresponds to prepareContextForPlanMode() in permissionSetup.ts.
        """
        self._pre_plan_mode = self._mode
        self._pre_plan_always_allow = set(self._always_allow)
        self._mode = "plan"
        # Strip dangerous always-allow rules during plan mode
        self._always_allow -= {"Bash", "Edit", "Write", "Agent"}

    def exit_plan_mode(self) -> None:
        """Restore permission state from before plan mode."""
        self._mode = self._pre_plan_mode or "default"
        self._pre_plan_mode = None
        if self._pre_plan_always_allow is not None:
            self._always_allow = self._pre_plan_always_allow
            self._pre_plan_always_allow = None

    def check(self, tool: Tool, inputs: dict) -> PermissionBehavior:
        # Dream mode: strict isolation — read-only + memory-dir writes only
        if self._dream_mode:
            return self._check_dream(tool, inputs)

        # Plan mode restrictions: only allow read-only tools + plan file writes
        if self._mode == "plan":
            return self._check_plan(tool, inputs)

        # Auto-approve mode: everything allowed
        if self._mode == "auto_approve":
            return "allow"

        # Auto-edit mode: read-only + Edit/Write auto-approved, Bash needs confirm
        if self._mode == "auto_edit":
            if tool.is_read_only() or tool.name in ("Edit", "Write"):
                return "allow"
            if tool.name in self._always_allow:
                return "allow"
            return self._prompt_user(tool, inputs)

        # Default mode
        if tool.is_read_only():
            return "allow"
        if self._auto_approve:
            return "allow"
        if tool.name in self._always_allow:
            return "allow"

        # Sandbox auto-allow: sandboxed Bash commands need no confirmation
        if (
            tool.name == "Bash"
            and self._sandbox is not None
            and self._sandbox.is_auto_allow()
            and self._sandbox.should_sandbox(inputs.get("command", ""))
        ):
            return "allow"

        return self._prompt_user(tool, inputs)

    def _check_plan(self, tool: Tool, inputs: dict) -> PermissionBehavior:
        """Plan mode: read-only tools + plan file writes + agent tools."""
        if tool.name in _PLAN_MODE_ALLOWED_TOOLS:
            return "allow"
        if tool.name in _PLAN_MODE_WRITE_TOOLS:
            file_path = inputs.get("file_path", "")
            plan_path = self._plan_manager.plan_file_path if self._plan_manager else None
            if plan_path and file_path == plan_path:
                return "allow"
            from rich.console import Console
            Console().print(
                f"[yellow]Plan mode: can only edit the plan file "
                f"({plan_path})[/yellow]"
            )
            return "deny"
        from rich.console import Console
        Console().print(
            f"[yellow]Plan mode: {tool.name} is not allowed. "
            f"Only read-only tools and plan file editing are permitted.[/yellow]"
        )
        return "deny"

    def _check_dream(self, tool: Tool, inputs: dict) -> PermissionBehavior:
        """Dream mode: read-only tools + Edit/Write only within memory dir."""
        if tool.is_read_only():
            return "allow"
        if tool.name in ("Edit", "Write"):
            file_path = inputs.get("file_path", "")
            if (
                self._dream_memory_dir
                and isinstance(file_path, str)
                and os.path.realpath(file_path).startswith(self._dream_memory_dir)
            ):
                return "allow"
            return "deny"
        # Bash and everything else: denied during dream
        return "deny"

    def _prompt_user(self, tool: Tool, inputs: dict) -> PermissionBehavior:
        from rich.console import Console
        console = Console()
        console.print(f"\n[bold yellow]允许执行:[/bold yellow] [bold]{tool.name}[/bold]")
        for k, v in inputs.items():
            val = str(v)[:200] + ("..." if len(str(v)) > 200 else "")
            console.print(f"  [dim]{k}:[/dim] {val}")

        console.print("\n  允许? \\[y]es / \\[n]o / \\[a]lways: ", end="")

        # Pause the ESC listener so it doesn't steal our keystrokes
        if self._esc_listener:
            self._esc_listener.pause()

        fd = sys.stdin.fileno()
        try:
            while True:
                # In cbreak mode: read single byte unbuffered, no Enter needed
                b = os.read(fd, 1)

                # Check for ESC — distinguish bare ESC from escape
                # sequences (arrow keys etc.) that start with \x1b
                if b == b'\x1b':
                    if select.select([fd], [], [], 0.05)[0]:
                        # Escape sequence — drain and ignore
                        while select.select([fd], [], [], 0.01)[0]:
                            os.read(fd, 64)
                        continue
                    # Genuine ESC press
                    console.print()
                    if self._esc_listener:
                        self._esc_listener.pressed = True
                    return "deny"

                choice = b.decode("utf-8", errors="ignore").lower()
                console.print(choice)  # echo the char

                if choice == 'y':
                    return "allow"
                if choice == 'n':
                    return "deny"
                if choice == 'a':
                    self._always_allow.add(tool.name)
                    return "allow"
                console.print("  Please enter y, n, or a: ", end="")
        finally:
            # Resume the ESC listener
            if self._esc_listener:
                self._esc_listener.resume()
