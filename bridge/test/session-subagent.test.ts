// Subagent child sessions (add-subagent-sessions): a Task call opens a child
// session (parentID, the task's description as title, Maki's subagent type as
// agent) announced with session.created; the subagent's frames — flagged
// buffered frames and the unflagged stream while the task runs — render
// there; the task's tool part names the child (core tool/plugin/subagent.ts
// v2.0.32 L184–L215; sdk_mode.rs v0.6.4 L1022–L1050).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

const TASK = { description: "Echo a marker", prompt: "Reply with the word MARK only.", subagent_type: "general" };
let bridge: BridgeHandle;
beforeAll(async () => {
  bridge = await startBridge({
    FAKE_MAKI_SCRIPT: JSON.stringify([
      { call: { opencode: { name: "subagent", input: {} }, maki: { name: "task", input: TASK, result: "MARK" }, subagent: true } },
      { text: "MARK", stream: ["MA", "RK"] },
      { text: "DONE", stream: ["DO", "NE"] },
    ]),
  });
});
afterAll(async () => {
  await bridge?.stop();
});

const post = (path: string, body: unknown) =>
  fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a task call runs as a child session the parent names", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  await post(`/api/session/${sid}/prompt`, { text: "delegate" });
  expect(await waitFor(() => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid).length === 1, 15_000)).toBe(true);

  const created = bridge.frames.find((f) => f.type === "session.created")!;
  const child = created.data!.sessionID as string;
  expect(created.data).toMatchObject({ parentID: sid, title: "Echo a marker", agent: "general" });

  const listPath = `/api/session?parentID=${sid}`;
  const children = (await (await fetch(bridge.base + listPath)).json()).data;
  expect(children.map((c: any) => [c.id, c.parentID, c.title])).toEqual([[child, sid, "Echo a marker"]]);
  const roots = (await (await fetch(`${bridge.base}/api/session?parentID=null`)).json()).data;
  expect(roots.map((c: any) => c.id)).toEqual([sid]);
  const info = await (await fetch(`${bridge.base}/api/session/${child}`)).json();
  expect(validateBody(`/api/session/${child}`, "GET", 200, info)).toBeNull();

  const childMessages = (await (await fetch(`${bridge.base}/api/session/${child}/message?order=asc`)).json()).data;
  expect(childMessages.map((m: any) => m.type)).toEqual(["user", "assistant", "idle"]);
  expect(childMessages[0].text).toBe("Reply with the word MARK only.");
  expect(childMessages[1].content).toEqual([{ type: "text", text: "MARK" }]);

  const parentMessages = (await (await fetch(`${bridge.base}/api/session/${sid}/message?order=asc`)).json()).data;
  const assistant = parentMessages.find((m: any) => m.type === "assistant");
  // the subagent's text stays out of the parent; the task part names the child
  expect(assistant.content.filter((p: any) => p.type === "text").map((p: any) => p.text)).toEqual(["DONE"]);
  const success = bridge.frames.find((f) => f.type === "session.tool.success" && f.data?.sessionID === sid)!;
  expect(success.data!.metadata).toEqual({ sessionID: child, status: "completed" });
  expect((await post(`/api/session/${child}/prompt`, { text: "more" })).status).toBe(503);
});
