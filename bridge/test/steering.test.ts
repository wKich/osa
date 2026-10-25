// Mid-turn prompts over the black-box bridge (spec "Queue a prompt sent while
// a turn runs"): the pinned Maki SDK runs each stdin `user` frame as its own
// run after the current one (sdk_mode.rs v0.6.5 L682–L702, L763; maki-agent
// headless.rs L365), so a prompt admitted mid-turn is reported with delivery
// `queue` (`session.inbox.delivery.changed`, session-event.ts v2.1.4 L237),
// its turn starts only after the running turn's result (`session.inbox.
// delivered`, L208), and a child that dies first cancels it
// (`session.inbox.cancelled`, L225). Spawned bridges with the scripted child on
// MAKI_CHILD_CMD; no Docker, gateway, network, or real Maki process.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle, type Frame } from "./lib/bridge.ts";

function post(b: BridgeHandle, path: string, body: unknown): Promise<{ status: number; json: any }> {
  return fetch(b.base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) }));
}

async function newSession(b: BridgeHandle): Promise<string> {
  const res = await post(b, "/api/session", { location: { directory: b.workdir } });
  expect(res.status).toBe(200);
  const sid = res.json.data.id as string;
  expect(await waitFor(() => b.frames.some((f) => f.type === "model.updated" && f.data?.sessionID === sid), 10_000)).toBe(true);
  return sid;
}

const of = (b: BridgeHandle, sid: string) => b.frames.filter((f) => f.data?.sessionID === sid);
const count = (b: BridgeHandle, sid: string, type: string) => of(b, sid).filter((f) => f.type === type).length;
const indexOf = (frames: Frame[], pred: (f: Frame) => boolean) => frames.findIndex(pred);

describe("mid-turn prompts over the spawned bridge", () => {
  let bridge: BridgeHandle;

  beforeAll(async () => {
    bridge = await startBridge();
  });

  afterAll(async () => {
    await bridge?.stop();
  });

  test("a steer prompt sent mid-turn is reported as queued and runs as the next turn", async () => {
    const sid = await newSession(bridge);
    const first = "msg_steering000000000001";
    const second = "msg_steering000000000002";
    expect((await post(bridge, `/api/session/${sid}/prompt`, { id: first, text: "run exactly: sleep 1 .", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => count(bridge, sid, "session.execution.started") === 1, 10_000)).toBe(true);
    expect(count(bridge, sid, "session.execution.succeeded")).toBe(0);

    const res = await post(bridge, `/api/session/${sid}/prompt`, { id: second, text: "Reply with the word PONG only.", delivery: "steer" });
    expect(res.status).toBe(200);
    // the admitted item says what will happen to it: it waits for the run
    expect(res.json?.data).toMatchObject({ id: second, sessionID: sid, type: "user", delivery: "queue", payload: { text: "Reply with the word PONG only." } });

    // SSE frames can trail the HTTP answer: wait for them before reading
    expect(await waitFor(() => count(bridge, sid, "session.inbox.delivery.changed") === 1, 5_000)).toBe(true);
    const enqueued = of(bridge, sid).find((f) => f.type === "session.inbox.enqueued" && f.data?.inboxID === second)!;
    expect(enqueued.data?.item?.delivery).toBe("steer");
    const changed = of(bridge, sid).filter((f) => f.type === "session.inbox.delivery.changed");
    expect(changed.map((f) => f.data)).toEqual([{ sessionID: sid, inboxID: second, delivery: "queue" }]);
    expect(changed[0]!.durable?.version).toBe(1);
    // no second execution while the first one runs
    expect(count(bridge, sid, "session.execution.started")).toBe(1);

    expect(await waitFor(() => count(bridge, sid, "session.execution.succeeded") === 2, 30_000)).toBe(true);
    const frames = of(bridge, sid);
    const types = frames.map((f) => f.type);
    const succeeded1 = types.indexOf("session.execution.succeeded");
    const delivered = indexOf(frames, (f) => f.type === "session.inbox.delivered" && f.data?.inboxID === second);
    const started2 = types.lastIndexOf("session.execution.started");
    expect(succeeded1).toBeGreaterThan(-1);
    expect(delivered).toBeGreaterThan(succeeded1);
    expect(started2).toBeGreaterThan(delivered);
    expect(frames[delivered]!.data).toEqual({ sessionID: sid, inboxID: second });

    // each turn's parts carry its own assistant message
    const steps = frames.filter((f) => f.type === "session.step.started");
    expect(steps).toHaveLength(2);
    const [am1, am2] = steps.map((f) => f.data?.assistantMessageID);
    expect(am1).not.toBe(am2);
    const textStart = frames.find((f) => f.type === "session.text.started")!;
    expect(textStart.data?.assistantMessageID).toBe(am2);
    const toolCalled = frames.find((f) => f.type === "session.tool.called")!;
    expect(toolCalled.data?.assistantMessageID).toBe(am1);
  }, 60_000);

  test("a queue prompt sent mid-turn keeps its delivery and changes nothing", async () => {
    const sid = await newSession(bridge);
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "run exactly: sleep 1 .", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => count(bridge, sid, "session.execution.started") === 1, 10_000)).toBe(true);
    const res = await post(bridge, `/api/session/${sid}/prompt`, { id: "msg_steering000000000003", text: "ping", delivery: "queue" });
    expect(res.json?.data?.delivery).toBe("queue");
    expect(count(bridge, sid, "session.inbox.delivery.changed")).toBe(0);
    expect(await waitFor(() => count(bridge, sid, "session.execution.succeeded") === 2, 30_000)).toBe(true);
    expect(count(bridge, sid, "session.inbox.delivered")).toBe(2);
    const deliveredIDs = of(bridge, sid)
      .filter((f) => f.type === "session.inbox.delivered")
      .map((f) => f.data?.inboxID);
    expect(deliveredIDs).toContain("msg_steering000000000003");
  }, 60_000);

  test("a prompt on an idle session starts at once and keeps its delivery", async () => {
    const sid = await newSession(bridge);
    const res = await post(bridge, `/api/session/${sid}/prompt`, { text: "ping", delivery: "steer" });
    expect(res.json?.data?.delivery).toBe("steer");
    expect(await waitFor(() => count(bridge, sid, "session.execution.succeeded") === 1, 30_000)).toBe(true);
    expect(count(bridge, sid, "session.inbox.delivery.changed")).toBe(0);
    expect(count(bridge, sid, "session.inbox.delivered")).toBe(1);
    const frames = of(bridge, sid);
    const enqueued = indexOf(frames, (f) => f.type === "session.inbox.enqueued");
    const delivered = indexOf(frames, (f) => f.type === "session.inbox.delivered");
    const text = indexOf(frames, (f) => f.type === "session.text.started");
    expect(enqueued).toBeGreaterThan(-1);
    expect(delivered).toBeGreaterThan(enqueued);
    expect(text).toBeGreaterThan(delivered);
  }, 60_000);
});

