// Held prompts (add-held-inbox): a prompt admitted while a turn runs waits in
// the bridge and is written to the child only when its turn starts, so the
// TUI can list it (session.inbox.list), cancel it before the child sees it
// (session.inbox.cancel), and keep it queued (session.inbox.update); steering
// it into the running turn is the pinned conflict, since the child cannot take
// a prompt mid-run (server handlers/session.ts v2.0.32 L542–L571).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
let trace: string;
beforeAll(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  trace = join(mkdtempSync(join(tmpdir(), "inbox-trace-")), "child-trace.jsonl");
  bridge = await startBridge({ FAKE_MAKI_TRACE: trace });
});
afterAll(async () => {
  await bridge?.stop();
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(bridge.base + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const childPrompts = () =>
  existsSync(trace)
    ? readFileSync(trace, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((f) => f.type === "user").map((f) => f.message.content[0].text)
    : [];

test("a queued prompt is listed, cancelled before the child sees it, and the next one still runs", async () => {
  const sid = (await (await call("POST", "/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  const done = () => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid).length;
  await call("POST", `/api/session/${sid}/prompt`, { text: "run exactly: sleep 2 ." });
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.started" && f.data?.sessionID === sid))).toBe(true);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated" && f.data?.sessionID === sid))).toBe(true);
  await call("POST", `/api/session/${sid}/prompt`, { id: "msg_inbox0000000000000001", text: "first queued", delivery: "queue" });
  await call("POST", `/api/session/${sid}/prompt`, { id: "msg_inbox0000000000000002", text: "second queued", delivery: "queue" });

  const listPath = `/api/session/${sid}/inbox`;
  const listed = await (await call("GET", listPath)).json();
  expect(validateBody(listPath, "GET", 200, listed)).toBeNull();
  expect(listed.data.map((i: any) => [i.id, i.payload.text, i.delivery])).toEqual([
    ["msg_inbox0000000000000001", "first queued", "queue"],
    ["msg_inbox0000000000000002", "second queued", "queue"],
  ]);
  expect(await waitFor(() => childPrompts().length === 1)).toBe(true);
  expect(childPrompts()).toEqual(["run exactly: sleep 2 ."]);

  const item = `/api/session/${sid}/inbox/msg_inbox0000000000000001`;
  expect((await call("PATCH", item, { delivery: "queue" })).status).toBe(204);
  const steer = await call("PATCH", item, { delivery: "steer" });
  expect(steer.status).toBe(409);
  expect(validateBody(item, "PATCH", 409, await steer.json())).toBeNull();
  expect((await call("DELETE", item)).status).toBe(204);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.inbox.cancelled" && f.data?.inboxID === "msg_inbox0000000000000001"))).toBe(true);
  expect((await call("DELETE", item)).status).toBe(204);

  expect(await waitFor(() => done() === 2, 20_000)).toBe(true);
  expect(childPrompts()).toEqual(["run exactly: sleep 2 .", "second queued"]);
  expect((await (await call("GET", listPath)).json()).data).toEqual([]);
});
