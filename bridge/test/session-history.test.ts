// Session message history (add-session-message-history): a reopened TUI reads
// the transcript from `GET /api/session/{sessionID}/message`, which the bridge
// projects from the frames it emitted, paged as the real handler pages
// (server/src/handlers/message.ts v2.1.4 L9–L65).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
let sid: string;
beforeAll(async () => {
  bridge = await startBridge();
  sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  const done = () => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid).length;
  await post(`/api/session/${sid}/prompt`, { text: "hello" });
  expect(await waitFor(() => done() === 1)).toBe(true);
  await post(`/api/session/${sid}/prompt`, { text: "run exactly: true ." });
  expect(await waitFor(() => done() === 2)).toBe(true);
});
afterAll(async () => {
  await bridge?.stop();
});

function post(path: string, body: unknown) {
  return fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function page(query: string) {
  const path = `/api/session/${sid}/message`;
  const res = await fetch(`${bridge.base}${path}${query}`);
  const body = await res.json();
  expect(validateBody(path, "GET", res.status, body)).toBeNull();
  return { status: res.status, body };
}

test("the transcript reads back oldest-first as user, assistant, idle per turn", async () => {
  const { status, body } = await page("?order=asc");
  expect(status).toBe(200);
  expect(body.data.map((m: any) => m.type)).toEqual(["user", "assistant", "idle", "user", "assistant", "idle"]);
  const [user, assistant, idle] = body.data;
  expect(user.text).toBe("hello");
  expect(assistant.content).toEqual([{ type: "text", text: "PONG" }]);
  expect(assistant.finish).toBe("stop");
  expect(assistant.time.completed).toBeGreaterThanOrEqual(assistant.time.created);
  expect(idle.outcome).toBe("succeeded");
  const tool = body.data[4].content.find((p: any) => p.type === "tool");
  expect(tool).toMatchObject({ name: "bash", executed: false, state: { status: "completed", input: { command: "true" } } });
});

test("the default page is newest first and the cursor walks on", async () => {
  const first = await page("?limit=2");
  expect(first.body.data.map((m: any) => m.type)).toEqual(["idle", "assistant"]);
  const next = await page(`?limit=2&cursor=${first.body.cursor.next}`);
  expect(next.body.data.map((m: any) => m.type)).toEqual(["user", "idle"]);
  expect((await page(`?cursor=${first.body.cursor.next}&order=asc`)).status).toBe(400);
  expect((await page("?cursor=not-a-cursor")).status).toBe(400);
  expect((await page("?type=user")).body.data.map((m: any) => m.text)).toEqual(["run exactly: true .", "hello"]);
});

test("export answers the session and its settled transcript, and sanitize redacts content", async () => {
  const path = `/api/experimental/session/${sid}/export`;
  const res = await fetch(bridge.base + path);
  const body = await res.json();
  expect(validateBody(path, "GET", res.status, body)).toBeNull();
  expect(body.data.info.id).toBe(sid);
  expect(body.data.messages.map((m: any) => m.type)).toEqual(["user", "assistant", "idle", "user", "assistant", "idle"]);
  expect(body.data.messages[0].text).toBe("hello");

  const red = await (await fetch(`${bridge.base}${path}?sanitize=true`)).json();
  expect(validateBody(path, "GET", 200, red)).toBeNull();
  const user = red.data.messages[0];
  expect(user.text).toBe(`[redacted:text:${user.id}]`);
  const assistant = red.data.messages[1];
  expect(assistant.content[0].text).toBe(`[redacted:text:${assistant.id}]`);
  expect(red.data.info.location.directory).toBe(`/[redacted:session-directory:${sid}]`);
  expect(JSON.stringify(red)).not.toContain("hello");
  expect((await fetch(`${bridge.base}/api/experimental/session/ses_unknown0000000000/export`)).status).toBe(404);
});