describe("queued prompts when the child dies", () => {
  let bridge: BridgeHandle;

  beforeAll(async () => {
    bridge = await startBridge();
  });

  afterAll(async () => {
    await bridge?.stop();
  });

  test("a queued prompt is cancelled when the child exits mid-turn", async () => {
    const sid = await newSession(bridge);
    expect((await post(bridge, `/api/session/${sid}/prompt`, { text: "run exactly: sleep 5 .", delivery: "steer" })).status).toBe(200);
    expect(await waitFor(() => count(bridge, sid, "session.execution.started") === 1, 10_000)).toBe(true);
    const queued = "msg_steering000000000004";
    expect((await post(bridge, `/api/session/${sid}/prompt`, { id: queued, text: "ping", delivery: "steer" })).status).toBe(200);

    // this bridge has one child: kill it with the turn in flight
    const children = (await Bun.$`pgrep -P ${bridge.pid}`.nothrow().text()).trim().split("\n").filter(Boolean);
    expect(children).toHaveLength(1);
    process.kill(Number(children[0]), "SIGKILL");

    expect(await waitFor(() => count(bridge, sid, "session.execution.failed") === 1, 10_000)).toBe(true);
    expect(await waitFor(() => count(bridge, sid, "session.inbox.cancelled") === 1, 5_000)).toBe(true);
    const cancelled = of(bridge, sid).find((f) => f.type === "session.inbox.cancelled")!;
    expect(cancelled.data).toEqual({ sessionID: sid, inboxID: queued });
    // the queued prompt never started a turn; the running one was delivered
    expect(count(bridge, sid, "session.execution.started")).toBe(1);
    expect(count(bridge, sid, "session.inbox.delivered")).toBe(1);
  }, 60_000);
});
