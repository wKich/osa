// Session idle state (add-session-idle-state): a terminal execution
// transition is the session's `time.idle` and `outcome`, set before the frame
// the TUI re-reads on, strictly advancing; `session.view` acknowledges it
// (core session/session.ts v2.0.32 L61–L70, projector.ts L412–L440, L601–L611).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
beforeAll(async () => {
  bridge = await startBridge();
});
afterAll(async () => {
  await bridge?.stop();
});

const post = (path: string, body: unknown) =>
  fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const read = async (sid: string) => {
  const res = await fetch(`${bridge.base}/api/session/${sid}`);
  const body = await res.json();
  expect(validateBody(`/api/session/${sid}`, "GET", res.status, body)).toBeNull();
  return body.data;
};

test("a finished run marks the session idle and unread; view acknowledges it once", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  expect((await read(sid)).time.idle).toBeUndefined();
  const done = () => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid);
  await post(`/api/session/${sid}/prompt`, { text: "hello" });
  expect(await waitFor(() => done().length === 1)).toBe(true);
  const first = await read(sid);
  expect(first.outcome).toBe("succeeded");
  expect(first.time.idle).toBe(done()[0]!.created);
  expect(first.time.viewed).toBeUndefined();

  // a stale or future watermark is ignored
  expect((await post(`/api/session/${sid}/view`, { idle: first.time.idle + 1 })).status).toBe(204);
  expect((await read(sid)).time.viewed).toBeUndefined();
  expect((await post(`/api/session/${sid}/view`, { idle: "x" })).status).toBe(400);

  expect((await post(`/api/session/${sid}/view`, { idle: first.time.idle })).status).toBe(204);
  expect((await read(sid)).time.viewed).toBe(first.time.idle);
  expect((await post(`/api/session/${sid}/view`, { idle: first.time.idle })).status).toBe(204);
  const viewed = bridge.frames.filter((f) => f.type === "session.viewed" && f.data?.sessionID === sid);
  expect(viewed.map((f) => f.data!.idle)).toEqual([first.time.idle]);

  await post(`/api/session/${sid}/prompt`, { text: "again" });
  expect(await waitFor(() => done().length === 2)).toBe(true);
  const second = await read(sid);
  expect(second.time.idle).toBeGreaterThan(first.time.idle);
  expect(second.time.idle).toBeGreaterThan(second.time.viewed);
});
