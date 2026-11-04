// oskhs against the real helper core: ensureSandbox and runMaki call
// bin/maki-oss, which talks to the stub openshell (tests/stub). The recorder
// tests pin oskhs's argv; this pins that the core accepts it round after
// round from different directories and keeps no session state for it.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnRunner, type Runner } from "../src/exec.ts";
import type { Ctx } from "../src/openshell.ts";
import { runMaki, type RoundSpec } from "../src/round.ts";
import { ensureSandbox } from "../src/sandbox.ts";
import { answerLine } from "./fake.ts";

const root = resolve(import.meta.dir, "../..");
const stubDir = join(root, "tests/stub");

// The core reads the sandbox through the typed client, so the suite needs a
// gateway process as well as the CLI stub. It shares the case's state root and
// reports the address the stub CLI hands back from `gateway info`.
async function startGateway(stateDir: string): Promise<{ server: string; stop: () => void }> {
  const bin = join(root, "osa-core/target/release/stub-gateway");
  const proc = Bun.spawn([bin], {
    // The helper execs through the typed client now, so the answer fixture
    // reaches the gateway, not the CLI stub.
    env: {
      ...process.env,
      STUB_STATE_DIR: stateDir,
      STUB_GATEWAY_PORT: "0",
      STUB_EXEC_STDOUT: answerLine,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  const server = text.match(/stub-gateway listening on (\S+)/)?.[1];
  if (!server) {
    proc.kill();
    throw new Error(`stub gateway did not start: ${text}`);
  }
  return { server, stop: () => proc.kill() };
}

function stubCtx(base: string, gatewayServer: string): Ctx {
  const env = {
    PATH: `${stubDir}:${process.env.PATH}`,
    HOME: join(base, "home"),
    XDG_CONFIG_HOME: join(base, "home/.config"),
    XDG_STATE_HOME: "",
    STUB_LOG: join(base, "stub.log"),
    STUB_STATE_DIR: join(base, "state"),
    STUB_GATEWAY_SERVER: gatewayServer,
    STUB_EXEC_STDOUT: answerLine,
    STUB_PROVIDER_NAMES: "oskhs-app",
  };
  // the stub reads its state from the environment, like the gateway would
  const run: Runner = (argv, opts = {}) => spawnRunner(argv, { ...opts, env: { ...env, ...opts.env } });
  return { run, openshell: join(stubDir, "openshell"), makiOss: join(root, "bin/maki-oss"), log: () => {} };
}

const spec = (taskId: string): RoundSpec => ({
  sandbox: "repo-app",
  providers: ["oskhs-app"],
  taskId,
  repos: [],
  prompt: "q",
  timeoutSec: 30,
  collect: false,
});

describe("against the helper core", () => {
  test("consecutive rounds from fresh directories reach the agent and leave no session state", async () => {
    const base = mkdtempSync(join(tmpdir(), "oskhs-core-"));
    let gateway: { server: string; stop: () => void } | undefined;
    try {
      mkdirSync(join(base, "home"), { recursive: true });
      mkdirSync(join(base, "state"), { recursive: true });
      // The typed client asks the gateway for provider names; mirror the
      // fixture the CLI stub sees so both transports know the provider.
      writeFileSync(join(base, "state/providers.list"), "oskhs-app\n");
      gateway = await startGateway(join(base, "state"));
      const ctx = stubCtx(base, gateway.server);
      await ensureSandbox(ctx, { sandbox: "repo-app", providers: ["oskhs-app"] }, 10_000);
      for (const id of ["t1", "t2", "t3"]) {
        const result = await runMaki(ctx, spec(id), `/sandbox/tasks/${id}`);
        expect(result).toMatchObject({ kind: "answer", text: "PELICAN", sessionId: "S1" });
      }
      const osa = join(base, "home/.local/state/osa");
      expect(existsSync(join(osa, "projects/repo-app.toml"))).toBe(false);
      const session = join(osa, "sessions/repo-app");
      for (const f of ["pending", "synced", "baseline"]) expect(existsSync(join(session, f))).toBe(false);
      const log = await Bun.file(join(base, "stub.log")).text();
      expect(log).not.toContain("maki-oss-git");
      expect(log).not.toContain("upload");
      expect(log).not.toContain("agent_policy_proposals_enabled");
      expect(readdirSync(join(base, "state/sandboxes"))).toEqual(["repo-app"]);
    } finally {
      gateway?.stop();
      rmSync(base, { recursive: true, force: true });
    }
  }, 60_000);
});
