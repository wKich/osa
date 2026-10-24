// Offline coverage for the boot surface the TUI reads before any turn
// (fix-boot-surface-truth): the server info names the bridge itself and
// offers the sandbox's persistent terminals, and the list routes with nothing behind them
// answer empty, contract-valid bodies instead of synthesized `sample` rows the
// TUI would render as a connected MCP server, a running shell, an active
// plugin, a reference alias, or a runnable command. Drives the shipped
// entrypoint over the MAKI_CHILD_CMD seam; no Docker, gateway, or network.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";
import { MAKI_BUILTIN_PLUGINS } from "../src/spec-answers.ts";

async function get(bridge: BridgeHandle, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(bridge.base + path);
  return { status: res.status, body: await res.json() };
}

describe("boot surface", () => {
  let bridge: BridgeHandle;
  let loc: string;

  beforeAll(async () => {
    bridge = await startBridge();
    loc = `?location%5Bdirectory%5D=${encodeURIComponent(bridge.workdir)}`;
  });

  afterAll(async () => {
    await bridge?.stop();
  });

  test("server info describes the bridge process and offers sandbox terminals", async () => {
    const { status, body } = await get(bridge, "/api/info");
    expect(status).toBe(200);
    expect(validateBody("/api/info", "GET", status, body)).toBeNull();
    expect(body.version).toBe("2.0.32");
    expect(body.pid).toBe(bridge.pid);
    expect(new URL(body.urls[0]).port).toBe(String(bridge.port));
    expect(body.paths.tmp.startsWith("/")).toBe(true);
    // the bridge serves persistent terminals in the sandbox (add-sandbox-terminals)
    expect(body.capabilities).toEqual({ persistentPty: true });
  });

  test("the agent list is Maki's build and plan modes, build first", async () => {
    const { status, body } = await get(bridge, `/api/agent${loc}`);
    expect(validateBody("/api/agent", "GET", status, body)).toBeNull();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ id: "build", name: "build", mode: "primary", hidden: false, permissions: [] });
    expect(body.data[1]).toMatchObject({ id: "plan", name: "plan", mode: "primary", hidden: false, permissions: [] });
  });

  test("the plugin list is Maki's builtin plugins, each an active builtin", async () => {
    const { status, body } = await get(bridge, `/api/plugin${loc}`);
    expect(validateBody("/api/plugin", "GET", status, body)).toBeNull();
    expect(body.data.map((p: any) => p.id)).toEqual(MAKI_BUILTIN_PLUGINS);
    expect(body.data[0]).toEqual({ id: "bash", source: { type: "builtin" }, features: { server: true }, state: { status: "active" } });
  });

  test("reference, shell, command and MCP lists carry no fabricated rows", async () => {
    for (const path of ["/api/reference", "/api/shell", "/api/command", "/api/mcp"]) {
      const { status, body } = await get(bridge, path + loc);
      expect(status).toBe(200);
      expect(validateBody(path, "GET", status, body)).toBeNull();
      expect({ path, data: body.data }).toEqual({ path, data: [] });
    }
    const { status, body } = await get(bridge, `/api/mcp/resource${loc}`);
    expect(validateBody("/api/mcp/resource", "GET", status, body)).toBeNull();
    expect(body.data).toEqual({ resources: [], templates: [] });
  });

  test("a session's persistent terminal list is empty", async () => {
    const created = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    const sid = (await created.json()).data.id;
    const path = `/api/experimental/session/${sid}/terminal`;
    const { status, body } = await get(bridge, path);
    expect(status).toBe(200);
    expect(validateBody(path, "GET", status, body)).toBeNull();
    expect(body.data).toEqual([]);
  });
});
