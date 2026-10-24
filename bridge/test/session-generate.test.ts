// Side questions (add-session-generate): session.generate answers from a
// throwaway fork of the stored Maki session, leaves the session's own history
// untouched, and deletes the fork from Maki's store
// (server handlers/session.ts v2.0.32 L596–L609; src/cli.rs v0.6.4 L303–L321).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
const trace = join(mkdtempSync(join(tmpdir(), "generate-trace-")), "maki.txt");
beforeAll(async () => {
  // the scripted sandbox's own `maki` (test/sandbox-bin) records the cleanup
  bridge = await startBridge({ FAKE_SANDBOX_MAKI_TRACE: trace, FAKE_SANDBOX_BIN: fileURLToPath(new URL("./sandbox-bin", import.meta.url)) });
});
afterAll(async () => {
  await bridge?.stop();
});

const post = (path: string, body: unknown) =>
  fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a side question is answered without a turn and its fork is removed", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  await post(`/api/session/${sid}/prompt`, { text: "hello" });
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid))).toBe(true);
  const framesBefore = bridge.frames.filter((f) => f.data?.sessionID === sid).length;
  const messagesBefore = (await (await fetch(`${bridge.base}/api/session/${sid}/message`)).json()).data.length;

  const path = `/api/session/${sid}/generate`;
  const res = await post(path, { prompt: "What did you reply?" });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(validateBody(path, "POST", 200, body)).toBeNull();
  expect(body.data.text).toBe("PONG");

  expect(bridge.frames.filter((f) => f.data?.sessionID === sid).length).toBe(framesBefore);
  expect((await (await fetch(`${bridge.base}/api/session/${sid}/message`)).json()).data.length).toBe(messagesBefore);
  expect(await waitFor(() => existsSync(trace), 4_000)).toBe(true);
  expect(readFileSync(trace, "utf8").trim()).toBe("session delete fake-maki-fork --force");

  expect((await post(path, {})).status).toBe(400);
  expect((await post("/api/session/ses_unknown0000000000/generate", { prompt: "x" })).status).toBe(404);
});
