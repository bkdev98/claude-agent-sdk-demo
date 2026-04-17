"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { streamSse } from "./sse-client";
import {
  parseSlashCommand,
  SLASH_COMMANDS,
  type SlashCommand,
} from "./slash-commands";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";

export type ChatRole = "user" | "assistant" | "info" | "tool_call";

export type ToolCallStatus =
  | "pending" // waiting on user permission decision
  | "allowed" // approved, waiting on tool result
  | "denied"
  | "completed"
  | "error";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  // tool_call extras
  toolUseId?: string;
  name?: string;
  input?: unknown;
  status?: ToolCallStatus;
  requestId?: string; // present while status === "pending"
  result?: string;
};

export type ChatStats = {
  session_id?: string | null;
  num_turns?: number;
  duration_ms?: number;
  cost_usd?: number | null;
};

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

const helpText = () =>
  [
    "Slash commands:",
    ...SLASH_COMMANDS.map((c) => `  ${c.usage.padEnd(48)} ${c.description}`),
  ].join("\n");

const PERMISSION_MODE_ALIASES: Record<string, string> = {
  default: "default",
  bypass: "bypassPermissions",
  bypasspermissions: "bypassPermissions",
  plan: "plan",
  acceptedits: "acceptEdits",
  dontask: "dontAsk",
  auto: "auto",
};

function parsePermissionMode(arg: string): string | null {
  const key = arg.replace(/-/g, "").toLowerCase();
  return PERMISSION_MODE_ALIASES[key] ?? null;
}

