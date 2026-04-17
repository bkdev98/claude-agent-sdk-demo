"""Auth scrubbing helpers for the Claude Agent SDK.

The whole demo is intentionally wired so the SDK can ONLY authenticate via the
local Claude Code CLI's stored login (`claude /login`). We never let it pick up
`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` from the parent environment.
"""

from __future__ import annotations

import os

# Any env var that lets the CLI authenticate without the stored login.
FORBIDDEN_AUTH_ENV: tuple[str, ...] = (
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_API_KEY",
)


def scrubbed_env() -> dict[str, str]:
    """Return a copy of os.environ with token-based auth vars removed.

    Local-dev posture (default): strip `CLAUDE_CODE_OAUTH_TOKEN` etc. so the
    spawned CLI cannot fall back to API keys / OAuth tokens — it MUST use the
    user's stored Claude Code CLI credentials.

    Deploy posture: set `AUTH_MODE=token` to keep those vars in scope (required
    on Railway / any headless host where there's no stored login).
    """
    if os.getenv("AUTH_MODE") == "token":
        return dict(os.environ)
    return {k: v for k, v in os.environ.items() if k not in FORBIDDEN_AUTH_ENV}


def report_stripped() -> list[str]:
    """List forbidden auth vars currently set in the parent process."""
    return [k for k in FORBIDDEN_AUTH_ENV if os.getenv(k)]
