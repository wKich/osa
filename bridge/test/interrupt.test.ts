// Interrupt forwarding over the black-box bridge (spec "Forward an interrupt
// to the Maki child"): the TUI's interrupt route cancels an in-flight turn by
// writing the pinned wire's inbound `control_request`/`interrupt` (sdk_mode.rs
// v0.6.4 L840–L843) and answers `interrupted:true`; the cancelled turn's error
// result ends as `session.execution.interrupted` (session-event.ts v2.0.32
// `Execution.Interrupted`), not as a failure. An idle session is the pinned
// no-op (`interrupted:false`, nothing written). One spawned bridge with the
// scripted child on MAKI_CHILD_CMD; no Docker, gateway, network, or real Maki.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const tracePath = join(tmpdir(), `maki-oss-interrupt-trace-${process.pid}.jsonl`);

function post(b: BridgeHandle, path: string, body: unknown): Promise<{ status: number; json: any }> {
  return fetch(b.base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) }));
}

function traced(): any[] {
  if (!existsSync(tracePath)) return [];
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// the child's own outbound asks are traced with dir:"out"; only frames the
// bridge wrote have no dir
const inboundFrames = () => traced().filter((f) => f.dir !== "out");
const interrupts = () => inboundFrames().filter((f) => f.type === "control_request" && f.request?.subtype === "interrupt");

const count = (b: BridgeHandle, type: string, sid: string) =>
  b.frames.filter((f) => f.type === type && f.data?.sessionID === sid).length;

describe("interrupt over the spawned bridge", () => {
  let bridge: BridgeHandle;
  let sid: string;

  beforeAll(async () => {
    rmSync(tracePath, { force: true });
    bridge = await startBridge({ FAKE_MAKI_TRACE: tracePath });
    const res = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    expect(res.status).toBe(200);
    sid = (await res.json()).data.id;
  });

  afterAll(async () => {
    await bridge?.stop();
    rmSync(tracePath, { force: true });
  });

  test("an idle session is the pinned no-op: interrupted:false and nothing written", async () => {
    const before = inboundFrames().length;
    const res = await post(bridge, `/api/session/${sid}/interrupt`, {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ interrupted: false });
    expect(inboundFrames().length).toBe(before);
    expect(count(bridge, "session.execution.interrupted", sid)).toBe(0);
  }, 30_000);

  test("an in-flight turn is cancelled with control_request/interrupt and ends interrupted", async () => {
    const succeeded = count(bridge, "session.execution.succeeded", sid);
    const failed = count(bridge, "session.execution.failed", sid);
    const started = count(bridge, "session.execution.started", sid);
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "run exactly: sleep 5 .", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => count(bridge, "session.execution.started", sid) > started, 10_000)).toBe(true);
    // the turn must still be running, or the interrupt assertion is vacuous
    expect(count(bridge, "session.execution.succeeded", sid)).toBe(succeeded);

    const res = await post(bridge, `/api/session/${sid}/interrupt`, {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ interrupted: true });

    // exactly one pinned cancellation frame, addressed with a request id (the
    // trace is written when the child reads the line, so wait for it)
    expect(await waitFor(() => interrupts().length > 0, 5_000)).toBe(true);
    const sent = interrupts();
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]).sort()).toEqual(["request", "request_id", "type"]);
    expect(sent[0].request).toEqual({ subtype: "interrupt" });
    expect(typeof sent[0].request_id).toBe("string");

    // the child's error result ends the turn as interrupted, well before the
    // 5 s command would have finished, and never as success or failure
    expect(await waitFor(() => count(bridge, "session.execution.interrupted", sid) === 1, 4_000)).toBe(true);
    const frame = bridge.frames.find((f) => f.type === "session.execution.interrupted" && f.data?.sessionID === sid)!;
    expect(frame.data).toEqual({ sessionID: sid, reason: "user" });
    expect(frame.durable?.version).toBe(1);
    expect(count(bridge, "session.execution.succeeded", sid)).toBe(succeeded);
    expect(count(bridge, "session.execution.failed", sid)).toBe(failed);
    // the step fails with the pinned interruption error, carrying no usage
    const stepFailed = bridge.frames.filter((f) => f.type === "session.step.failed" && f.data?.sessionID === sid);
    expect(stepFailed.map((f) => f.data?.error)).toEqual([{ type: "aborted", message: "Step interrupted" }]);
    expect(stepFailed[0]!.data?.tokens).toBeUndefined();
  }, 60_000);

  test("the session keeps working after an interrupt", async () => {
    const succeeded = count(bridge, "session.execution.succeeded", sid);
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "ping", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded", sid) > succeeded, 10_000)).toBe(true);
    // a finished turn is idle again: no second cancellation is written
    expect((await post(bridge, `/api/session/${sid}/interrupt`, {})).json).toEqual({ interrupted: false });
    expect(interrupts()).toHaveLength(1);
  }, 30_000);

  test("a pending permission ask is denied before the run is cancelled", async () => {
    const asked = bridge.frames.filter((f) => f.type === "permission.asked").length;
    const before = inboundFrames().length;
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "run exactly: rm -f nothing-here .", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => bridge.frames.filter((f) => f.type === "permission.asked").length > asked, 10_000)).toBe(true);
    const ask = bridge.frames.filter((f) => f.type === "permission.asked").at(-1)!;

    expect((await post(bridge, `/api/session/${sid}/interrupt`, {})).json).toEqual({ interrupted: true });

    // the parked ask is answered (deny) and then the run is cancelled
    expect(await waitFor(() => interrupts().length === 2, 5_000)).toBe(true);
    const written = inboundFrames().slice(before).filter((f) => f.type !== "user");
    expect(written.map((f) => f.type)).toEqual(["control_response", "control_request"]);
    expect(written[0].response.behavior).toBe("deny");
    expect(written[1].request).toEqual({ subtype: "interrupt" });
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "permission.replied" && f.data?.requestID === ask.data?.id && f.data?.reply === "reject"), 5_000)).toBe(true);
    // the TUI no longer sees the ask as pending
    const pending = await (await fetch(`${bridge.base}/api/session/${sid}/permission`)).json();
    expect(pending.data).toEqual([]);
    expect(await waitFor(() => count(bridge, "session.execution.interrupted", sid) === 2, 10_000)).toBe(true);
  }, 60_000);

  test("an unknown session is not a silent success", async () => {
    const unknown = "ses_interruptunknown0001";
    const before = inboundFrames().length;
    const res = await post(bridge, `/api/session/${unknown}/interrupt`, {});
    expect(res.status).toBe(404);
    expect(res.json?._tag).toBe("SessionNotFoundError");
    expect((await fetch(`${bridge.base}/api/session/${unknown}`)).status).toBe(404);
    expect(inboundFrames().length).toBe(before);
  }, 30_000);
});
