// Browser requests are refused (fix-audit-findings 2.1): the bridge serves a
// native client, which sends no Origin header, while a page always sends one
// (and `Sec-Fetch-Site: cross-site` for a cross-origin request). The gate runs
// before routing, a body read, or a WebSocket upgrade, so a rejected request
// has no effect: no session, no command, no terminal.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

setDefaultTimeout(30_000);

const FOREIGN = { origin: "https://evil.example" };
const CROSS_SITE = { "sec-fetch-site": "cross-site" };

let bridge: BridgeHandle;
beforeAll(async () => {
  bridge = await startBridge({ SHELL: "/bin/sh" });
});
afterAll(async () => {
  await bridge?.stop();
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(bridge.base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const session = async () => (await (await call("POST", "/api/session", { location: { directory: bridge.workdir } })).json()).data.id as string;

test("a foreign-origin session create is refused with 403 and no body, and creates nothing", async () => {
  const id = "ses_crosssite0000000001";
  for (const headers of [FOREIGN, CROSS_SITE]) {
    const res = await call("POST", "/api/session", { id }, headers);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
    expect((await call("GET", `/api/session/${id}`)).status).toBe(404);
  }
  // a headerless request is served as before
  const ok = await call("POST", "/api/session", { id });
  expect(ok.status).toBe(200);
  expect((await ok.json()).data.id).toBe(id);
  expect((await call("GET", `/api/session/${id}`)).status).toBe(200);
});

test("a foreign-origin shell request runs no command", async () => {
  const sid = await session();
  const marker = join(bridge.workdir, "pwned-marker");
  for (const headers of [FOREIGN, CROSS_SITE]) {
    const res = await call("POST", `/api/session/${sid}/shell`, { command: `touch ${marker}` }, headers);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
  }
  await Bun.sleep(500);
  expect(existsSync(marker)).toBe(false);
  expect(bridge.frames.some((f) => f.type === "session.shell.started" && f.data?.sessionID === sid)).toBe(false);
  // the same request without the header runs
  const ok = join(bridge.workdir, "ok-marker");
  expect((await call("POST", `/api/session/${sid}/shell`, { command: `touch ${ok}` })).status).toBe(204);
  expect(await waitFor(() => existsSync(ok), 10_000)).toBe(true);
});

test("a foreign-origin terminal request creates no terminal", async () => {
  const sid = await session();
  const path = `/api/experimental/session/${sid}/terminal`;
  for (const headers of [FOREIGN, CROSS_SITE]) {
    const res = await call("POST", path, { args: [], title: "Terminal" }, headers);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
  }
  expect((await (await call("GET", path)).json()).data).toEqual([]);
  expect(bridge.frames.some((f) => f.type === "persistent-pty.added" && f.data?.sessionID === sid)).toBe(false);
  const ok = await call("POST", path, { args: [], title: "Terminal" });
  expect(ok.status).toBe(200);
  expect((await (await call("GET", path)).json()).data).toHaveLength(1);
});

test("a foreign-origin socket upgrade and event stream are refused; the ticket stays usable", async () => {
  const sid = await session();
  const path = `/api/experimental/session/${sid}/terminal`;
  const pty = (await (await call("POST", path, { args: [] })).json()).data.id as string;
  const token = (await (await call("POST", `/api/experimental/persistent-pty/${pty}/connect-token`, undefined, { "x-opencode-ticket": "1" })).json()).data.ticket as string;
  const url = `${bridge.base.replace("http", "ws")}/api/experimental/persistent-pty/${pty}/connect?ticket=${token}&cursor=0&attachment_id=a1&takeover=true&input_protocol=1`;

  const refused = await new Promise<{ opened: boolean }>((resolve) => {
    let opened = false;
    const ws = new WebSocket(url, { headers: FOREIGN } as any);
    ws.onopen = () => { opened = true; ws.close(); };
    ws.onerror = () => resolve({ opened });
    ws.onclose = () => resolve({ opened });
  });
  expect(refused.opened).toBe(false);
  // the refused upgrade did not consume the ticket or attach anything
  const attached = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(url);
    ws.onmessage = () => { resolve(true); ws.close(); };
    ws.onerror = () => resolve(false);
  });
  expect(attached).toBe(true);

  expect((await call("GET", "/api/event", undefined, FOREIGN)).status).toBe(403);
});

test("a native request, with no Origin and no cross-site fetch metadata, is served", async () => {
  expect((await call("GET", "/api/session")).status).toBe(200);
  for (const site of ["none", "same-origin", "same-site"]) {
    expect((await call("GET", "/api/session", undefined, { "sec-fetch-site": site })).status).toBe(200);
  }
});
