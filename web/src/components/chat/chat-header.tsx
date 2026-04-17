// Top bar: identity + auth posture.
// Auth pill makes it visible at-a-glance that the SDK is using the local CLI's
// stored login (no API key, no OAuth token from env).

import { Sparkles } from "lucide-react";

export function ChatHeader() {
  return (
    <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-xl bg-foreground/5 text-foreground"
        >
          <Sparkles className="size-4" />
        </span>
        <div className="flex flex-col">
          <h1 className="text-pretty text-sm font-semibold leading-tight">
            Claude Agent SDK
          </h1>
          <p className="text-pretty text-xs text-muted-foreground">
            prompt-kit chat · streaming via local CLI
          </p>
        </div>
      </div>

      <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
        Stored login · CLI
      </span>
    </header>
  );
}
