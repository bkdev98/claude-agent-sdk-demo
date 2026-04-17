// Bottom composer: PromptInput + send/stop button + slash-menu typeahead.
// Status row beneath the input shows session id, last-turn cost, plus any
// system/model overrides that slash commands have set.

"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { cn } from "@/lib/utils";
import {
  matchSlashCommands,
  type SlashCommand,
} from "@/lib/slash-commands";
import type { ChatStats } from "@/lib/use-chat";
import { SlashMenu } from "./slash-menu";

type ChatComposerProps = {
  value: string;
  onValueChange: (v: string) => void;
  onSubmit: (override?: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  sessionId: string | null;
  stats: ChatStats | null;
  systemPrompt: string | null;
  model: string | null;
  tools: string[];
  deniedTools: string[];
  permissionMode: string | null;
  error: string | null;
};

const NO_ARG_COMMANDS = new Set(["help", "clear", "cost", "ping", "joke"]);

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  isStreaming,
  sessionId,
  stats,
  systemPrompt,
  model,
  tools,
  deniedTools,
  permissionMode,
  error,
}: ChatComposerProps) {
  const canSend = !isStreaming && value.trim().length > 0;

  const matches = matchSlashCommands(value);
  const menuOpen = matches.length > 0 && value.trimStart().startsWith("/");

  const [selectedIndex, setSelectedIndex] = useState(0);
  // Reset selection whenever the matching set changes shape.
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  const pickCommand = (cmd: SlashCommand) => {
    if (NO_ARG_COMMANDS.has(cmd.name)) {
      // No args needed: dispatch immediately so the demo feels snappy.
      // Pass the override so we don't depend on input state propagation.
      onValueChange("");
      onSubmit(`/${cmd.name}`);
    } else {
      // Args expected — insert and let the user finish typing.
      onValueChange(`/${cmd.name} `);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onValueChange(`/${matches[selectedIndex].name} `);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onValueChange("");
    }
    // Enter falls through: PromptInputTextarea handles it as submit, which
    // dispatches the slash command via the chat hook.
  };

  return (
    <div className="border-t border-border/60 bg-background px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
      {error && (
        <pre
          role="alert"
          className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-destructive"
        >
          {error}
        </pre>
      )}

      <div className="relative">
        {menuOpen && (
          <SlashMenu
            commands={matches}
            selectedIndex={selectedIndex}
            onHover={setSelectedIndex}
            onPick={pickCommand}
          />
        )}

        <PromptInput
          value={value}
          onValueChange={onValueChange}
          onSubmit={() => onSubmit()}
          isLoading={isStreaming}
          className="border-border/60 bg-card shadow-sm"
        >
          <PromptInputTextarea
            placeholder="Ask Claude anything… or type / for commands"
            className="text-sm placeholder:text-muted-foreground/70"
            onKeyDown={handleKeyDown}
          />
          <PromptInputActions className="justify-end pt-2">
            <Button
              size="icon"
              aria-label={isStreaming ? "Stop generating" : "Send message"}
              variant={isStreaming ? "secondary" : "default"}
              onClick={isStreaming ? onStop : () => onSubmit()}
              disabled={!isStreaming && !canSend}
              className="size-9 rounded-full"
            >
              {isStreaming ? (
                <Square className="size-4" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </PromptInputActions>
        </PromptInput>
      </div>

      <ComposerStatus
        sessionId={sessionId}
        stats={stats}
        systemPrompt={systemPrompt}
        model={model}
        tools={tools}
        deniedTools={deniedTools}
        permissionMode={permissionMode}
      />
    </div>
  );
}

function ComposerStatus({
  sessionId,
  stats,
  systemPrompt,
  model,
  tools,
  deniedTools,
  permissionMode,
}: {
  sessionId: string | null;
  stats: ChatStats | null;
  systemPrompt: string | null;
  model: string | null;
  tools: string[];
  deniedTools: string[];
  permissionMode: string | null;
}) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground",
        "tabular-nums",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {sessionId ? (
            <>
              session{" "}
              <code className="font-mono text-foreground/70">
                {sessionId.slice(0, 8)}
              </code>
            </>
          ) : (
            "no session yet · type / for commands"
          )}
        </span>
        {systemPrompt && (
          <Chip>system: {truncate(systemPrompt, 32)}</Chip>
        )}
        {model && <Chip>model: {model}</Chip>}
        {tools.length > 0 && (
          <Chip>tools: {tools[0] === "*" ? "all" : tools.join(",")}</Chip>
        )}
        {deniedTools.length > 0 && <Chip>deny: {deniedTools.join(",")}</Chip>}
        {permissionMode && <Chip>perm: {permissionMode}</Chip>}
      </div>
      {stats && (
        <span>
          {stats.num_turns ?? 0} turn · {stats.duration_ms ?? 0} ms
          {stats.cost_usd != null && ` · $${stats.cost_usd.toFixed(4)}`}
        </span>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/70">
      {children}
    </span>
  );
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
