// Mid-session model-switch tests over the black-box bridge (spec "Forward
// mid-session model selection to the Maki child"): the TUI's model POST is
// forwarded as the pinned wire's inbound `control_request`/`set_model`
// (sdk_mode.rs v0.6.5 L861–L874), and only the child's success ack changes the
// model the session and its following step frames report; a rejected model
// leaves the announced one in place. One spawned bridge with the scripted
// child on MAKI_CHILD_CMD; no Docker, gateway, network, or real Maki process.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

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

const setModels = () => inboundFrames().filter((f) => f.type === "control_request" && f.request?.subtype === "set_model");
const modelUpdates = (b: BridgeHandle, sid: string) => b.frames.filter((f) => f.type === "model.updated" && f.data?.sessionID === sid).length;

describe("mid-session model switch over the spawned bridge", () => {
  let bridge: BridgeHandle;
  let sid: string;

  const sessionModel = async () => (await (await fetch(`${bridge.base}/api/session/${sid}`)).json()).data.model;

  async function turnStepModel() {
    const done = bridge.frames.filter((f) => f.type === "session.execution.succeeded").length;
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "Reply with the word PONG only.", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => bridge.frames.filter((f) => f.type === "session.execution.succeeded").length > done, 30_000)).toBe(true);
    return bridge.frames.filter((f) => f.type === "session.step.started" && f.data?.sessionID === sid).at(-1)!.data?.model;
  }

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
    // system.init arrives asynchronously; wait for the bridge's announcement
    expect(await waitFor(() => modelUpdates(bridge, sid) === 1, 10_000)).toBe(true);
  });

  afterAll(async () => {
    await bridge?.stop();
    rmSync(tracePath, { force: true });
  });

  test("a selection is forwarded as set_model and the acked model is reported", async () => {
    expect(await sessionModel()).toEqual({ providerID: "synthetic", id: "fake" });

    const res = await post(bridge, `/api/session/${sid}/model`, { model: { providerID: "maki-test", id: "switched" } });
    expect(res.status).toBe(204);

    expect(await waitFor(() => setModels().length === 1, 5_000)).toBe(true);
    const [sent] = setModels();
    expect(Object.keys(sent).sort()).toEqual(["request", "request_id", "type"]);
    expect(sent.request).toEqual({ subtype: "set_model", model: "maki-test/switched" });

    // the child's ack is what moves the reported model, announced to the TUI
    expect(await waitFor(() => modelUpdates(bridge, sid) === 2, 5_000)).toBe(true);
    const switched = { providerID: "maki-test", id: "switched" };
    expect(await sessionModel()).toEqual(switched);
    const list = await (await fetch(`${bridge.base}/api/session`)).json();
    expect(list.data.find((s: any) => s.id === sid)?.model).toEqual(switched);
    expect(await turnStepModel()).toEqual(switched);
    // the switch is the session's durable state and a transcript row, as the
    // real server records it (core session/message-updater.ts v2.1.4 L107–L119)
    const selected = bridge.frames.filter((f) => f.type === "session.model.selected" && f.data?.sessionID === sid);
    expect(selected.map((f) => f.data)).toEqual([{ sessionID: sid, model: switched, previous: { providerID: "synthetic", id: "fake" } }]);
    expect(selected[0]!.durable).toMatchObject({ aggregateID: sid, version: 1 });
    const path = `/api/session/${sid}/message`;
    const history = await (await fetch(`${bridge.base}${path}?order=asc`)).json();
    expect(validateBody(path, "GET", 200, history)).toBeNull();
    expect(history.data.find((m: any) => m.type === "model-switched")).toMatchObject({ model: switched, previous: { providerID: "synthetic", id: "fake" } });
  }, 60_000);

  test("a model under the bridge's bare-id provider is sent as the bare id", async () => {
    expect((await post(bridge, `/api/session/${sid}/model`, { model: { providerID: "maki", id: "bare-model" } })).status).toBe(204);
    expect(await waitFor(() => setModels().length === 2, 5_000)).toBe(true);
    expect(setModels()[1].request).toEqual({ subtype: "set_model", model: "bare-model" });
    expect(await waitFor(() => modelUpdates(bridge, sid) === 3, 5_000)).toBe(true);
    expect(await sessionModel()).toEqual({ providerID: "maki", id: "bare-model" });
  }, 30_000);

  test("a model the child rejects leaves the announced model in place", async () => {
    const before = await sessionModel();
    const updates = modelUpdates(bridge, sid);
    const selections = bridge.frames.filter((f) => f.type === "session.model.selected").length;
    expect((await post(bridge, `/api/session/${sid}/model`, { model: { providerID: "invalid", id: "nope" } })).status).toBe(204);
    expect(await waitFor(() => setModels().length === 3, 5_000)).toBe(true);
    // give the error ack time to arrive; it must not move the model
    await new Promise((r) => setTimeout(r, 300));
    expect(await sessionModel()).toEqual(before);
    expect(modelUpdates(bridge, sid)).toBe(updates);
    expect(bridge.frames.filter((f) => f.type === "session.model.selected").length).toBe(selections);
    expect(await turnStepModel()).toEqual(before);
  }, 60_000);

  test("re-posting the model already reported sends nothing", async () => {
    const before = setModels().length;
    const current = await sessionModel();
    expect((await post(bridge, `/api/session/${sid}/model`, { model: current })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 300));
    expect(setModels().length).toBe(before);
    expect(await sessionModel()).toEqual(current);
  }, 30_000);

  test("a selection without a provider and model is refused and sends nothing", async () => {
    const before = setModels().length;
    const res = await post(bridge, `/api/session/${sid}/model`, { model: { id: "only-id" } });
    expect(res.status).toBe(400);
    expect(res.json?._tag).toBe("InvalidRequestError");
    expect(setModels().length).toBe(before);
  }, 30_000);

  test("a session created on a catalog model starts on it; one outside the catalog starts on the configured model", async () => {
    const own = await startBridge({ FAKE_SANDBOX_BIN: join(import.meta.dir, "sandbox-bin"), FAKE_MAKI_TRACE: tracePath });
    try {
      const before = setModels().length;
      const create = async (model: { providerID: string; id: string }) => {
        const res = await post(own, "/api/session", { location: { directory: own.workdir }, model });
        const id = res.json.data.id as string;
        expect(await waitFor(() => modelUpdates(own, id) >= 1, 10_000)).toBe(true);
        return (await (await fetch(`${own.base}/api/session/${id}`)).json()).data.model;
      };
      // the scripted sandbox lists anthropic/claude-sonnet-5-5
      expect(await create({ providerID: "anthropic", id: "claude-sonnet-5-5" })).toEqual({ providerID: "anthropic", id: "claude-sonnet-5-5" });
      expect(await create({ providerID: "nowhere", id: "unlisted" })).toEqual({ providerID: "synthetic", id: "fake" });
      // neither start sent a model switch
      expect(setModels().length).toBe(before);
    } finally {
      await own.stop();
    }
  }, 60_000);

  test("an unknown session is not a silent success and no model-control frame is sent", async () => {
    const before = inboundFrames().length;
    const unknown = "ses_modelunknown0000001";
    const res = await post(bridge, `/api/session/${unknown}/model`, { model: { providerID: "maki", id: "switched" } });
    expect(res.status).toBe(404);
    expect(res.json?._tag).toBe("SessionNotFoundError");
    expect((await fetch(`${bridge.base}/api/session/${unknown}`)).status).toBe(404);
    expect(inboundFrames().length).toBe(before);
  }, 30_000);
});
