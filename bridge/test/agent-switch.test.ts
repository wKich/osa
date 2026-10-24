// Agent selection over the black-box bridge (add-plan-agent): Maki's agents
// are its build and plan modes, so a selection becomes the pinned
// set_permission_mode control (sdk_mode.rs v0.6.4 L846–L860) written before
// the next user message, which runs in that mode (L688–L696); `build`
// restores the mode the child started in. The selection is durable session
// state (session.agent.selected) and a transcript row. One spawned bridge
// with the scripted child on MAKI_CHILD_CMD; no Docker, gateway, or real Maki.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

const tracePath = join(tmpdir(), `maki-oss-agent-switch-trace-${process.pid}.jsonl`);

function post(b: BridgeHandle, path: string, body: unknown): Promise<{ status: number; json: any }> {
  return fetch(b.base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) }));
}

const inbound = () =>
  existsSync(tracePath)
    ? readFileSync(tracePath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((f) => f.dir !== "out")
    : [];
const modeControls = () => inbound().filter((f) => f.type === "control_request" && f.request?.subtype === "set_permission_mode");

describe("agent selection over the spawned bridge", () => {
  let bridge: BridgeHandle;
  let sid: string;

  beforeAll(async () => {
    rmSync(tracePath, { force: true });
    bridge = await startBridge({ FAKE_MAKI_TRACE: tracePath });
    const res = await post(bridge, "/api/session", { location: { directory: bridge.workdir } });
    expect(res.status).toBe(200);
    sid = res.json.data.id;
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated" && f.data?.sessionID === sid), 10_000)).toBe(true);
  });

  afterAll(async () => {
    await bridge?.stop();
    rmSync(tracePath, { force: true });
  });

  test("the agent list is Maki's two modes", async () => {
    const body = await (await fetch(`${bridge.base}/api/agent`)).json();
    expect(validateBody("/api/agent", "GET", 200, body)).toBeNull();
    expect(body.data.map((a: any) => [a.id, a.mode])).toEqual([["build", "primary"], ["plan", "primary"]]);
  });

  test("plan becomes Maki's plan mode before the next turn, and is durable", async () => {
    expect((await post(bridge, `/api/session/${sid}/agent`, { agent: "plan" })).status).toBe(204);
    const read = await (await fetch(`${bridge.base}/api/session/${sid}`)).json();
    expect(read.data.agent).toBe("plan");
    expect(await waitFor(() => modeControls().length === 1)).toBe(true);
    expect(modeControls()[0].request).toEqual({ subtype: "set_permission_mode", mode: "plan" });

    const done = bridge.frames.filter((f) => f.type === "session.execution.succeeded").length;
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "Reply with the word PONG only.", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => bridge.frames.filter((f) => f.type === "session.execution.succeeded").length > done, 30_000)).toBe(true);
    // the mode control went to the child before the turn's prompt
    const frames = inbound();
    expect(frames.findIndex((f) => f.request?.subtype === "set_permission_mode")).toBeLessThan(frames.findIndex((f) => f.type === "user"));
    expect(bridge.frames.filter((f) => f.type === "session.step.started").at(-1)!.data?.agent).toBe("plan");

    const selected = bridge.frames.filter((f) => f.type === "session.agent.selected" && f.data?.sessionID === sid);
    expect(selected.map((f) => f.data)).toEqual([{ sessionID: sid, agent: "plan", previous: "build" }]);
    expect(selected[0]!.durable).toMatchObject({ aggregateID: sid, version: 1 });
    const path = `/api/session/${sid}/message`;
    const history = await (await fetch(`${bridge.base}${path}?order=asc`)).json();
    expect(validateBody(path, "GET", 200, history)).toBeNull();
    expect(history.data.find((m: any) => m.type === "agent-switched")).toMatchObject({ agent: "plan", previous: "build" });
  }, 60_000);

  test("build restores the mode the child started in; a repeat sends nothing", async () => {
    expect((await post(bridge, `/api/session/${sid}/agent`, { agent: "build" })).status).toBe(204);
    expect(await waitFor(() => modeControls().length === 2)).toBe(true);
    expect(modeControls()[1].request).toEqual({ subtype: "set_permission_mode", mode: "default" });
    expect((await post(bridge, `/api/session/${sid}/agent`, { agent: "build" })).status).toBe(204);
    await Bun.sleep(300);
    expect(modeControls().length).toBe(2);
  }, 30_000);

  test("a session created as plan starts in plan mode", async () => {
    const res = await post(bridge, "/api/session", { location: { directory: bridge.workdir }, agent: "plan" });
    expect(res.json.data.agent).toBe("plan");
    expect(await waitFor(() => modeControls().length === 3)).toBe(true);
    expect(modeControls()[2].request.mode).toBe("plan");
  }, 30_000);

  test("an agent Maki has no mode for, or an unknown session, is refused", async () => {
    const before = modeControls().length;
    const bad = await post(bridge, `/api/session/${sid}/agent`, { agent: "general" });
    expect(bad.status).toBe(400);
    expect(bad.json?._tag).toBe("InvalidRequestError");
    const unknown = await post(bridge, "/api/session/ses_agentunknown00000001/agent", { agent: "plan" });
    expect(unknown.status).toBe(404);
    expect(unknown.json?._tag).toBe("SessionNotFoundError");
    expect(modeControls().length).toBe(before);
  }, 30_000);
});
