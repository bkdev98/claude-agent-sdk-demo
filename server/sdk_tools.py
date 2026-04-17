"""In-process SDK MCP server exposing a couple of toy tools.

Demonstrates `claude_agent_sdk.create_sdk_mcp_server` — Python functions become
MCP tools that the agent can call, no subprocess, no separate config, with
full access to the host process's state.

Tool names show up to the agent as `mcp__demo__<name>`.
"""

from __future__ import annotations

import datetime as _dt
import random
import zoneinfo
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

DEMO_SERVER_NAME = "demo"


def _text(content: str, *, error: bool = False) -> dict[str, Any]:
    """Helper: build an MCP tool result with a single text block."""
    payload: dict[str, Any] = {"content": [{"type": "text", "text": content}]}
    if error:
        payload["is_error"] = True
    return payload


@tool(
    "roll_dice",
    "Roll one or more N-sided dice and return the rolls and total.",
    {"sides": int, "count": int},
)
async def roll_dice(args: dict[str, Any]) -> dict[str, Any]:
    sides = int(args.get("sides", 6))
    count = int(args.get("count", 1))
    if sides < 2 or count < 1 or count > 20:
        return _text(
            f"Bad input: sides={sides} count={count} (need sides≥2, 1≤count≤20).",
            error=True,
        )
    rolls = [random.randint(1, sides) for _ in range(count)]
    return _text(f"Rolled {count}d{sides}: {rolls} (total={sum(rolls)})")


@tool("flip_coin", "Flip a fair coin and return heads or tails.", {})
async def flip_coin(_: dict[str, Any]) -> dict[str, Any]:
    return _text(random.choice(["heads", "tails"]))


@tool(
    "now",
    "Return the current date/time in the requested IANA timezone.",
    {"timezone": str},
)
async def now(args: dict[str, Any]) -> dict[str, Any]:
    tz_name = args.get("timezone") or "UTC"
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        return _text(f"Unknown timezone: {tz_name}", error=True)
    stamp = _dt.datetime.now(tz).isoformat(timespec="seconds")
    return _text(f"{stamp} ({tz_name})")


# Tool names as the agent sees them. Used by the backend to expand the
# `/tools demo` alias into concrete entries for ClaudeAgentOptions.tools.
DEMO_TOOL_NAMES: tuple[str, ...] = tuple(
    f"mcp__{DEMO_SERVER_NAME}__{t.name}" for t in (roll_dice, flip_coin, now)
)


def build_demo_server():
    """Build the SDK MCP server config to plug into ClaudeAgentOptions."""
    return create_sdk_mcp_server(
        name=DEMO_SERVER_NAME,
        version="0.1.0",
        tools=[roll_dice, flip_coin, now],
    )
