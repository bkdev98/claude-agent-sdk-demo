// Inline card for tool_call messages. Shows what Claude wants to do, an
// Allow/Deny prompt while a permission decision is pending, and the tool's
// result once it's been executed (or the denial reason).

import { Check, ChevronDown, ChevronRight, Wrench, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCallStatus } from "@/lib/use-chat";

type ToolCallCardProps = {
  message: ChatMessage;
  onResolve: (requestId: string, allow: boolean) => void;
};

const STATUS_TONE: Record<ToolCallStatus, string> = {
  pending: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  allowed: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  denied: "bg-muted text-muted-foreground",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  error: "bg-destructive/10 text-destructive",
};

export function ToolCallCard({ message, onResolve }: ToolCallCardProps) {
  const status = message.status ?? "pending";
  const [open, setOpen] = useState(true);

  // "Awaiting approval" is only meaningful while the SDK has a live permission
  // request. Without one, the CLI runs the tool itself — show "Running".
  const statusLabel =
    status === "pending"
      ? message.requestId
        ? "Awaiting approval"
        : "Running"
      : status === "allowed"
        ? "Running"
        : status === "denied"
          ? "Denied"
          : status === "completed"
            ? "Completed"
            : "Failed";

  const awaitingApproval = status === "pending" && !!message.requestId;

  return (
    <div className="rounded-xl border border-border/60 bg-card text-sm shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-foreground/5 text-foreground">
          <Wrench className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="font-mono text-[13px] font-medium">
            {message.name ?? "tool"}
          </span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {summarizeInput(message.input)}
          </span>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            STATUS_TONE[status],
          )}
        >
          {statusLabel}
        </span>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Input
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
              {prettyJson(message.input)}
            </pre>
          </div>

          {awaitingApproval && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                Claude wants to use{" "}
                <span className="font-mono text-foreground/80">
                  {message.name}
                </span>
                . Approve this call?
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResolve(message.requestId!, false)}
                >
                  <X className="size-3.5" />
                  Deny
                </Button>
                <Button
                  size="sm"
                  onClick={() => onResolve(message.requestId!, true)}
                >
                  <Check className="size-3.5" />
                  Allow
                </Button>
              </div>
            </div>
          )}

          {message.result && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Result
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
                {message.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return truncate(input, 80);
  try {
    const json = JSON.stringify(input);
    return truncate(json.replace(/[{}"]/g, "").replace(/,/g, " "), 80);
  } catch {
    return String(input);
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
