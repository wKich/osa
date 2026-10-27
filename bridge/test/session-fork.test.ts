// Session fork (add-session-fork): the full-session fork continues the stored
// Maki session under a new id and copies the settled transcript under the
// real projector's ids; a mid-session boundary is refused (the pinned child
// forks whole sessions only). server handlers/session.ts v2.1.4 L193–L206.
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

test("a full fork opens a titled copy; a cut, unknown, or empty fork is refused", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  const forkPath = `/api/session/${sid}/fork`;
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated" && f.data?.sessionID === sid))).toBe(true);
  const empty = await post(forkPath, {});
  expect(empty.status).toBe(400);
  expect(validateBody(forkPath, "POST", 400, await empty.json())).toBeNull();

  await post(`/api/session/${sid}/prompt`, { text: "hello" });
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.renamed" && f.data?.sessionID === sid))).toBe(true);

  const res = await post(forkPath, {});
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(validateBody(forkPath, "POST", 200, body)).toBeNull();
  const fork = body.data;
  expect(fork.id).not.toBe(sid);
  expect(fork.title).toBe("hello (fork #1)");
  expect(fork.fork.sessionID).toBe(sid);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.forked"))).toBe(true);
  const frame = bridge.frames.find((f) => f.type === "session.forked")!;
  expect(frame.data).toMatchObject({ sessionID: fork.id, parentID: sid, boundary: { type: "through" } });
  expect(frame.durable?.version).toBe(2);

  const copied = (await (await fetch(`${bridge.base}/api/session/${fork.id}/message?order=asc`)).json()).data;
  expect(copied.map((m: any) => m.type)).toEqual(["user", "assistant", "idle"]);
  expect(copied[0].text).toBe("hello");
  expect(copied[0].id).toMatch(/^msg_.+_1$/);

  const parentFirst = (await (await fetch(`${bridge.base}/api/session/${sid}/message?order=asc`)).json()).data[0].id;
  expect((await post(forkPath, { before: parentFirst })).status).toBe(400);
  const unknown = await post(forkPath, { before: "msg_unknown000000000000" });
  expect(unknown.status).toBe(404);
  expect(validateBody(forkPath, "POST", 404, await unknown.json())).toBeNull();

  // the fork is its own live session
  await post(`/api/session/${fork.id}/prompt`, { text: "again" });
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === fork.id))).toBe(true);
});

test("forking mid-turn names the last copied message, not the in-flight assistant message", async () => {
  const inflight = await startBridge({ FAKE_MAKI_SCRIPT: JSON.stringify([{ text: "slow answer", stream: ["slow", " answer"], delayMs: 4000 }]) });
  try {
    const send = (path: string, body: unknown) =>
      fetch(inflight.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const sid = (await (await send("/api/session", { location: { directory: inflight.workdir } })).json()).data.id;
    expect(await waitFor(() => inflight.frames.some((f) => f.type === "model.updated" && f.data?.sessionID === sid))).toBe(true);
    await send(`/api/session/${sid}/prompt`, { text: "go slowly" });
    // the turn is open: the assistant message exists and has no completion time
    expect(await waitFor(() => inflight.frames.some((f) => f.type === "session.step.started" && f.data?.sessionID === sid))).toBe(true);
    const parent = (await (await fetch(`${inflight.base}/api/session/${sid}/message?order=asc`)).json()).data;
    expect(parent.map((m: any) => m.type)).toEqual(["user", "assistant"]);
    expect(parent[1].time.completed).toBeUndefined();

    const res = await send(`/api/session/${sid}/fork`, {});
    const body = await res.json();
    expect(res.status).toBe(200);
    const fork = body.data;
    const copied = (await (await fetch(`${inflight.base}/api/session/${fork.id}/message?order=asc`)).json()).data;
    expect(copied.map((m: any) => m.type)).toEqual(["user"]);
    expect(copied[0].text).toBe("go slowly");
    // the boundary is the copied user message of the parent, never the unfinished assistant one
    expect(fork.fork.boundary).toEqual({ type: "through", messageID: parent[0].id });
    expect(fork.fork.boundary.messageID).not.toBe(parent[1].id);
  } finally {
    await inflight.stop();
  }
}, 30_000);
