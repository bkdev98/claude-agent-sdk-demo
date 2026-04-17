"""FastAPI chat backend that streams Claude Agent SDK responses via SSE.

Auth posture: the SDK subprocess MUST authenticate with the local Claude Code
CLI's stored login. We pass `ClaudeAgentOptions(env=scrubbed_env())` so token
env vars (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, ...) are stripped
before the CLI is spawned, regardless of what's in the parent shell.

Tool/permission posture:
- By default the SDK gets `tools=[]` (chat only).
- Clients can opt into tools per request via the `tools` field.
- For interactive permissions we register a `can_use_tool` callback that
  emits a "permission" SSE event and waits for the client to POST a decision
  to /api/permission/{request_id}.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    HookMatcher,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    UserMessage,
    query,
)
from claude_agent_sdk.types import ToolPermissionContext, ToolResultBlock

from agent_auth import report_stripped, scrubbed_env
from server.sdk_tools import DEMO_TOOL_NAMES, build_demo_server

log = logging.getLogger("agent-sdk-demo")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = FastAPI(title="agent-sdk-demo")
# Comma-separated origins; defaults cover local dev. Override on deploy.
_DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
_ALLOW_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOW_ORIGINS", _DEFAULT_ORIGINS).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def announce_auth_mode() -> None:
    stripped = report_stripped()
    if stripped:
        log.warning("Stripping forbidden auth env from CLI subprocess: %s", stripped)
    log.info("CLI subprocess will use Claude Code CLI stored credentials only.")


DEFAULT_SYSTEM_PROMPT = "You are a helpful, concise assistant in a demo chat."

# Permission decisions are resolved across two HTTP requests: the SSE stream
# emits a permission event with a request_id, then the client POSTs the
# decision to /api/permission/{request_id}. Futures live here keyed by rid.
PERMISSION_FUTURES: dict[str, asyncio.Future[bool]] = {}
PERMISSION_TIMEOUT_S = 120.0


class ChatRequest(BaseModel):
    prompt: str
    session_id: str | None = None
    # Per-turn overrides driven by client-side slash commands.
    system_prompt: str | None = None
    model: str | None = None
    tools: list[str] | None = None  # None = chat-only, "*" via list ["*"] = all
    disallowed_tools: list[str] | None = None
    permission_mode: str | None = None


class PermissionDecision(BaseModel):
    allow: bool
    reason: str | None = None


def _sse(event: str, data: dict | str) -> dict:
    payload = data if isinstance(data, str) else json.dumps(data)
    return {"event": event, "data": payload}


def _resolve_tools(
    tools: list[str] | None,
) -> tuple[list[str] | dict[str, Any] | None, bool]:
    """Translate the wire `tools` field to ClaudeAgentOptions form.

    Special aliases handled:
      - `["*"]` → preset 'claude_code' (all built-in Claude Code tools)
      - The literal `"demo"` (alone or in a list) expands to our SDK MCP tools.
    Returns (resolved, has_tools)."""
    if tools is None or len(tools) == 0:
        return [], False
    if tools == ["*"]:
        return {"type": "preset", "preset": "claude_code"}, True
    expanded: list[str] = []
    for entry in tools:
        if entry == "demo":
            expanded.extend(DEMO_TOOL_NAMES)
        else:
            expanded.append(entry)
    return expanded, True


async def _stream_reply(req: ChatRequest) -> AsyncIterator[dict]:
    out_queue: asyncio.Queue[dict | None] = asyncio.Queue()
    stream_id = uuid.uuid4().hex[:8]

    # ---- stderr capture --------------------------------------------------
    stderr_lines: list[str] = []

    def capture_stderr(line: str) -> None:
        line = line.rstrip()
        if not line:
            return
        stderr_lines.append(line)
        log.warning("[cli stderr %s] %s", stream_id, line)

    # ---- can_use_tool callback ------------------------------------------
    async def can_use_tool(
        tool_name: str,
        tool_input: dict[str, Any],
        ctx: ToolPermissionContext,
    ) -> PermissionResultAllow | PermissionResultDeny:
        rid = uuid.uuid4().hex
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[bool] = loop.create_future()
        PERMISSION_FUTURES[rid] = fut
        # Tolerate ctx as either a dataclass (current SDK) or a dict (older
        # versions) so the callback never crashes inside the SDK.
        if isinstance(ctx, dict):
            tool_use_id = ctx.get("tool_use_id")
        else:
            tool_use_id = getattr(ctx, "tool_use_id", None)
        log.info(
            "permission requested rid=%s tool=%s tool_use_id=%s",
            rid,
            tool_name,
            tool_use_id,
        )
        await out_queue.put(
            _sse(
                "permission",
                {
                    "request_id": rid,
                    "tool": tool_name,
                    "input": tool_input,
                    "tool_use_id": tool_use_id,
                },
            )
        )
        try:
            allowed = await asyncio.wait_for(fut, timeout=PERMISSION_TIMEOUT_S)
        except asyncio.TimeoutError:
            log.warning("permission request %s timed out", rid)
            return PermissionResultDeny(message="No response from user (timeout)")
        finally:
            PERMISSION_FUTURES.pop(rid, None)
        if allowed:
            return PermissionResultAllow()
        return PermissionResultDeny(message="User denied the tool call")

    # ---- assemble options -----------------------------------------------
    resolved_tools, has_tools = _resolve_tools(req.tools)
    options_kwargs: dict[str, Any] = dict(
        system_prompt=req.system_prompt or DEFAULT_SYSTEM_PROMPT,
        max_turns=8 if has_tools else 4,
        env=scrubbed_env(),
        resume=req.session_id,
        model=req.model,
        stderr=capture_stderr,
        tools=resolved_tools,
        disallowed_tools=req.disallowed_tools or [],
        # Skip user/project/local settings sources so this demo runs with a
        # clean permission posture — the user's `.claude` permission rules
        # (which often pre-approve Bash, etc.) won't bypass our prompt.
        setting_sources=[],
    )
    # Resolve mode early so hooks can branch on it.
    effective_mode = req.permission_mode or ("default" if has_tools else None)
    # Modes that intentionally skip the approval UI.
    auto_allow_mode = effective_mode in ("bypassPermissions", "acceptEdits")

    # ---- hooks: force-ask + per-tool latency capture --------------------
    # Per-tool start times keyed by tool_use_id. Populated in PreToolUse,
    # consumed in PostToolUse to compute and emit a `tool_metric` event.
    tool_started: dict[str, float] = {}

    async def pre_tool_hook(
        input_data: dict[str, Any],
        tool_use_id: str | None,
        _context: Any,
    ) -> dict[str, Any]:
        if tool_use_id:
            tool_started[tool_use_id] = time.monotonic()
        # In bypass/accept-edits mode, don't force "ask" — let the CLI run
        # the tool without routing through can_use_tool.
        if auto_allow_mode:
            return {}
        # Workaround for SDK issue #469 — returning "ask" routes the CLI's
        # permission request through can_use_tool instead of auto-allowing.
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": "demo: route through SDK approval",
            }
        }

    async def post_tool_hook(
        input_data: dict[str, Any],
        tool_use_id: str | None,
        _context: Any,
    ) -> dict[str, Any]:
        if tool_use_id and tool_use_id in tool_started:
            duration_ms = int((time.monotonic() - tool_started.pop(tool_use_id)) * 1000)
            await out_queue.put(
                _sse(
                    "tool_metric",
                    {"tool_use_id": tool_use_id, "duration_ms": duration_ms},
                )
            )
        return {}

    if has_tools:
        # can_use_tool: SDK invokes it via the stdio control protocol.
        # The PreToolUse "ask" hook is what makes the CLI actually emit those
        # control requests (see anthropics/claude-agent-sdk-python#469).
        options_kwargs["can_use_tool"] = can_use_tool
        options_kwargs["hooks"] = {
            "PreToolUse": [HookMatcher(matcher=None, hooks=[pre_tool_hook])],
            "PostToolUse": [HookMatcher(matcher=None, hooks=[post_tool_hook])],
        }
        # Always expose the in-process demo MCP server. Agent only sees the
        # tools that are also in `tools=`, so this is free when not selected.
        options_kwargs["mcp_servers"] = {"demo": build_demo_server()}
    # If tools are enabled and the client didn't pin a mode, force 'default'
    # so the SDK actually routes calls through can_use_tool instead of
    # short-circuiting (some CLI builds auto-allow when mode is unset).
    if effective_mode:
        options_kwargs["permission_mode"] = effective_mode  # type: ignore[arg-type]
    log.info(
        "stream %s: tools=%s permission_mode=%s session=%s",
        stream_id,
        resolved_tools,
        effective_mode,
        req.session_id,
    )

    options = ClaudeAgentOptions(**options_kwargs)

    # ---- prompt: streaming mode is required when can_use_tool is set ----
    async def stream_prompt():  # type: ignore[no-untyped-def]
        yield {
            "type": "user",
            "message": {"role": "user", "content": req.prompt},
            "parent_tool_use_id": None,
            "session_id": req.session_id or "",
        }

    prompt_arg = stream_prompt() if has_tools else req.prompt

    # ---- consumer task: drive SDK, push events into queue ---------------
    async def consume_sdk() -> None:
        try:
            async for message in query(prompt=prompt_arg, options=options):
                if isinstance(message, SystemMessage):
                    await out_queue.put(_sse("system", {"subtype": message.subtype}))
                elif isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            await out_queue.put(_sse("text", {"text": block.text}))
                        elif isinstance(block, ToolUseBlock):
                            await out_queue.put(
                                _sse(
                                    "tool_use",
                                    {
                                        "id": block.id,
                                        "name": block.name,
                                        "input": block.input,
                                    },
                                )
                            )
                elif isinstance(message, UserMessage):
                    for block in message.content if isinstance(message.content, list) else []:
                        if isinstance(block, ToolResultBlock):
                            await out_queue.put(
                                _sse(
                                    "tool_result",
                                    {
                                        "tool_use_id": block.tool_use_id,
                                        "is_error": bool(block.is_error),
                                        "content": _flatten_tool_content(block.content),
                                    },
                                )
                            )
                elif isinstance(message, ResultMessage):
                    await out_queue.put(
                        _sse(
                            "done",
                            {
                                "session_id": getattr(message, "session_id", None),
                                "num_turns": message.num_turns,
                                "duration_ms": getattr(message, "duration_ms", None),
                                "cost_usd": getattr(message, "total_cost_usd", None),
                            },
                        )
                    )
        except Exception as exc:  # noqa: BLE001
            log.exception("agent stream failed (stream=%s)", stream_id)
            tail = "\n".join(stderr_lines[-12:]) if stderr_lines else ""
            message = f"{type(exc).__name__}: {exc}"
            if tail:
                message = f"{message}\n--- CLI stderr ---\n{tail}"
            await out_queue.put(_sse("error", {"message": message}))
        finally:
            await out_queue.put(None)

    task = asyncio.create_task(consume_sdk())

    try:
        while True:
            item = await out_queue.get()
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()


def _flatten_tool_content(content: Any) -> str:
    """ToolResultBlock content can be a string or a list of content blocks.
    Flatten to a string for the UI."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for block in content:
            if isinstance(block, dict):
                out.append(str(block.get("text", block)))
            else:
                out.append(str(block))
        return "\n".join(out)
    return str(content)


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {"ok": True, "stripped_auth_env": report_stripped()}


@app.post("/api/chat")
async def chat(req: ChatRequest) -> EventSourceResponse:
    return EventSourceResponse(_stream_reply(req))


@app.post("/api/permission/{request_id}")
async def resolve_permission(
    request_id: str, decision: PermissionDecision
) -> dict[str, object]:
    fut = PERMISSION_FUTURES.get(request_id)
    if fut is None or fut.done():
        raise HTTPException(404, f"No pending permission for {request_id}")
    fut.set_result(decision.allow)
    return {"ok": True, "request_id": request_id, "allow": decision.allow}
