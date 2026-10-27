// Bounded replay and session cleanup (fix-audit-findings 4.1, 4.2): the SSE
// replay a reconnecting client receives keeps only the newest frames within a
// frame-count and a byte bound, and deleting a session releases what it held —
// its replay frames and its terminals.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

setDefaultTimeout(30_000);

const call = (b: BridgeHandle, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(b.base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const createSession = async (b: BridgeHandle) =>
  (await (await call(b, "POST", "/api/session", { location: { directory: b.workdir } })).json()).data.id as string;

/** what a fresh subscriber is sent on connect: the `data:` payloads, up to a quiet moment */
async function replay(b: BridgeHandle): Promise<{ json: string; frame: any }[]> {
  const res = await fetch(`${b.base}/api/event`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const next = await Promise.race([reader.read(), Bun.sleep(400).then(() => null)]);
    if (!next || next.done) break;
    text += dec.decode(next.value, { stream: true });
  }
  await reader.cancel();
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => ({ json: block.slice(6), frame: JSON.parse(block.slice(6)) }))
    .filter((f) => f.frame.type !== "server.connected");
}

/** wait until the live subscriber has stopped receiving frames */
async function settled(b: BridgeHandle): Promise<void> {
  let seen = -1;
  await waitFor(() => {
    const stable = b.frames.length === seen;
    seen = b.frames.length;
    return stable;
  }, 10_000, 300);
}

describe("replay bounds", () => {
  const bridges: BridgeHandle[] = [];
  afterAll(async () => {
    for (const b of bridges) await b.stop();
  });

  async function emitMetadata(b: BridgeHandle, count: number, pad = 0): Promise<void> {
    const sid = await createSession(b);
    for (let i = 0; i < count; i++) {
      const res = await call(b, "PATCH", `/api/session/${sid}`, { metadata: { n: i, pad: "x".repeat(pad) } });
      expect(res.status).toBe(204);
    }
    await settled(b);
  }

  test("more frames than the bound replay only the newest frames", async () => {
    const b = await startBridge({ SSE_REPLAY_MAX_FRAMES: "25" });
    bridges.push(b);
    await emitMetadata(b, 60);
    const live = b.frames.filter((f) => f.type !== "server.connected");
    expect(live.length).toBeGreaterThan(60);
    const retained = await replay(b);
    expect(retained).toHaveLength(25);
    // the retained frames are the newest, in order
    expect(retained.map((f) => f.frame.id)).toEqual(live.slice(-25).map((f) => f.id));
  });

  test("the retained frames stay within the byte bound", async () => {
    const limit = 8_000;
    const b = await startBridge({ SSE_REPLAY_MAX_BYTES: String(limit) });
    bridges.push(b);
    await emitMetadata(b, 40, 400);
    const live = b.frames.filter((f) => f.type !== "server.connected");
    const retained = await replay(b);
    const bytes = retained.reduce((n, f) => n + Buffer.byteLength(f.json), 0);
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.length).toBeLessThan(live.length);
    expect(bytes).toBeLessThanOrEqual(limit);
    expect(retained.at(-1)!.frame.id).toBe(live.at(-1)!.id);
  });

  test("under the bounds every frame is still replayed", async () => {
    const b = await startBridge();
    bridges.push(b);
    await emitMetadata(b, 5);
    const live = b.frames.filter((f) => f.type !== "server.connected");
    expect((await replay(b)).map((f) => f.frame.id)).toEqual(live.map((f) => f.id));
  });
});

describe("session deletion", () => {
  test("deleting a session removes its terminals and replay frames, and leaves other sessions' alone", async () => {
    const b = await startBridge({ SHELL: "/bin/sh" });
    try {
      const keep = await createSession(b);
      const sid = await createSession(b);
      await call(b, "PATCH", `/api/session/${sid}`, { metadata: { doomed: true } });
      await call(b, "PATCH", `/api/session/${keep}`, { metadata: { kept: true } });
      const created = await (await call(b, "POST", `/api/experimental/session/${sid}/terminal`, { args: [], title: "Terminal" })).json();
      const pty = created.data as { id: string };
      expect(await waitFor(() => b.frames.some((f) => f.type === "persistent-pty.added" && f.data?.sessionID === sid))).toBe(true);
      expect((await call(b, "GET", `/api/experimental/persistent-pty/${pty.id}/snapshot`)).status).toBe(200);
      expect((await replay(b)).some((f) => f.frame.data?.sessionID === sid)).toBe(true);

      expect((await call(b, "DELETE", `/api/session/${sid}`)).status).toBe(204);
      expect(await waitFor(() => b.frames.some((f) => f.type === "session.deleted" && f.data?.sessionID === sid))).toBe(true);

      // the terminal is gone: its snapshot and info are 404
      expect((await call(b, "GET", `/api/experimental/persistent-pty/${pty.id}/snapshot`)).status).toBe(404);
      expect((await call(b, "GET", `/api/experimental/persistent-pty/${pty.id}`)).status).toBe(404);
      expect((await (await call(b, "GET", `/api/experimental/session/${sid}/terminal`)).json()).data).toEqual([]);
      // and no ticket can attach to it
      const token = await call(b, "POST", `/api/experimental/persistent-pty/${pty.id}/connect-token`, undefined, { "x-opencode-ticket": "1" });
      expect(token.status).toBe(404);

      // no frame of the session is replayed; the other session's still are
      const retained = await replay(b);
      expect(retained.filter((f) => f.frame.data?.sessionID === sid)).toEqual([]);
      expect(retained.some((f) => f.frame.data?.sessionID === keep)).toBe(true);
    } finally {
      await b.stop();
    }
  });
});
