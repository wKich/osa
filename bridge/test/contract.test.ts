// Contract and wire tests (spec scenario "Contract and wire rules are
// enforced"): bridge response bodies against the vendored OpenAPI 2.0.32 with
// ajv/dist/2020, plus the measured SSE rules — first frame server.connected,
// bare `data:` frames, OpenCode id patterns. Runs against a live bridge
// process and against the committed captures, and proves a corrupted body is
// rejected.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle, type RequestLogEntry } from "./lib/bridge.ts";
import { checkIdPatterns, checkRawSse, checkRequestLog, validateBody } from "./lib/contract.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const asLog = (name: string): RequestLogEntry[] =>
  fixture(name)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

describe("archived captures", () => {
  test("logged response bodies validate against the pinned contract", () => {
    const { checked, failures, unhandled404 } = checkRequestLog(asLog("bridge-requests.jsonl"));
    expect(unhandled404).toEqual([]);
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  test("a deliberately corrupted body fails validation", () => {
    const info = asLog("bridge-requests.jsonl").find((r) => r.path === "/api/info" && r.status === 200);
    expect(info).toBeDefined();
    const corrupted = JSON.stringify(info!.resp); // body no longer matches its schema
    const detail = validateBody("/api/info", "GET", 200, corrupted);
    expect(detail).not.toBeNull();
    const dropped = { ...(info!.resp as Record<string, unknown>) };
    delete dropped.version;
    expect(validateBody("/api/info", "GET", 200, dropped)).not.toBeNull();
  });

  test("raw SSE capture obeys the wire rules", () => {
    const raw = fixture("bridge-sse-raw.txt");
    const { failures, frames } = checkRawSse(raw);
    expect(failures).toEqual([]);
    expect(frames.length).toBeGreaterThan(0);
    expect(checkIdPatterns(frames)).toEqual([]);
  });
});

describe("live bridge", () => {
  let bridge: BridgeHandle;

  beforeAll(async () => {
    // a short keepalive interval so the idle-gap test observes one heartbeat
    // without waiting out the production 15s
    bridge = await startBridge({ SSE_HEARTBEAT_MS: "300" });
  });
  afterAll(async () => {
    await bridge?.stop();
  });

  test("boot routes answer 2xx with contract-valid bodies", async () => {
    for (const path of ["/api/info", "/api/model", "/api/agent", "/api/project"]) {
      const res = await fetch(bridge.base + path);
      const body = await res.json();
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(validateBody(path, "GET", res.status, body)).toBeNull();
    }
  });

  test("a prompt turn emits a valid SSE stream", async () => {
    const created = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    expect(created.status).toBe(200);
    const sid = (await created.json()).data.id;
    expect(String(sid)).toMatch(/^ses/);

    await fetch(`${bridge.base}/api/session/${sid}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "msg_contract0000000001", text: "Reply with the word PONG only.", files: [], agents: [], delivery: "steer" }),
    });
    const done = await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.succeeded"));
    expect(done).toBe(true);

    const wire = checkRawSse(bridge.rawSse());
    expect(wire.failures).toEqual([]);
    expect(wire.frames[0]?.type).toBe("server.connected");
    expect(checkIdPatterns(bridge.frames)).toEqual([]);

    // the announcement invalidates the TUI's boot-time model list, and the
    // refetched list must name the announced model (its submit gate checks it)
    expect(bridge.frames.some((f) => f.type === "model.updated")).toBe(true);
    const models = (await (await fetch(`${bridge.base}/api/model`)).json()).data;
    expect(models.some((m: any) => m.providerID === "synthetic" && m.id === "fake")).toBe(true);
  });

  // without a comment the client aborts after 45 silent seconds and re-boots
  // (defect tui-sse-idle-reconnect-drops-next-turn)
  test("an idle stream keeps sending heartbeat comments", async () => {
    const heartbeats = () => (bridge.rawSse().match(/: heartbeat/g) ?? []).length;
    const before = heartbeats();
    expect(await waitFor(() => heartbeats() > before, 5_000)).toBe(true);
    // comments are comments: they keep the link alive without becoming frames
    const wire = checkRawSse(bridge.rawSse());
    expect(wire.failures).toEqual([]);
    expect(wire.frames[0]?.type).toBe("server.connected");
    expect(bridge.frames[0]?.type).toBe("server.connected");
  });

  test("every logged live body validates; no unhandled route", () => {
    const { checked, failures, unhandled404 } = checkRequestLog(bridge.requests() as RequestLogEntry[]);
    expect(unhandled404).toEqual([]);
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});