function parseTools(arg: string): string[] {
  if (!arg || arg.toLowerCase() === "none") return [];
  if (arg.toLowerCase() === "all") return ["*"];
  return arg
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stats, setStats] = useState<ChatStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);
  const [permissionMode, setPermissionMode] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pushInfo = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: newId(), role: "info", content }]);
  }, []);

  const updateMessage = useCallback(
    (predicate: (m: ChatMessage) => boolean, patch: Partial<ChatMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (predicate(m) ? { ...m, ...patch } : m)),
      );
    },
    [],
  );

  const sendToBackend = useCallback(
    async (prompt: string) => {
      const assistantId = newId();
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", content: prompt },
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setError(null);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const frames = streamSse(`${BACKEND_URL}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            prompt,
            session_id: sessionId,
            system_prompt: systemPrompt,
            model,
            tools,
            disallowed_tools: deniedTools,
            permission_mode: permissionMode,
          }),
          signal: controller.signal,
        });

        for await (const frame of frames) {
          if (frame.event === "text") {
            const { text } = JSON.parse(frame.data) as { text: string };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + text }
                  : m,
              ),
            );
          } else if (frame.event === "tool_use") {
            const { id, name, input } = JSON.parse(frame.data) as {
              id: string;
              name: string;
              input: unknown;
            };
            setMessages((prev) => [
              ...prev,
              {
                id: newId(),
                role: "tool_call",
                toolUseId: id,
                name,
                input,
                status: "pending",
                content: "",
              },
            ]);
          } else if (frame.event === "permission") {
            const { request_id, tool_use_id } = JSON.parse(frame.data) as {
              request_id: string;
              tool_use_id?: string | null;
              tool: string;
              input: unknown;
            };
            updateMessage(
              (m) => m.role === "tool_call" && m.toolUseId === tool_use_id,
              { requestId: request_id, status: "pending" },
            );
          } else if (frame.event === "tool_result") {
            const { tool_use_id, is_error, content } = JSON.parse(
              frame.data,
            ) as {
              tool_use_id: string;
              is_error: boolean;
              content: string;
            };
            updateMessage(
              (m) => m.role === "tool_call" && m.toolUseId === tool_use_id,
              {
                status: is_error ? "error" : "completed",
                result: content,
                requestId: undefined,
              },
            );
          } else if (frame.event === "done") {
            const payload = JSON.parse(frame.data) as ChatStats;
            if (payload.session_id) setSessionId(payload.session_id);
            setStats(payload);
          } else if (frame.event === "error") {
            const { message } = JSON.parse(frame.data) as { message: string };
            setError(message);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      deniedTools,
      model,
      permissionMode,
      sessionId,
      systemPrompt,
      tools,
      updateMessage,
    ],
  );

  const handleClient = useCallback(
    (command: SlashCommand): boolean => {
      switch (command.name) {
        case "clear":
          setMessages([]);
          setSessionId(null);
          setStats(null);
          setError(null);
          return true;
        case "help":
          pushInfo(helpText());
          return true;
        case "cost":
          if (!stats) {
            pushInfo("No turns yet. Send a prompt first.");
          } else {
            pushInfo(
              `Last turn: ${stats.num_turns ?? 0} turn · ${stats.duration_ms ?? 0} ms` +
                (stats.cost_usd != null
                  ? ` · $${stats.cost_usd.toFixed(4)}`
                  : ""),
            );
          }
          return true;
        default:
          return false;
      }
    },
    [pushInfo, stats],
  );

  const send = useCallback(
    async (override?: string) => {
      const raw = (override ?? input).trim();
      if (!raw || isStreaming) return;
      setInput("");

      const parsed = parseSlashCommand(raw);
      if (parsed) {
        const { command, args } = parsed;

        if (command.kind === "client") {
          handleClient(command);
          return;
        }

        if (command.kind === "send") {
          await sendToBackend(command.promptTemplate ?? raw);
          return;
        }

        if (command.kind === "set-system") {
          if (!args) {
            setSystemPrompt(null);
            pushInfo("System prompt reset to default.");
          } else {
            setSystemPrompt(args);
            pushInfo(`System prompt set: ${args}`);
          }
          return;
        }

        if (command.kind === "set-model") {
          if (!args || args.toLowerCase() === "clear") {
            setModel(null);
            pushInfo("Model override cleared (using SDK default).");
          } else {
            setModel(args);
            pushInfo(`Model pinned to ${args} for next turns.`);
          }
          return;
        }

        if (command.kind === "set-tools") {
          const next = parseTools(args);
          setTools(next);
          if (next.length === 0) {
            pushInfo("Tools disabled. Chat-only mode for next turns.");
          } else {
            const label = next[0] === "*" ? "all built-in tools" : next.join(", ");
            pushInfo(
              `Tools enabled: ${label}.\n` +
                "Each call will surface an Allow/Deny card here before the tool runs.\n" +
                "Use /deny <Name,Name> to block specific ones, or /permissions bypass to skip prompts.",
            );
          }
          return;
        }

        if (command.kind === "set-deny") {
          const next = parseTools(args).filter((t) => t !== "*");
          setDeniedTools(next);
          pushInfo(
            next.length === 0
              ? "Deny list cleared."
              : `Denied tools: ${next.join(", ")}.`,
          );
          return;
        }

        if (command.kind === "set-permissions") {
          if (!args) {
            setPermissionMode(null);
            pushInfo("Permission mode reset to SDK default.");
            return;
          }
          const mode = parsePermissionMode(args);
          if (!mode) {
            pushInfo(
              `Unknown permission mode '${args}'. Try: default, bypass, plan, acceptEdits.`,
            );
            return;
          }
          setPermissionMode(mode);
          pushInfo(`Permission mode: ${mode}`);
          return;
        }
      }

      if (raw.startsWith("/")) {
        pushInfo("Unknown command. Type /help for the full list.");
        return;
      }

      await sendToBackend(raw);
    },
    [handleClient, input, isStreaming, pushInfo, sendToBackend],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // Resolve a pending tool permission: POSTs the decision and updates the
  // matching tool_call message so the UI reflects the choice.
  const resolvePermission = useCallback(
    async (requestId: string, allow: boolean) => {
      try {
        await fetch(`${BACKEND_URL}/api/permission/${requestId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allow }),
        });
      } catch (err) {
        setError(
          `Failed to submit permission decision: ${(err as Error).message}`,
        );
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.requestId === requestId
              ? {
                  ...m,
                  requestId: undefined,
                  status: allow ? "allowed" : "denied",
                }
              : m,
          ),
        );
      }
    },
    [],
  );

  // Dev/e2e shortcut: `?q=...` pre-fills and auto-sends one prompt on load.
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;
    autoSentRef.current = true;
    send(q);
  }, [send]);

  return {
    messages,
    input,
    setInput,
    isStreaming,
    sessionId,
    stats,
    error,
    systemPrompt,
    model,
    tools,
    deniedTools,
    permissionMode,
    send,
    stop,
    resolvePermission,
  };
}
