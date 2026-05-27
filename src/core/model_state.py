"""Persist the last-used model so it is remembered across sessions.

Stores a small JSON file at ``~/.config/code-flash/model_state.json`` containing
the model name, provider, base_url, and api_key_env.  On next launch the
saved values are used as defaults (overridden by CLI flags or env vars).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_STATE_PATH = Path.home() / ".config" / "code-flash" / "model_state.json"


def save_model_state(
    *,
    model: str,
    provider: str = "",
    base_url: str = "",
    api_key_env: str = "",
) -> None:
    """Write the current model selection to disk."""
    _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {
        "model": model,
        "provider": provider,
        "base_url": base_url,
        "api_key_env": api_key_env,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        _STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    except OSError:
        pass  # never break the session on I/O errors


def load_model_state() -> dict[str, str] | None:
    """Read the saved model state, or ``None`` if unavailable."""
    if not _STATE_PATH.exists():
        return None
    try:
        data = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict) or "model" not in data:
        return None
    return data
