// Single chat turn. User → right-aligned soft bubble. Assistant → left-aligned
// avatar + plain markdown content (claude.ai-style, no chrome around the prose).

import { Loader } from "@/components/ui/loader";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import type { ChatMessage } from "@/lib/use-chat";
import { ToolCallCard } from "./tool-call-card";

type ChatBubbleProps = {
  message: ChatMessage;
  pending?: boolean;
  onResolvePermission?: (requestId: string, allow: boolean) => void;
};

export function ChatBubble({
  message,
  pending,
  onResolvePermission,
}: ChatBubbleProps) {
  if (message.role === "tool_call") {
    return (
      <ToolCallCard
        message={message}
        onResolve={onResolvePermission ?? (() => {})}
      />
    );
  }

  if (message.role === "info") {
    return (
      <div className="flex justify-center">
        <pre className="max-w-[90%] whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-muted-foreground">
          {message.content}
        </pre>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <Message className="justify-end">
        <MessageContent className="max-w-[80%] text-pretty rounded-2xl bg-secondary px-4 py-2.5 text-secondary-foreground">
          {message.content}
        </MessageContent>
      </Message>
    );
  }

  const isWaiting = pending && message.content.length === 0;

  return (
    <Message className="items-start gap-3">
      <MessageAvatar
        src=""
        alt="Claude"
        fallback="C"
        className="size-8 shrink-0 rounded-full bg-foreground/5 text-xs font-medium"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Claude</div>
        {isWaiting ? (
          <div className="pt-1 text-muted-foreground">
            <Loader variant="text-shimmer" size="md" text="Thinking" />
          </div>
        ) : (
          <MessageContent
            markdown
            className="prose prose-sm max-w-none bg-transparent p-0 text-pretty text-foreground prose-p:my-2 prose-pre:my-3 dark:prose-invert"
          >
            {message.content}
          </MessageContent>
        )}
      </div>
    </Message>
  );
}
