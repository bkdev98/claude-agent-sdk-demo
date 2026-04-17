"use client";

import { ChatBubble } from "@/components/chat/chat-bubble";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatEmpty } from "@/components/chat/chat-empty";
import { ChatHeader } from "@/components/chat/chat-header";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import { useChat } from "@/lib/use-chat";

export default function ChatPage() {
  const chat = useChat();

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
      <ChatHeader />

      <section className="relative flex-1 overflow-hidden">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="flex flex-col gap-6 px-6 py-8">
            {chat.messages.length === 0 ? (
              <ChatEmpty
                disabled={chat.isStreaming}
                onPick={(s) => chat.send(s)}
              />
            ) : (
              chat.messages.map((m, i) => (
                <ChatBubble
                  key={m.id}
                  message={m}
                  pending={
                    chat.isStreaming &&
                    m.role === "assistant" &&
                    i === chat.messages.length - 1
                  }
                  onResolvePermission={chat.resolvePermission}
                />
              ))
            )}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>

          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="pointer-events-auto">
              <ScrollButton className="rounded-full shadow-sm" />
            </div>
          </div>
        </ChatContainerRoot>
      </section>

      <ChatComposer
        value={chat.input}
        onValueChange={chat.setInput}
        onSubmit={(override) => chat.send(override)}
        onStop={chat.stop}
        isStreaming={chat.isStreaming}
        sessionId={chat.sessionId}
        stats={chat.stats}
        systemPrompt={chat.systemPrompt}
        model={chat.model}
        tools={chat.tools}
        deniedTools={chat.deniedTools}
        permissionMode={chat.permissionMode}
        error={chat.error}
      />
    </main>
  );
}
