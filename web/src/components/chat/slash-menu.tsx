// Floating typeahead panel rendered above the composer when the user is in
// the middle of typing a slash command. Pure presentation: parent owns the
// list, the selected index, and dispatches picks.

import { cn } from "@/lib/utils";
import type { SlashCommand } from "@/lib/slash-commands";

type SlashMenuProps = {
  commands: SlashCommand[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (command: SlashCommand) => void;
};

export function SlashMenu({
  commands,
  selectedIndex,
  onHover,
  onPick,
}: SlashMenuProps) {
  if (commands.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className={cn(
        "absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden",
        "rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-md",
      )}
    >
      <div className="max-h-72 overflow-y-auto py-1">
        {commands.map((c, i) => {
          const active = i === selectedIndex;
          return (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={active}
              // mousedown fires before the textarea blur — keeps focus stable.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(c);
              }}
              onMouseEnter={() => onHover(i)}
              className={cn(
                "flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm",
                "transition-colors",
                active ? "bg-accent text-accent-foreground" : "bg-transparent",
              )}
            >
              <span className="font-mono text-foreground">{c.usage}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {c.description}
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <kbd className="font-mono">↑↓</kbd> navigate ·{" "}
        <kbd className="font-mono">↵</kbd> select ·{" "}
        <kbd className="font-mono">esc</kbd> dismiss
      </div>
    </div>
  );
}
