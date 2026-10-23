// Offline coverage for the active-session map (add-session-active-state): the
// TUI reads `GET /api/session/active` on every server.connected, so a session
// with a turn in flight must read as running there — and only while the turn
// runs — or a reconnecting TUI shows it idle with no interrupt control. Drives
// the shipped entrypoint over the MAKI_CHILD_CMD seam with a slow tool call.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

async function post(bridge: BridgeHandle, path: string, body: unknown): Promise<Response> {
  return fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function active(bridge: BridgeHandle): Promise<Record<string, unknown>> {
  const res = await fetch(`${bridge.base}/api/session/active`);
  const body = await res.json();
  expect(validateBody("/api/session/active", "GET", res.status, body)).toBeNull();
  return body.data;
}

describe("active session map", () => {
  let bridge: BridgeHandle;
  let busy: string;
  let idle: string;

  beforeAll(async () => {
    bridge = await startBridge();
    busy = (await (await post(bridge, "/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
    idle = (await (await post(bridge, "/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  });

  afterAll(async () => {
    await bridge?.stop();
  });

  test("no session is active before a turn", async () => {
    expect(await active(bridge)).toEqual({});
  });

  test("a session is running while its turn is in flight, and idle after", async () => {
    const turns = () => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === busy).length;
    expect((await post(bridge, `/api/session/${busy}/prompt`, { text: "run exactly: sleep 2 .", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.started" && f.data?.sessionID === busy), 10_000)).toBe(true);

    expect(await active(bridge)).toEqual({ [busy]: { type: "running" } });
    expect(idle in (await active(bridge))).toBe(false);

    expect(await waitFor(() => turns() === 1, 15_000)).toBe(true);
    expect(await active(bridge)).toEqual({});
  });
});
