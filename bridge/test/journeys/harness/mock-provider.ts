// Scripted model provider for the reference run (design decision 3): a local
// OpenAI-compatible endpoint that replays the journey's turns in order. It is
// bound to loopback and takes no credential.
import type { Turn } from "./journey.ts";

export interface ModelRequest {
  path: string;
  title: boolean;
  body: unknown;
}

export interface MockProvider {
  url: string;
  port: number;
  requests: ModelRequest[];
  close(): void;
}

const titleRequest = (body: any) =>
  JSON.stringify(body?.messages?.[0]?.content ?? "").includes("title generator");

const chunk = (content: unknown) =>
  `data: ${JSON.stringify({ id: "chatcmpl-journey", object: "chat.completion.chunk", created: 0, model: "mock-model", ...(content as object) })}\n\n`;

function textChunks(text: string, stream?: string[]): string[] {
  const chunks: string[] = [];
  chunks.push(chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }));
  for (const part of stream ?? [text]) {
    chunks.push(chunk({ choices: [{ index: 0, delta: { content: part }, finish_reason: null }] }));
  }
  chunks.push(chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
  return chunks;
}

function toolChunks(command: string): string[] {
  const call = {
    index: 0,
    id: "call_journey_1",
    type: "function",
    function: { name: "shell", arguments: JSON.stringify({ command }) },
  };
  return [
    chunk({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] }),
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
  ];
}

export function startMockProvider(turns: Turn[]): MockProvider {
  let next = 0;
  const requests: ModelRequest[] = [];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models")) {
        return Response.json({ data: [{ id: "mock-model", object: "model" }] });
      }
      if (!url.pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 });
      }

      const body = await req.json().catch(() => ({}));
      const title = titleRequest(body);
      requests.push({ path: url.pathname, title, body });
      // OpenCode asks its provider for a session title first; that is harness
      // traffic, not one of the journey's model turns.
      if (title) {
        return new Response(textChunks("Journey").join("") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }

      const turn = turns[next++];
      const chunks = !turn
        ? textChunks("No more scripted turns.")
        : "tool" in turn
          ? toolChunks(turn.tool.command)
          : textChunks(turn.text, turn.stream);
      // A real model never answers in the same tick; the beat lets the TUI
      // render the submitted user message before the reply starts.
      await Bun.sleep(300);
      return new Response(chunks.join("") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    port: server.port,
    requests,
    close: () => server.stop(true),
  };
}
