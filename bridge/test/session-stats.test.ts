// The `/stats` page's aggregate (session-stats.ts): the bridge's session
// histories counted as OpenCode counts its stored messages (core
// session/stats.ts v2.1.4 L79–L355).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { sessionStats } from "../src/session-stats.ts";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

const day = (iso: string) => Date.parse(iso);

test("prompts, steps, tokens, models, activity and tools aggregate like OpenCode's", () => {
  const step = (at: string, model: string, tokens: number, tool?: string) => ({
    type: "assistant",
    time: { created: day(at) },
    model: { providerID: "mock", id: model },
    tokens: { input: tokens, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.5,
    content: tool ? [{ type: "tool", name: tool, state: { status: "completed" }, time: { created: day(at), completed: day(at) + 40 } }] : [],
  });
  const stats = sessionStats(
    [
      { messages: [{ type: "user", time: { created: day("2026-10-20T10:00:00Z") } }, step("2026-10-20T10:00:01Z", "a", 10, "bash"), step("2026-10-21T09:00:00Z", "b", 30)] },
      { parentID: "ses_root", messages: [{ type: "user", time: { created: day("2026-10-21T09:00:02Z") } }, step("2026-10-21T09:00:03Z", "a", 5)] },
    ],
    { to: day("2026-10-25T00:00:00Z"), tools: "detail" },
  );
  expect(stats).toMatchObject({
    range: { from: day("2026-10-20T10:00:00Z"), to: day("2026-10-25T00:00:00Z") },
    sessions: 1, subagents: 1, prompts: 1, steps: 3, cost: 1.5, activeDays: 2, streak: 2,
    activity: [{ date: "2026-10-20", steps: 1 }, { date: "2026-10-21", steps: 2 }],
  });
  expect(stats.tokens).toEqual({ input: 45, output: 3, reasoning: 0, cache: { read: 0, write: 0 } });
  expect(stats.models.map((m: any) => [m.model.id, m.steps])).toEqual([["b", 1], ["a", 2]]);
  expect(stats.tools).toEqual({ mode: "detail", totals: { calls: 1, succeeded: 1, failed: 0, unfinished: 0 }, usage: [{ name: "bash", calls: 1, succeeded: 1, failed: 0, unfinished: 0, durationP50: 40 }] });
  expect(sessionStats([], { to: 5 })).toMatchObject({ range: { from: 5, to: 5 }, sessions: 0, steps: 0, activity: [] });
});

let bridge: BridgeHandle;
beforeAll(async () => {
  bridge = await startBridge();
});
afterAll(async () => {
  await bridge?.stop();
});

test("the route counts the bridge's turns and refuses an inverted range", async () => {
  const post = (path: string, body: unknown) => fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  await post(`/api/session/${sid}/prompt`, { text: "Reply with the word PONG only." });
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid), 15_000)).toBe(true);
  const path = "/api/experimental/session/stats";
  const body = await (await fetch(`${bridge.base}${path}?timezone=UTC`)).json();
  expect(validateBody(path, "GET", 200, body)).toBeNull();
  expect(body.data).toMatchObject({ sessions: 1, prompts: 1, steps: 1, activeDays: 1, tools: { mode: "summary" } });
  const bad = await fetch(`${bridge.base}${path}?from=${Date.now() + 60_000}`);
  expect(bad.status).toBe(400);
});
