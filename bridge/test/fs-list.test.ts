// Offline coverage for the workdir listing (fix-fs-list-sandbox): the TUI asks
// to list its own host directory, but the project lives in the sandbox
// workdir, so the bridge must answer from the sandbox over the exec transport
// and never read the host directory the client names. The scripted openshell
// (fake-openshell.ts) runs each read in the bridge's canonical workdir and
// traces its argv; a separate "host" directory holds different files, so a
// host read would show up in the answer.
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

// tests here boot their own bridges; the default 5s budget is too tight on a
// loaded host
setDefaultTimeout(20_000);

describe("workdir listing", () => {
  let bridge: BridgeHandle;
  let sandbox: string;
  let host: string;
  let trace: string;

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), "fs-list-sandbox-"));
    host = mkdtempSync(join(tmpdir(), "fs-list-host-"));
    trace = join(sandbox, "..", `${sandbox.split("/").pop()}.trace`);
    mkdirSync(join(sandbox, "src", "lib"), { recursive: true });
    writeFileSync(join(sandbox, "README.md"), "");
    writeFileSync(join(sandbox, ".gitignore"), "");
    writeFileSync(join(sandbox, "src", "main.ts"), "");
    writeFileSync(join(host, "HOST-ONLY.txt"), "");
    mkdirSync(join(host, "src"));
    writeFileSync(join(host, "src", "host-only.ts"), "");
    bridge = await startBridge({ OPENMAKI_CWD: sandbox, FAKE_OPENSHELL_TRACE: trace });
  });

  afterAll(async () => {
    await bridge?.stop();
    for (const d of [sandbox, host]) rmSync(d, { recursive: true, force: true });
    rmSync(trace, { force: true });
  });

  const list = async (params: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    const res = await fetch(`${bridge.base}/api/fs/list?${q}`);
    const body = await res.json();
    expect(validateBody("/api/fs/list", "GET", res.status, body)).toBeNull();
    return body;
  };

  test("the client's directory is answered with the sandbox workdir's entries", async () => {
    const body = await list({ "location[directory]": host });
    expect(body.location.directory).toBe(host);
    expect(body.data).toEqual([
      { path: ".gitignore", type: "file" },
      { path: "README.md", type: "file" },
      { path: "src", type: "directory" },
    ]);
  });

  test("a relative or client-absolute subpath maps under the workdir", async () => {
    for (const path of ["src", join(host, "src")]) {
      const body = await list({ "location[directory]": host, path });
      expect(body.location.directory).toBe(join(host, "src"));
      expect(body.data).toEqual([
        { path: "lib", type: "directory" },
        { path: "main.ts", type: "file" },
      ]);
    }
  });

  test("a path outside the client's directory lists nothing", async () => {
    for (const path of ["/etc", "../..", tmpdir()]) {
      const body = await list({ "location[directory]": host, path });
      expect(body.data).toEqual([]);
    }
  });

  test("every listing ran through sandbox exec with no --env", () => {
    const calls = readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
    expect(calls.length).toBeGreaterThan(0);
    for (const argv of calls) {
      expect(argv.slice(0, 6)).toEqual(["sandbox", "exec", "-n", "fake-sandbox", "--no-login-shell", "--workdir"]);
      expect(argv[6]).toBe(sandbox);
      expect(argv.filter((a) => a.startsWith("--env"))).toEqual([]);
      // the host directory never reaches the read
      expect(argv.some((a) => a.startsWith(host))).toBe(false);
    }
  });

  test("without a sandbox the listing is empty, never the host's", async () => {
    const bare = await startBridge({ OPENMAKI_CWD: sandbox, OPENMAKI_SANDBOX: "" });
    try {
      const res = await fetch(`${bare.base}/api/fs/list?${new URLSearchParams({ "location[directory]": host })}`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual([]);
    } finally {
      await bare.stop();
    }
  });
});
