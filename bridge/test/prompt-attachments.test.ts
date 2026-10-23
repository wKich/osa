// Prompt-attachment coverage over the black-box bridge (spec "Accept prompt
// attachments without claiming they were delivered"): the TUI's `files[]` body
// is admitted, the response and inbox item carry only the text, and the Maki
// child receives only the text block — no image block, no attachment URI. One
// spawned bridge with the scripted child on MAKI_CHILD_CMD; no Docker, gateway,
// network, or real Maki process.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const tracePath = join(tmpdir(), `maki-oss-prompt-attachments-trace-${process.pid}.jsonl`);
const ATTACHMENT_URI = "file:///tmp/cat.png";
const PROMPT_TEXT = "What is in this image?";
const USER_MSG_ID = "msg_promptattach0000001";

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

const succeeded = (b: BridgeHandle) => b.frames.filter((f) => f.type === "session.execution.succeeded").length;

describe("prompt attachments over the spawned bridge", () => {
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
    // the child announces itself asynchronously; the prompt can still be sent,
    // but waiting keeps the first inbound frame deterministic for the trace
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated" && f.data?.sessionID === sid), 10_000)).toBe(true);
  });

  afterAll(async () => {
    await bridge?.stop();
    rmSync(tracePath, { force: true });
  });

  test("an attachment-bearing prompt is admitted with text only", async () => {
    const done = succeeded(bridge);
    const res = await post(bridge, `/api/session/${sid}/prompt`, {
      id: USER_MSG_ID,
      text: PROMPT_TEXT,
      files: [{ uri: ATTACHMENT_URI, name: "cat.png" }],
      delivery: "steer",
    });

    expect(res.status).toBe(200);
    expect(res.json?.data).toMatchObject({
      id: USER_MSG_ID,
      sessionID: sid,
      type: "user",
      payload: { text: PROMPT_TEXT },
      delivery: "steer",
    });
    // the route accepted the field but does not report it as delivered
    expect(res.json?.data?.payload).toEqual({ text: PROMPT_TEXT });

    const inbox = (f: BridgeHandle) =>
      f.frames.filter((frame) => frame.type === "session.inbox.enqueued" && frame.data?.inboxID === USER_MSG_ID);
    expect(await waitFor(() => inbox(bridge).length === 1, 10_000)).toBe(true);
    expect(inbox(bridge)[0]!.data?.item).toEqual({
      type: "user",
      payload: { text: PROMPT_TEXT },
      delivery: "steer",
    });

    expect(await waitFor(() => succeeded(bridge) > done, 30_000)).toBe(true);

    // the wire half: one text block, nothing the attachment could ride on
    const inbound = inboundFrames();
    const userFrames = inbound.filter(
      (frame) => frame.type === "user" && frame.message?.content?.some((part: any) => part?.type === "text" && part.text === PROMPT_TEXT),
    );
    expect(userFrames).toHaveLength(1);
    expect(userFrames[0]!.message.content).toEqual([{ type: "text", text: PROMPT_TEXT }]);
    expect(userFrames[0]!.message.content.some((part: any) => part?.type === "image")).toBe(false);
    expect(JSON.stringify(inbound)).not.toContain(ATTACHMENT_URI);
  }, 60_000);

  test("an unknown session is not a silent success", async () => {
    const unknown = "ses_promptattachunknown01";
    const before = inboundFrames().length;
    const res = await post(bridge, `/api/session/${unknown}/prompt`, {
      text: PROMPT_TEXT,
      files: [{ uri: ATTACHMENT_URI, name: "cat.png" }],
      delivery: "steer",
    });
    expect(res.status).toBe(404);
    expect(res.json?._tag).toBe("SessionNotFoundError");
    expect(inboundFrames().length).toBe(before);
  }, 30_000);
});
