// Maki's per-message envelope (top-level session_id + uuid) rides every
// outbound frame. The bridge treats it as transport metadata: a child that
// announces its own session_id keeps emitting under the OpenCode-minted ses_
// id instead of rebinding the session.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { loadFixture } from "./lib/projection.ts";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const CAPTURED = [
  "maki-plain",
  "maki-tool",
  "maki-precheck",
  "maki-permission",
  "maki-stream-live",
  "maki-subagent-live",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertEnvelope(name: string, line: number, frame: Record<string, any>): void {
  if (frame.type === "driver.exit") return; // fixture driver marker, not a Maki frame
  const where = `${name}.jsonl line ${line} (${frame.type})`;
  expect(typeof frame.session_id, `${where}: session_id`).toBe("string");
  expect(frame.session_id.length, `${where}: session_id is empty`).toBeGreaterThan(0);
  expect(frame.uuid, `${where}: uuid`).toMatch(UUID);
}

test("every captured outbound frame carries the per-message envelope", () => {
  for (const name of CAPTURED) {
    for (const [i, frame] of loadFixture(name).entries()) assertEnvelope(name, i + 1, frame);
  }
});

test("the envelope check rejects a frame without the envelope", () => {
  expect(() => assertEnvelope("probe", 1, { type: "assistant", uuid: crypto.randomUUID() })).toThrow();
  expect(() => assertEnvelope("probe", 1, { type: "assistant", session_id: "s", uuid: "not-a-uuid" })).toThrow();
});

let bridge: BridgeHandle;
let sid: string;

beforeAll(async () => {
  bridge = await startBridge();
  const res = await fetch(`${bridge.base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ location: { directory: bridge.workdir } }),
  });
  expect(res.status).toBe(200);
  sid = (await res.json()).data.id;
  const sent = await fetch(`${bridge.base}/api/session/${sid}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "msg_envelope00000000001", text: "Reply with the word PONG only.", delivery: "steer" }),
  });
  expect(sent.status).toBe(200);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.succeeded"), 30_000)).toBe(true);
}, 60_000);

afterAll(async () => {
  await bridge?.stop();
});

test("the child's envelope does not rebind the session", () => {
  // the scripted child announces fake-maki-session on every frame
  expect(bridge.frames.some((f) => f.data?.sessionID === "fake-maki-session")).toBe(false);

  const addressed = bridge.frames.filter((f) => f.data?.sessionID !== undefined);
  expect(addressed.length).toBeGreaterThan(0);
  for (const f of addressed) expect(f.data!.sessionID).toBe(sid);

  const durable = bridge.frames.filter((f) => f.durable);
  expect(durable.length).toBeGreaterThan(0);
  for (const f of durable) expect(f.durable!.aggregateID).toBe(sid);
});
