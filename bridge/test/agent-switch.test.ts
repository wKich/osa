// Agent-selection tests over the black-box bridge (spec scenario "Selection
// is reported on the session and its next turn"): the TUI's mid-session agent
// choice is stored on the OpenCode session and reported on its following step
// frames, while the Maki child is not re-tasked — the pinned wire has no
// inbound `set_agent`. One spawned bridge with the scripted child on
// MAKI_CHILD_CMD; no Docker, gateway, network, or real Maki process.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const tracePath = join(tmpdir(), `maki-oss-agent-switch-trace-${process.pid}.jsonl`);

function post(b: BridgeHandle, path: string, body: unknown): Promise<{ status: number; json: any }> {
  return fetch(b.base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) }));
}

describe("agent selection over the spawned bridge", () => {
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

  test("the selection is reported on the session and its next turn", async () => {
    expect((await post(bridge, `/api/session/${sid}/agent`, { agent: "plan" })).status).toBe(204);

    const read = await (await fetch(`${bridge.base}/api/session/${sid}`)).json();
    expect(read.data.agent).toBe("plan");
    const list = await (await fetch(`${bridge.base}/api/session`)).json();
    expect(list.data.find((s: any) => s.id === sid)?.agent).toBe("plan");

    const done = bridge.frames.filter((f) => f.type === "session.execution.succeeded").length;
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "Reply with the word PONG only.", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => bridge.frames.filter((f) => f.type === "session.execution.succeeded").length > done, 30_000)).toBe(true);

    const step = bridge.frames.filter((f) => f.type === "session.step.started").at(-1)!;
    expect(step.data?.agent).toBe("plan");
  }, 60_000);

  test("an unknown session is not a silent success and no agent-control frame is sent", async () => {
    const unknown = "ses_agentunknown00000001";
    const res = await post(bridge, `/api/session/${unknown}/agent`, { agent: "plan" });
    expect(res.status).toBe(404);
    expect(res.json?._tag).toBe("SessionNotFoundError");
    expect((await fetch(`${bridge.base}/api/session/${unknown}`)).status).toBe(404);

    // the scripted child saw the prompt, never a control frame aimed at the agent
    expect(existsSync(tracePath)).toBe(true);
    const inbound = readFileSync(tracePath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    expect(inbound.some((f) => f.type === "user")).toBe(true);
    expect(inbound.filter((f) => f.type === "control_request")).toEqual([]);
  }, 30_000);
});
