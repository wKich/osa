// Sandbox terminals (add-sandbox-terminals): the persistent-PTY routes and
// attach socket the TUI's terminal pane uses (server handlers/persistent-pty.ts
// v2.1.4 L17–L209), with each terminal a shell run by `openshell sandbox exec
// --tty` — here the scripted sandbox, which runs it in the test workdir.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
beforeAll(async () => {
  bridge = await startBridge({ SHELL: "/bin/sh" });
});
afterAll(async () => {
  await bridge?.stop();
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(bridge.base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const frame = (cols: number, rows: number, text?: string) => {
  const data = text === undefined ? new Uint8Array() : new TextEncoder().encode(text);
  const out = new Uint8Array(5 + data.byteLength);
  const view = new DataView(out.buffer);
  out[0] = text === undefined ? 0 : 1;
  view.setUint16(1, cols);
  view.setUint16(3, rows);
  out.set(data, 5);
  return out;
};

test("a terminal opens in the sandbox, streams over its socket, and is removed", async () => {
  const sid = (await (await call("POST", "/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  const listPath = `/api/experimental/session/${sid}/terminal`;
  const created = await (await call("POST", listPath, { args: [], title: "Terminal", env: {}, cwd: "/host/elsewhere" })).json();
  expect(validateBody(listPath, "POST", 200, created)).toBeNull();
  const pty = created.data;
  expect(pty).toMatchObject({ title: "Terminal", status: "running", sessionID: sid, cwd: bridge.workdir, size: { cols: 80, rows: 24 } });
  expect(pty.id).toMatch(/^pty/);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "persistent-pty.added" && f.data?.terminal?.id === pty.id))).toBe(true);
  expect((await (await call("GET", listPath)).json()).data.map((t: any) => t.id)).toEqual([pty.id]);

  expect((await call("POST", `/api/experimental/persistent-pty/${pty.id}/connect-token`)).status).toBe(403);
  const token = await (await call("POST", `/api/experimental/persistent-pty/${pty.id}/connect-token`, undefined, { "x-opencode-ticket": "1" })).json();
  const ws = new WebSocket(`${bridge.base.replace("http", "ws")}/api/experimental/persistent-pty/${pty.id}/connect?ticket=${token.data.ticket}&cursor=0&attachment_id=a1&takeover=true&input_protocol=1`);
  ws.binaryType = "arraybuffer";
  let text = "";
  const json: any[] = [];
  ws.onmessage = (e) => {
    if (typeof e.data === "string") json.push(JSON.parse(e.data));
    else text += new TextDecoder().decode(e.data as ArrayBuffer);
  };
  await new Promise((r) => (ws.onopen = r));
  expect(await waitFor(() => json.some((m) => m.type === "replay_complete"))).toBe(true);
  expect(json[0]).toMatchObject({ type: "attached", attachmentID: "a1", inputProtocol: 1, role: "controller" });
  ws.send(frame(80, 24, "echo terminal-marker-$((40+2))\r"));
  expect(await waitFor(() => text.includes("terminal-marker-42"), 10_000)).toBe(true);

  const snap = await (await call("GET", `/api/experimental/persistent-pty/${pty.id}/snapshot`)).json();
  expect(validateBody(`/api/experimental/persistent-pty/${pty.id}/snapshot`, "GET", 200, snap)).toBeNull();
  expect(Buffer.from(snap.data.checkpoint, "base64").toString()).toContain("terminal-marker-42");
  expect(snap.data.info.output.tail).toBeGreaterThan(0);

  ws.send(frame(100, 30));
  expect(await waitFor(() => json.some((m) => m.type === "resized" && m.cols === 100 && m.rows === 30))).toBe(true);
  expect((await (await call("GET", `/api/experimental/persistent-pty/${pty.id}`)).json()).data.size).toEqual({ cols: 100, rows: 30 });

  expect((await call("DELETE", `/api/experimental/persistent-pty/${pty.id}`)).status).toBe(204);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "persistent-pty.removed" && f.data?.ptyID === pty.id))).toBe(true);
  const gone = await call("GET", `/api/experimental/persistent-pty/${pty.id}`);
  expect(gone.status).toBe(404);
  ws.close();
});

test("a terminal is not created for a session that does not exist", async () => {
  const sid = "ses_noterminal0000000001";
  const path = `/api/experimental/session/${sid}/terminal`;
  const before = bridge.frames.filter((f) => f.type === "persistent-pty.added").length;
  const res = await call("POST", path, { args: [], title: "Terminal", cwd: bridge.workdir });
  expect(res.status).toBe(404);
  expect((await res.json())._tag).toBe("SessionNotFoundError");
  expect((await (await call("GET", path)).json()).data).toEqual([]);
  await Bun.sleep(300);
  expect(bridge.frames.filter((f) => f.type === "persistent-pty.added")).toHaveLength(before);
});
