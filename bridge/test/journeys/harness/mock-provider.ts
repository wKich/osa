// Scripted model provider for a scripted journey: an OpenAI-compatible
// endpoint that replays the journey's turns in order. Bound to loopback and
// takes no credential. The same adapter serves the in-process reference run
// (OpenCode) and the standalone provider the live run starts inside the
// sandbox, so both sides see byte-identical chunks.
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

/** One replay cursor: the next turn to serve, and the tool-call sequence. */
export interface TurnReplay {
  next: number;
  toolCalls: number;
}

export const beginReplay = (): TurnReplay => ({ next: 0, toolCalls: 0 });

const titleRequest = (body: any) =>
  JSON.stringify(body?.messages?.[0]?.content ?? "").includes("title generator");

const chunk = (content: unknown) =>
  `data: ${JSON.stringify({ id: "chatcmpl-journey", object: "chat.completion.chunk", created: 0, model: "mock-model", ...(content as object) })}\n\n`;

function usageChunk(): string {
  // The scripted child's result reports 1 input + 1 output token; the
  // reference must carry the same usage or its footer omits the counter.
  return chunk({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
}

function textChunks(text: string, stream?: string[]): string[] {
  const chunks: string[] = [];
  chunks.push(chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }));
  for (const part of stream ?? [text]) {
    chunks.push(chunk({ choices: [{ index: 0, delta: { content: part }, finish_reason: null }] }));
  }
  chunks.push(chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
  chunks.push(usageChunk());
  return chunks;
}

function toolChunks(input: Record<string, unknown>, id: string, tool: string): string[] {
  const call = {
    index: 0,
    id,
    type: "function",
    function: { name: tool, arguments: JSON.stringify(input) },
  };
  return [
    chunk({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] }),
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    usageChunk(),
  ];
}

export type ModelReply =
  | { kind: "models"; json: unknown }
  | { kind: "chat"; title: boolean; chunks: string[]; delayMs?: number }
  | { kind: "error"; status: number; json: unknown }
  | { kind: "notFound" };

/**
 * One request against the scripted model. `tool` is the wire name the model
 * calls: OpenCode's is `shell`, Maki's is `bash`.
 */
export function modelReply(
  replay: TurnReplay,
  turns: Turn[],
  pathname: string,
  body: any,
  tool = "shell",
): ModelReply {
  if (pathname.endsWith("/models")) return { kind: "models", json: { data: [{ id: "mock-model", object: "model" }] } };
  if (!pathname.endsWith("/chat/completions")) return { kind: "notFound" };

  // OpenCode asks its provider for a session title first; that is harness
  // traffic, not one of the journey's model turns. Maki makes no such request.
  if (titleRequest(body)) return { kind: "chat", title: true, chunks: textChunks("Journey") };

  const turn = turns[replay.next++];
  if (!turn) return { kind: "chat", title: false, chunks: textChunks("No more scripted turns.") };
  if ("fail" in turn) {
    // the OpenAI error envelope both sides' OpenAI-compatible clients parse
    return { kind: "error", status: turn.fail.status, json: { error: { message: turn.fail.message, type: "journey_error" } } };
  }
  if ("call" in turn) {
    // `tool` names the side: OpenCode's shell is `shell`, Maki's is `bash`
    const spelling = tool === "shell" ? turn.call.opencode : turn.call.maki;
    return { kind: "chat", title: false, chunks: toolChunks(spelling.input, `call_journey_${++replay.toolCalls}`, spelling.name) };
  }
  if ("tool" in turn) {
    return { kind: "chat", title: false, chunks: toolChunks({ command: turn.tool.command }, `call_journey_${++replay.toolCalls}`, tool) };
  }
  return { kind: "chat", title: false, chunks: textChunks(turn.text, turn.stream), delayMs: turn.delayMs };
}

/** The SSE body for one chat reply, with the beat a real model would take. */
export async function chatBody(reply: Extract<ModelReply, { kind: "chat" }>): Promise<Response> {
  // The beat lets the TUI render the submitted user message before the reply
  // starts; a real model never answers in the same tick.
  await Bun.sleep(300);
  const headers = { "content-type": "text/event-stream" };
  if (!reply.delayMs) return new Response(reply.chunks.join("") + "data: [DONE]\n\n", { headers });
  // A paced turn sends each chunk after the delay, so the turn stays running;
  // a client that hangs up (an interrupt) ends the stream early.
  const enc = new TextEncoder();
  const delay = reply.delayMs;
  const chunks = [...reply.chunks, "data: [DONE]\n\n"];
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = chunks.shift();
        if (next === undefined) return controller.close();
        if (chunks.length < reply.chunks.length) await Bun.sleep(delay);
        try {
          controller.enqueue(enc.encode(next));
        } catch {
          chunks.length = 0;
        }
      },
    }),
    { headers },
  );
}

export const errorBody = (reply: Extract<ModelReply, { kind: "error" }>) => Response.json(reply.json, { status: reply.status });

export function startMockProvider(turns: Turn[], tool = "shell"): MockProvider {
  const replay = beginReplay();
  const requests: ModelRequest[] = [];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = url.pathname.endsWith("/chat/completions")
        ? await req.json().catch(() => ({}))
        : {};
      if (url.pathname.endsWith("/chat/completions")) {
        requests.push({ path: url.pathname, title: titleRequest(body), body });
      }
      const reply = modelReply(replay, turns, url.pathname, body, tool);
      if (reply.kind === "models") return Response.json(reply.json);
      if (reply.kind === "notFound") return new Response("not found", { status: 404 });
      if (reply.kind === "error") return errorBody(reply);
      return chatBody(reply);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    port: server.port,
    requests,
    close: () => server.stop(true),
  };
}
