#!/usr/bin/env bun
// Standalone entry for the scripted model provider: the image's Bun runs this
// inside the throwaway sandbox, bound to the sandbox's own loopback (design
// decision 1). It replays the journey turns through the same adapter as the
// in-process harness provider.
//
//   bun standalone.ts --turns <file.json> [--port <port>]
//
// Prints `listening on 127.0.0.1:<port>` once the server is up.
import { readFileSync, writeFileSync } from "node:fs";
import { beginReplay, chatBody, errorBody, modelReply } from "./mock-provider.ts";
import type { Turn } from "./journey.ts";

const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};

const turnsPath = arg("--turns");
if (!turnsPath) {
  console.error("standalone provider: --turns <file.json> is required");
  process.exit(64);
}
const turns = JSON.parse(readFileSync(turnsPath, "utf8")) as Turn[];
const replay = beginReplay();
// The exec session does not always end the remote process when the host side
// is killed, so leave a pid the runner can stop between journeys.
writeFileSync("/tmp/journey-provider.pid", String(process.pid));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(arg("--port") ?? "0"),
  async fetch(req) {
    const url = new URL(req.url);
    const body = url.pathname.endsWith("/chat/completions")
      ? await req.json().catch(() => ({}))
      : {};
    // Maki's tool wire name is `bash` (model-provider spike, task 1.1).
    const reply = modelReply(replay, turns, url.pathname, body, "bash");
    if (reply.kind === "models") return Response.json(reply.json);
    if (reply.kind === "notFound") return new Response("not found", { status: 404 });
    if (reply.kind === "error") return errorBody(reply);
    return chatBody(reply);
  },
});
console.log(`listening on 127.0.0.1:${server.port}`);
