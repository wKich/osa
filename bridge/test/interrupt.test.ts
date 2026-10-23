// Interrupt coverage over the black-box bridge (spec "Accept an interrupt
// without claiming the child stopped"): the TUI's interrupt route is accepted
// mid-turn and answers `interrupted:false`, no cancellation frame reaches the
// Maki child (the pinned wire's `control_request`/`interrupt` is never sent),
// and the turn still succeeds. One spawned bridge with the scripted child on
// MAKI_CHILD_CMD; no Docker, gateway, network, or real Maki process.
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

function inboundFrames(): any[] {
  if (!existsSync(tracePath)) return [];
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    // the child's own outbound asks are traced with dir:"out"; only frames the
    // bridge wrote have no dir
    .filter((f) => f.dir !== "out");
}

const succeeded = (b: BridgeHandle) => b.frames.filter((f) => f.type === "session.execution.succeeded").length;

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

  test("an interrupt is accepted mid-turn and does not cancel the child", async () => {
    const done = succeeded(bridge);
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "run exactly: sleep 2 .", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.started" && f.data?.sessionID === sid), 10_000)).toBe(true);
    // the turn must still be running, or the interrupt assertion is vacuous
    expect(succeeded(bridge)).toBe(done);

    const res = await post(bridge, `/api/session/${sid}/interrupt`, {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ interrupted: false });

    // the child was not cancelled: the sleeping turn reaches its own result
    expect(await waitFor(() => succeeded(bridge) > done, 30_000)).toBe(true);
    expect(bridge.frames.filter((f) => f.type === "session.execution.interrupted")).toEqual([]);

    const inbound = inboundFrames();
    expect(inbound.some((f) => f.type === "user")).toBe(true);
    expect(inbound.filter((f) => f.type === "control_request")).toEqual([]);
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
