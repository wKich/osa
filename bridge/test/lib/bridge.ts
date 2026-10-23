// Black-box bridge process for the tests (design decision 1): spawn the
// shipped entrypoint with the scripted child seam and parse the listen line
// exactly the way bin/maki-oss's wait_for_bridge_port does. One process per
// test file, torn down in afterAll.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE_DIR = fileURLToPath(new URL("../..", import.meta.url)); // bridge/
const BRIDGE_ENTRY = join(BRIDGE_DIR, "src", "bridge.ts");
const FAKE_CHILD = fileURLToPath(new URL("../fake-maki.ts", import.meta.url));
// sandbox reads (bridge/src/sandbox.ts) go through a scripted openshell that
// runs them in the workdir, the way the fake child runs its tool calls
const FAKE_OPENSHELL = fileURLToPath(new URL("../fake-openshell.ts", import.meta.url));
// the real git binary's dir for the scripted sandbox (see fake-openshell.ts)
const GIT_DIR = (() => {
  const real = process.platform === "darwin" ? Bun.spawnSync(["xcrun", "-f", "git"]).stdout.toString().trim() : "";
  const git = real || Bun.which("git") || "";
  return git.slice(0, git.lastIndexOf("/"));
})();

/** one emitted OpenCode envelope: {id, created, type, durable?, data} */
export interface Frame {
  id?: string;
  created?: number;
  type?: string;
  durable?: { aggregateID?: string; seq?: number; version?: number };
  data?: Record<string, any>;
  [key: string]: any;
}

export interface BridgeHandle {
  base: string;
  port: number;
  /** bridge process id (child teardown checks hang off it) */
  pid: number;
  workdir: string;
  logPath: string;
  /** every frame seen on the SSE subscriber, envelopes in arrival order */
  frames: Frame[];
  /** raw bytes the subscriber received (the true wire) */
  rawSse: () => string;
  /** parsed BRIDGE_LOG entries (requests the bridge served) */
  requests: () => Record<string, any>[];
  stderr: () => string;
  stop: () => Promise<void>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** poll until pred() is true; resolves false on timeout */
export async function waitFor(pred: () => boolean, ms = 30_000, step = 100): Promise<boolean> {
  for (let waited = 0; waited < ms && !pred(); waited += step) await sleep(step);
  return pred();
}

export async function startBridge(extraEnv: Record<string, string> = {}): Promise<BridgeHandle> {
  const workdir = mkdtempSync(join(tmpdir(), "maki-oss-bridge-test-"));
  const logPath = join(workdir, "requests.jsonl");
  const proc = Bun.spawn([process.execPath, BRIDGE_ENTRY], {
    cwd: BRIDGE_DIR,
    env: {
      ...process.env,
      PORT: "0",
      OPENMAKI_CWD: workdir,
      MAKI_CHILD_CMD: FAKE_CHILD,
      OPENSHELL_BIN: FAKE_OPENSHELL,
      OPENMAKI_SANDBOX: "fake-sandbox",
      // the sandbox user's home is the temp workdir, never the host's
      FAKE_SANDBOX_HOME: workdir,
      FAKE_SANDBOX_GIT_DIR: GIT_DIR,
      BRIDGE_LOG: logPath,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let out = "";
  let err = "";
  let listenPort = 0;
  const stdoutDone = (async () => {
    const dec = new TextDecoder();
    for await (const chunk of proc.stdout) {
      out += dec.decode(chunk, { stream: true });
      if (!listenPort) {
        const m = /bridge listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
        if (m) listenPort = Number(m[1]);
      }
    }
  })();
  const stderrDone = (async () => {
    const dec = new TextDecoder();
    for await (const chunk of proc.stderr) err += dec.decode(chunk, { stream: true });
  })();

  // same budget as the helper's wait_for_bridge_port, with a little headroom
  const booted = await waitFor(() => listenPort > 0, 12_000);
  if (!booted) {
    proc.kill("SIGKILL");
    throw new Error(`bridge did not print a listen line within 12s\nstdout:\n${out}\nstderr:\n${err}`);
  }

  const base = `http://127.0.0.1:${listenPort}`;
  const frames: Frame[] = [];
  let raw = "";
  const sse = await fetch(`${base}/api/event`);
  if (!sse.ok || !sse.body) throw new Error(`event stream subscribe failed: ${sse.status}`);
  const reader = sse.body.getReader();
  const streamDone = (async () => {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        buf += text;
        raw += text;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (line) frames.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {
      /* stream closed on teardown */
    }
  })();

  let stopped = false;
  const handle: BridgeHandle = {
    base,
    port: listenPort,
    pid: proc.pid,
    workdir,
    logPath,
    frames,
    rawSse: () => raw,
    requests: () => {
      if (!existsSync(logPath)) return [];
      return readFileSync(logPath, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    },
    stderr: () => err,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      proc.kill("SIGTERM");
      await Promise.race([proc.exited, sleep(5000).then(() => proc.kill("SIGKILL"))]);
      await Promise.race([streamDone, stdoutDone, stderrDone, sleep(2000)]);
      rmSync(workdir, { recursive: true, force: true });
    },
  };
  return handle;
}

