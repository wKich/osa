// Offline coverage for the MCP server list (add-mcp-server-status): the pinned
// child announces `mcp_servers: []` whatever it loaded, so `GET /api/mcp`
// lists the servers in the sandbox's Maki `mcp.toml` files (global, then the
// project's) and derives each one's state from the tools a child advertised.
// The scripted openshell runs the reads with FAKE_SANDBOX_HOME as the sandbox
// user's home; FAKE_MAKI_TOOLS sets the child's advertised tools.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let tmp: string;
let home: string;
let workdir: string;

async function mcp(bridge: BridgeHandle): Promise<any[]> {
  const res = await fetch(`${bridge.base}/api/mcp?location%5Bdirectory%5D=${encodeURIComponent(workdir)}`);
  const body = await res.json();
  expect(validateBody("/api/mcp", "GET", res.status, body)).toBeNull();
  return body.data;
}

async function withSession(env: Record<string, string>, fn: (b: BridgeHandle) => Promise<void>): Promise<void> {
  const bridge = await startBridge({ OPENMAKI_CWD: workdir, FAKE_SANDBOX_HOME: home, ...env });
  try {
    await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: workdir } }),
    });
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated"), 10_000)).toBe(true);
    await fn(bridge);
  } finally {
    await bridge.stop();
  }
}

describe("MCP server list", () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-status-"));
    home = join(tmp, "home");
    workdir = join(tmp, "project");
    mkdirSync(join(home, ".config", "maki"), { recursive: true });
    mkdirSync(join(workdir, ".maki"), { recursive: true });
    writeFileSync(
      join(home, ".config", "maki", "mcp.toml"),
      ['[mcp.context7]', 'url = "https://mcp.context7.com/mcp"', '', '[mcp.github]', 'command = ["github-mcp"]', 'enabled = false', '', '[mcp.docs]', 'url = "https://docs.example/mcp"'].join("\n"),
    );
    // the project re-enables github and adds its own server
    writeFileSync(join(workdir, ".maki", "mcp.toml"), ['[mcp.github]', 'command = ["github-mcp"]', '', '[mcp.local]', 'command = ["local-mcp"]'].join("\n"));
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test("before any child, configured servers are listed as pending", async () => {
    const bridge = await startBridge({ OPENMAKI_CWD: workdir, FAKE_SANDBOX_HOME: home });
    try {
      expect(await mcp(bridge)).toEqual(
        ["context7", "docs", "github", "local"].map((name) => ({ name, status: { status: "pending" } })),
      );
    } finally {
      await bridge.stop();
    }
  });

  test("advertised tools mark a server connected, a missing one failed, a project override wins", async () => {
    await withSession({ FAKE_MAKI_TOOLS: "Bash,context7__resolve-library-id,github__search" }, async (bridge) => {
      const byName = Object.fromEntries((await mcp(bridge)).map((s) => [s.name, s.status]));
      expect(byName).toEqual({
        context7: { status: "connected" },
        github: { status: "connected" },
        docs: { status: "failed", error: "the Maki session advertised no tool from this server" },
        local: { status: "failed", error: "the Maki session advertised no tool from this server" },
      });
    });
  });

  test("a disabled server is disabled, and deferred tools leave the rest pending", async () => {
    writeFileSync(join(workdir, ".maki", "mcp.toml"), ['[mcp.local]', 'command = ["local-mcp"]', 'enabled = false'].join("\n"));
    await withSession({ FAKE_MAKI_TOOLS: "Bash,tool_search,context7__resolve-library-id" }, async (bridge) => {
      const byName = Object.fromEntries((await mcp(bridge)).map((s) => [s.name, s.status]));
      expect(byName).toEqual({
        context7: { status: "connected" },
        docs: { status: "pending" },
        github: { status: "disabled" },
        local: { status: "disabled" },
      });
    });
  });

  test("no config, or no sandbox, is an empty list", async () => {
    const empty = mkdtempSync(join(tmp, "bare-"));
    const bridge = await startBridge({ OPENMAKI_CWD: empty, FAKE_SANDBOX_HOME: empty });
    const none = await startBridge({ OPENMAKI_CWD: workdir, FAKE_SANDBOX_HOME: home, OPENMAKI_SANDBOX: "" });
    try {
      expect(await mcp(bridge)).toEqual([]);
      expect(await mcp(none)).toEqual([]);
    } finally {
      await bridge.stop();
      await none.stop();
    }
  });
});
