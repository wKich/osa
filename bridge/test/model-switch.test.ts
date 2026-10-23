// Mid-session model-switch tests over the black-box bridge (spec "Accept
// mid-session model selection without retasking the child"): the TUI's model
// POST is accepted, the child is not re-tasked (the pinned wire's `set_model`
// is never sent), and the child's announced model is still what the session
// and its following step frames report. One spawned bridge with the scripted
// child on MAKI_CHILD_CMD; no Docker, gateway, network, or real Maki process.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const tracePath = join(tmpdir(), `maki-oss-model-switch-trace-${process.pid}.jsonl`);

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

describe("mid-session model switch over the spawned bridge", () => {
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

  test("the switch is accepted and the announced model is still reported", async () => {
    // system.init arrives asynchronously; wait for the bridge's announcement
    // frame before comparing, so the assertion cannot race child startup
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated" && f.data?.sessionID === sid), 10_000)).toBe(true);

    const announced = { providerID: "synthetic", id: "fake" };
    const before = await (await fetch(`${bridge.base}/api/session/${sid}`)).json();
    expect(before.data.model).toEqual(announced);

    expect((await post(bridge, `/api/session/${sid}/model`, { model: { providerID: "maki", id: "switched" } })).status).toBe(204);

    const read = await (await fetch(`${bridge.base}/api/session/${sid}`)).json();
    expect(read.data.model).toEqual(announced);
    const list = await (await fetch(`${bridge.base}/api/session`)).json();
    expect(list.data.find((s: any) => s.id === sid)?.model).toEqual(announced);

    const done = bridge.frames.filter((f) => f.type === "session.execution.succeeded").length;
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "Reply with the word PONG only.", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => bridge.frames.filter((f) => f.type === "session.execution.succeeded").length > done, 30_000)).toBe(true);

    const step = bridge.frames.filter((f) => f.type === "session.step.started").at(-1)!;
    expect(step.data?.model).toEqual(announced);
  }, 60_000);

  test("an unknown session is not a silent success and no model-control frame is sent", async () => {
    const unknown = "ses_modelunknown0000001";
    const res = await post(bridge, `/api/session/${unknown}/model`, { model: { providerID: "maki", id: "switched" } });
    expect(res.status).toBe(404);
    expect(res.json?._tag).toBe("SessionNotFoundError");
    expect((await fetch(`${bridge.base}/api/session/${unknown}`)).status).toBe(404);

    // the scripted child saw the turn, never a model-control frame
    const inbound = inboundFrames();
    expect(inbound.some((f) => f.type === "user")).toBe(true);
    expect(inbound.filter((f) => f.type === "control_request")).toEqual([]);
    expect(inbound.some((f) => JSON.stringify(f).includes("set_model"))).toBe(false);
  }, 30_000);
});
