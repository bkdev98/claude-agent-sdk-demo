// Minimal SSE-over-fetch client. fetch streams bytes; we parse `event:`/`data:`
// frames separated by a blank line. Used because EventSource only supports GET.

export type SseFrame = { event: string; data: string };

export async function* streamSse(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): AsyncGenerator<SseFrame> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    throw new Error(`SSE request failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    // SSE frame separator is a blank line — handle both LF and CRLF.
    while ((sepIdx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawFrame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + (buffer[sepIdx] === "\r" ? 4 : 2));
      const frame = parseFrame(rawFrame);
      if (frame) yield frame;
    }
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
