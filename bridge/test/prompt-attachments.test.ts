// Prompt-attachment forwarding over the black-box bridge (spec "Forward image
// attachments to the Maki child"): a `files[]` image data URI becomes a base64
// image block on the child's inbound `user` frame (sdk_mode.rs v0.6.4 L688,
// L807–L816; media types per maki-providers types.rs L30–L35) and is reported
// as an inline file on the admitted prompt and its inbox item. What the pinned
// wire cannot carry (PDF and other data URIs) and what the bridge must not read
// (host `file://` paths) is not forwarded. One spawned bridge with the scripted
// child on MAKI_CHILD_CMD; no Docker, gateway, network, or real Maki process.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const tracePath = join(tmpdir(), `maki-oss-prompt-attachments-trace-${process.pid}.jsonl`);
// a 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PDF = Buffer.from("%PDF-1.4 not forwarded").toString("base64");
const FILE_URI = "file:///tmp/maki-oss-prompt-attachments-secret.txt";
const PROMPT_TEXT = "What is in this image?";

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
const inbox = (b: BridgeHandle, id: string) =>
  b.frames.filter((frame) => frame.type === "session.inbox.enqueued" && frame.data?.inboxID === id);
/** the child's inbound `user` frame for one prompt text */
const userFrame = (text: string) =>
  inboundFrames().filter((f) => f.type === "user" && f.message?.content?.some((p: any) => p?.type === "text" && p.text === text));

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

  async function send(id: string, text: string, files?: unknown[]) {
    const done = succeeded(bridge);
    const res = await post(bridge, `/api/session/${sid}/prompt`, { id, text, ...(files ? { files } : {}), delivery: "steer" });
    expect(res.status).toBe(200);
    expect(await waitFor(() => inbox(bridge, id).length === 1, 10_000)).toBe(true);
    expect(await waitFor(() => succeeded(bridge) > done, 30_000)).toBe(true);
    expect(await waitFor(() => userFrame(text).length === 1, 5_000)).toBe(true);
    return res;
  }

  test("an image data URI reaches the child as a base64 image block", async () => {
    const id = "msg_promptattach0000001";
    const res = await send(id, PROMPT_TEXT, [
      { uri: `data:image/png;base64,${PNG}`, name: "cat.png" },
      { uri: `data:application/pdf;base64,${PDF}`, name: "doc.pdf" },
      { uri: FILE_URI, name: "secret.txt" },
    ]);

    // only what was delivered is reported, as the pinned inline file shape
    const delivered = { text: PROMPT_TEXT, files: [{ data: PNG, mime: "image/png", source: { type: "inline" }, name: "cat.png" }] };
    expect(res.json?.data).toMatchObject({ id, sessionID: sid, type: "user", delivery: "steer" });
    expect(res.json?.data?.payload).toEqual(delivered);
    expect(inbox(bridge, id)[0]!.data?.item).toEqual({ type: "user", payload: delivered, delivery: "steer" });

    // the wire half: the text block, then the image block Maki decodes
    const [frame] = userFrame(PROMPT_TEXT);
    expect(frame.message.content).toEqual([
      { type: "text", text: PROMPT_TEXT },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
    ]);
    // the PDF has no block on the pinned wire, and no host file is read
    const wire = JSON.stringify(inboundFrames());
    expect(wire).not.toContain(PDF);
    expect(wire).not.toContain(FILE_URI);
    expect(wire).not.toContain("secret.txt");
  }, 60_000);

  test("unsupported or malformed image URIs are dropped, never forwarded raw", async () => {
    const text = "Describe these.";
    const res = await send("msg_promptattach0000002", text, [
      { uri: `data:image/bmp;base64,${PNG}` },
      { uri: "data:image/png;base64,not base64!" },
      { uri: `data:image/png,${PNG}` },
      { name: "no-uri.png" },
    ]);
    expect(res.json?.data?.payload).toEqual({ text });
    expect(userFrame(text)[0].message.content).toEqual([{ type: "text", text }]);
  }, 60_000);

  test("a mentioned project path is read in the sandbox and attached as OpenCode attaches it", async () => {
    mkdirSync(join(bridge.workdir, "notes"), { recursive: true });
    writeFileSync(join(bridge.workdir, "notes.txt"), "alpha\nbeta\ngamma\n");
    writeFileSync(join(bridge.workdir, "notes", "a.md"), "");
    mkdirSync(join(bridge.workdir, "notes", "sub"), { recursive: true });
    const text = "Summarize @notes.txt#2 @notes";
    const fileUri = `${pathToFileURL(join(bridge.workdir, "notes.txt")).href}?start=2&end=2`;
    const dirUri = pathToFileURL(join(bridge.workdir, "notes")).href;
    const res = await send("msg_promptattach0000004", text, [
      { uri: fileUri, name: "notes.txt#2", mention: { start: 10, end: 22, text: "@notes.txt#2" } },
      { uri: dirUri, name: "notes/" },
      { uri: "file:///etc/hosts", name: "hosts" },
    ]);
    const beta = Buffer.from("beta").toString("base64");
    expect(res.json?.data?.payload).toEqual({
      text,
      files: [
        { data: beta, mime: "text/plain", source: { type: "uri", uri: fileUri }, name: "notes.txt#2", mention: { start: 10, end: 22, text: "@notes.txt#2" } },
        { data: Buffer.from("sub/\na.md").toString("base64"), mime: "application/x-directory", source: { type: "uri", uri: dirUri }, name: "notes/" },
      ],
    });
    expect(userFrame(text)[0].message.content).toEqual([
      { type: "text", text },
      { type: "text", text: "\n\nAttached file: notes.txt#2\n\nbeta" },
      { type: "text", text: `\n\nAttached directory: ${join(bridge.workdir, "notes")}\n\nsub/\na.md` },
    ]);
    // a path outside the client's directory is never read
    expect(JSON.stringify(inboundFrames())).not.toContain("localhost");
  }, 60_000);

  test("a prompt without files keeps the text-only payload and frame", async () => {
    const text = "plain prompt";
    const res = await send("msg_promptattach0000003", text);
    expect(res.json?.data?.payload).toEqual({ text });
    expect(inbox(bridge, "msg_promptattach0000003")[0]!.data?.item?.payload).toEqual({ text });
    expect(userFrame(text)[0].message.content).toEqual([{ type: "text", text }]);
  }, 60_000);

  test("an unknown session is not a silent success", async () => {
    const unknown = "ses_promptattachunknown01";
    const before = inboundFrames().length;
    const res = await post(bridge, `/api/session/${unknown}/prompt`, {
      text: PROMPT_TEXT,
      files: [{ uri: `data:image/png;base64,${PNG}`, name: "cat.png" }],
      delivery: "steer",
    });
    expect(res.status).toBe(404);
    expect(res.json?._tag).toBe("SessionNotFoundError");
    expect(inboundFrames().length).toBe(before);
  }, 30_000);
});
