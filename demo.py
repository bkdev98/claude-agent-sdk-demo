"""Minimal Claude Agent SDK demo.

Verifies that the SDK can spawn the local Claude Code CLI and authenticate via
the CLI's stored credentials ONLY. Any `CLAUDE_CODE_OAUTH_TOKEN` /
`ANTHROPIC_API_KEY` in the parent shell is stripped before the subprocess is
spawned (see agent_auth.scrubbed_env).

Run:
    uv run python demo.py
"""

from __future__ import annotations

import shutil
import sys

import anyio
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    SystemMessage,
    TextBlock,
    query,
)

from agent_auth import report_stripped, scrubbed_env


def report_auth_mode() -> None:
    stripped = report_stripped()
    if stripped:
        print(f"[auth] Stripping forbidden env from CLI subprocess: {stripped}")
    print("[auth] Subprocess will use Claude Code CLI stored credentials only.")
    cli_path = shutil.which("claude")
    print(f"[cli ] Resolved `claude` binary: {cli_path or 'not on PATH (SDK uses bundled CLI)'}")


async def run_demo() -> int:
    report_auth_mode()

    options = ClaudeAgentOptions(
        system_prompt="You are a terse assistant. Answer in one short sentence.",
        max_turns=1,
        env=scrubbed_env(),
    )

    prompt = "Reply with the single word PONG so we can confirm the round-trip works."
    print(f"\n[send] {prompt}\n")

    saw_text = False
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, SystemMessage):
            print(f"[sys ] {message.subtype}")
        elif isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    saw_text = True
                    print(f"[asst] {block.text}")
        elif isinstance(message, ResultMessage):
            cost = getattr(message, "total_cost_usd", None)
            duration_ms = getattr(message, "duration_ms", None)
            print(
                f"\n[done] turns={message.num_turns} "
                f"duration_ms={duration_ms} cost_usd={cost}"
            )

    if not saw_text:
        print("[fail] No assistant text received — check `claude /login`.", file=sys.stderr)
        return 1

    print("[ok  ] SDK successfully spawned the Claude Code CLI and got a response.")
    return 0


if __name__ == "__main__":
    sys.exit(anyio.run(run_demo))
