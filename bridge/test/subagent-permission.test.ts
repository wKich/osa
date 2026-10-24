// A subagent's permission ask (fix-subagent-permission-session): the pinned
// can_use_tool names only the tool id (sdk_mode.rs v0.6.4 L1122–L1160), so
// the bridge files a subagent's call under its child session, as OpenCode
// does, which makes the TUI offer a reject reason (tui routes/session/
// permission.tsx v2.0.32 L248–L251). The scripted child mirrors the pinned
// SDK, which cannot answer a subagent's ask: the run waits until interrupted.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const trace = join(tmpdir(), `maki-oss-subagent-permission-${process.pid}.jsonl`);
const TASK = { description: "Remove a probe", prompt: "Run rm -f probe.txt", subagent_type: "general" };
let bridge: BridgeHandle;
beforeAll(async () => {
  rmSync(trace, { force: true });
  bridge = await startBridge({
    FAKE_MAKI_TRACE: trace,
    FAKE_MAKI_SCRIPT: JSON.stringify([
      { call: { opencode: { name: "subagent", input: {} }, maki: { name: "task", input: TASK, result: "GONE" }, subagent: true } },
      { tool: { command: "rm -f probe.txt", needsPermission: true } },
      { text: "GONE" },
      { text: "DONE" },
    ]),
  });
});
afterAll(async () => {
  await bridge?.stop();
  rmSync(trace, { force: true });
});

const post = (path: string, body: unknown) =>
  fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const inbound = () => (existsSync(trace) ? readFileSync(trace, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((f) => f.dir !== "out") : []);

test("a subagent's ask is the child session's, answered through the one Maki child", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  await post(`/api/session/${sid}/prompt`, { text: "delegate" });
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "permission.asked"), 15_000)).toBe(true);
  const child = bridge.frames.find((f) => f.type === "session.created")!.data!.sessionID as string;
  const asked = bridge.frames.find((f) => f.type === "permission.asked")!;
  expect(asked.data).toMatchObject({ sessionID: child, action: "shell", resources: ["rm -f probe.txt"] });
  // the source names the child's own tool part
  const childTool = bridge.frames.find((f) => f.type === "session.tool.called" && f.data?.sessionID === child)!;
  expect(asked.data!.source).toEqual({ type: "tool", messageID: childTool.data!.assistantMessageID, id: "toolu_fake000002" });
  expect(childTool.data!.assistantMessageID).toBe(asked.data!.source.messageID);

  expect((await (await fetch(`${bridge.base}/api/session/${sid}/permission`)).json()).data).toEqual([]);
  const listed = (await (await fetch(`${bridge.base}/api/session/${child}/permission`)).json()).data;
  expect(listed.map((p: any) => p.id)).toEqual([asked.data!.id]);

  const reply = await post(`/api/session/${child}/permission/${asked.data!.id}/reply`, { decision: "reject", message: "Keep the probe file" });
  expect(reply.status).toBe(204);
  expect(await waitFor(() => inbound().some((f) => f.type === "control_response" && f.response?.behavior === "deny" && f.response?.message === "Keep the probe file"))).toBe(true);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "permission.replied"))).toBe(true);
  expect(bridge.frames.find((f) => f.type === "permission.replied")!.data).toMatchObject({ sessionID: child, reply: "reject" });
});

test("interrupting the parent settles an ask its subagent left open", async () => {
  const fresh = await startBridge({
    FAKE_MAKI_SCRIPT: JSON.stringify([
      { call: { opencode: { name: "subagent", input: {} }, maki: { name: "task", input: TASK, result: "GONE" }, subagent: true } },
      { tool: { command: "rm -f probe.txt", needsPermission: true } },
      { text: "GONE" },
    ]),
  });
  try {
    const send = (path: string, body: unknown) =>
      fetch(fresh.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const sid = (await (await send("/api/session", { location: { directory: fresh.workdir } })).json()).data.id;
    await send(`/api/session/${sid}/prompt`, { text: "delegate" });
    expect(await waitFor(() => fresh.frames.some((f) => f.type === "permission.asked"), 15_000)).toBe(true);
    const asked = fresh.frames.find((f) => f.type === "permission.asked")!;
    const res = await send(`/api/session/${sid}/interrupt`, {});
    expect((await res.json()).interrupted).toBe(true);
    expect(await waitFor(() => fresh.frames.some((f) => f.type === "permission.replied" && f.data?.requestID === asked.data!.id))).toBe(true);
    expect(fresh.frames.find((f) => f.type === "permission.replied")!.data).toMatchObject({ sessionID: asked.data!.sessionID, reply: "reject" });
    expect((await (await fetch(`${fresh.base}/api/session/${asked.data!.sessionID}/permission`)).json()).data).toEqual([]);
    expect(await waitFor(() => fresh.frames.some((f) => f.type === "session.execution.interrupted" && f.data?.sessionID === sid), 10_000)).toBe(true);
  } finally {
    await fresh.stop();
  }
}, 60_000);
