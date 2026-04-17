// Slash command registry for the chat composer.
//
// Each command has:
//   - name: the literal `/foo` users type (without the leading slash)
//   - usage / description: shown in the typeahead menu
//   - kind: drives how the dispatch layer (use-chat) handles it
//     * "client": handled in the browser (no backend round-trip)
//     * "send": rewrites/forwards a prompt to the agent
//     * "set-system" / "set-model": stores an override for future turns
//
// Keeping the registry in plain data lets the menu, parser and dispatcher
// share a single source of truth.

export type SlashCommandKind =
  | "client"
  | "send"
  | "set-system"
  | "set-model"
  | "set-tools"
  | "set-deny"
  | "set-permissions";

export type SlashCommand = {
  name: string;
  usage: string;
  description: string;
  kind: SlashCommandKind;
  // For "send" commands, the prompt sent to the agent.
  promptTemplate?: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "help",
    usage: "/help",
    description: "List the available slash commands.",
    kind: "client",
  },
  {
    name: "clear",
    usage: "/clear",
    description: "Reset the conversation and start a fresh session.",
    kind: "client",
  },
  {
    name: "cost",
    usage: "/cost",
    description: "Print the most recent turn's cost and latency.",
    kind: "client",
  },
  {
    name: "ping",
    usage: "/ping",
    description: "Quick health check: ask Claude to reply with PONG.",
    kind: "send",
    promptTemplate: "Reply with the single word PONG.",
  },
  {
    name: "joke",
    usage: "/joke",
    description: "Ask Claude for a short programming joke.",
    kind: "send",
    promptTemplate: "Tell me a single short, clever programming joke.",
  },
  {
    name: "system",
    usage: "/system <prompt>",
    description: "Override the system prompt used for the next turn.",
    kind: "set-system",
  },
  {
    name: "model",
    usage: "/model <name | clear>",
    description:
      "Pin a specific model id (e.g. claude-sonnet-4-6) for next turns.",
    kind: "set-model",
  },
  {
    name: "tools",
    usage: "/tools <all | none | demo | Name,Name,…>",
    description:
      "Allow tools for next turns. 'all' = Claude Code preset, 'demo' = in-process SDK MCP tools (roll_dice, flip_coin, now).",
    kind: "set-tools",
  },
  {
    name: "permissions",
    usage: "/permissions <default|bypass|plan|acceptEdits>",
    description:
      "Set the SDK permission mode used for tool calls on next turns.",
    kind: "set-permissions",
  },
  {
    name: "deny",
    usage: "/deny <Name,Name,…|none>",
    description:
      "Deny-list specific tools (CLI honors this even when tools are enabled).",
    kind: "set-deny",
  },
];

export type ParsedCommand = {
  command: SlashCommand;
  args: string;
};

/** Parse `/foo bar baz` into { command, args: "bar baz" }. Returns null when
 * input is not a slash invocation or the command name is unknown. */
export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const command = SLASH_COMMANDS.find((c) => c.name === head.toLowerCase());
  if (!command) return null;

  return { command, args: rest.join(" ").trim() };
}

/** Filter commands that match what the user has typed so far (after the `/`).
 * Empty query returns the full list; otherwise prefix match on the name. */
export function matchSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  const query = input.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (!query) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
}
