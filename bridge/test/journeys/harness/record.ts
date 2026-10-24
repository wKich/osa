#!/usr/bin/env bun
// Journey recording entry point (design decisions 2–4, 8). For every
// directory with a script.ts it runs the real OpenCode TUI against a loopback
// scripted provider, then the same TUI against the bridge with fake-maki
// playing the same turns, renders each checkpoint, normalizes both sides,
// compares them, and updates the journey catalog.
//
//   bun bridge/test/journeys/harness/record.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Journey } from "./journey.ts";
import { startPty, runSteps, type Pty } from "./driver.ts";
import { startMockProvider } from "./mock-provider.ts";
import { normalize } from "./normalize.ts";
import { diffCheckpoints, type CheckpointInput, type DiffResult } from "./diff.ts";
import { updateJourneyEvidence, updateJourneyStatus } from "./catalog.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const JOURNEYS = join(HERE, "..");
const ROOT = join(JOURNEYS, "..", "..", "..");

// The scripted sandbox runs the host's real git; on macOS `/usr/bin/git` is the
// xcrun shim, which can stall under concurrent calls.
const GIT_DIR = (() => {
  const real =
    process.platform === "darwin"
      ? Bun.spawnSync(["xcrun", "-f", "git"]).stdout.toString().trim()
      : "";
  const git = real || Bun.which("git") || "";
  return git.slice(0, git.lastIndexOf("/"));
})();

export interface Paths {
  home: string;
  config: string;
  data: string;
  state: string;
  cache: string;
  work: string;
}

const pathsFor = (root: string): Paths => ({
  home: join(root, "journey-home"),
  config: join(root, "journey-home", ".config", "opencode"),
  data: join(root, "journey-home", ".local", "share"),
  state: join(root, "journey-home", ".local", "state"),
  cache: join(root, "journey-home", ".cache"),
  work: join(root, "journey-work"),
});

export const makePaths = (root: string): Paths => {
  const paths = pathsFor(root);
  for (const dir of [paths.home, paths.config, paths.data, paths.state, paths.cache, paths.work]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
};

/** The reference environment carries no host credential and no host config. */
export function referenceEnv(paths: Paths, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    PATH: base.PATH ?? "/usr/bin:/bin",
    HOME: paths.home,
    XDG_CONFIG_HOME: join(paths.home, ".config"),
    XDG_DATA_HOME: join(paths.home, ".local", "share"),
    XDG_STATE_HOME: join(paths.home, ".local", "state"),
    XDG_CACHE_HOME: join(paths.home, ".cache"),
    TERM: "xterm-256color",
    LANG: base.LANG ?? "C.UTF-8",
  };
  if (base.TMPDIR) env.TMPDIR = base.TMPDIR;
  return env;
}

/** One loopback provider, no other endpoint. */
export function referenceConfig(baseURL: string) {
  return {
    $schema: "https://opencode.ai/config.json",
    model: "mock/mock-model",
    permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    providers: {
      mock: {
        name: "Mock",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL, provider: "mock", apiKey: "journey-placeholder" },
        models: {
          "mock-model": {
            name: "Mock Model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
          },
        },
      },
    },
  };
}

const refModels = ["Mock Model", "mock/mock-model", "mock-model", "Mock", "mock"];
export const makiModels = ["synthetic/hf:zai-org/GLM-4.7", "hf:zai-org/GLM-4.7", "synthetic/fake", "Synthetic", "synthetic", "fake"];

async function referenceRun(script: Journey): Promise<Map<string, string>> {
  const root = mkdtempSync(join(tmpdir(), `maki-journey-ref-${script.slug}-`));
  const paths = makePaths(root);
  const provider = startMockProvider(script.turns);
  writeFileSync(join(paths.config, "opencode.json"), JSON.stringify(referenceConfig(provider.url), null, 2));
  const start = () => startPty({ command: ["opencode", "--standalone"], cwd: paths.work, env: referenceEnv(paths) });
  let pty = await start();
  const checkpoints = new Map<string, string>();
  try {
    await runSteps(
      {
        slug: script.slug,
        side: "reference",
        pty,
        restart: async () => {
          await pty.close();
          await Bun.sleep(500);
          pty = await start();
          return pty;
        },
        onCheckpoint: (id, text) => {
          checkpoints.set(id, normalize(text, { workdir: paths.work, home: paths.home, models: refModels }));
        },
      },
      script.steps,
    );
    return checkpoints;
  } finally {
    await pty.close();
    provider.close();
    rmSync(root, { recursive: true, force: true });
  }
}

export async function bridgePort(proc: Bun.Subprocess, timeoutMs = 15_000): Promise<number> {
  const read = (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("bridge exited before reporting a listen address");
      buffer += decoder.decode(chunk.value, { stream: true });
      const match = /bridge listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(buffer);
      if (match) {
        void (async () => {
          while (!(await reader.read()).done) {
            // Drain so the bridge never blocks on a full stdout pipe.
          }
        })();
        return Number(match[1]);
      }
    }
  })();
  return Promise.race([
    read,
    Bun.sleep(timeoutMs).then(() => {
      throw new Error(`bridge did not report a listen address within ${timeoutMs}ms`);
    }),
  ]);
}

export async function waitForSubscriber(path: string, timeoutMs = 15_000, minimum = 1): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const count = () =>
    existsSync(path) ? readFileSync(path, "utf8").split('"server.connected"').length - 1 : 0;
  while (Date.now() < deadline) {
    if (count() >= minimum) return;
    await Bun.sleep(100);
  }
  throw new Error(`the TUI did not subscribe to the bridge event stream within ${timeoutMs}ms`);
}

export async function makiRun(script: Journey): Promise<{ checkpoints: Map<string, string>; requests: string; error?: string }> {
  const root = mkdtempSync(join(tmpdir(), `maki-journey-maki-${script.slug}-`));
  const paths = makePaths(root);
  const requestsPath = join(root, "maki-requests.jsonl");
  const framesPath = join(root, "maki-frames.jsonl");
  const env = {
    ...referenceEnv(paths),
    PORT: "0",
    MAKI_CHILD_CMD: join(ROOT, "bridge", "test", "fake-maki.ts"),
    OPENSHELL_BIN: join(ROOT, "bridge", "test", "fake-openshell.ts"),
    OPENMAKI_SANDBOX: "fake-sandbox",
    FAKE_SANDBOX_HOME: paths.home,
    FAKE_SANDBOX_BIN: join(ROOT, "bridge", "test", "sandbox-bin"),
    FAKE_SANDBOX_GIT_DIR: GIT_DIR,
    OPENMAKI_CWD: paths.work,
    BRIDGE_LOG: requestsPath,
    BRIDGE_SSE_LOG: framesPath,
    FAKE_MAKI_SCRIPT: JSON.stringify(script.turns),
    FAKE_MAKI_SCRIPT_STATE: join(root, "script-state.jsonl"),
  };

  const bridge = Bun.spawn({
    cmd: ["bun", join(ROOT, "bridge", "src", "bridge.ts")],
    cwd: join(ROOT, "bridge"),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let pty: Pty | undefined;
  const checkpoints = new Map<string, string>();
  let error: string | undefined;
  try {
    const port = await bridgePort(bridge);
    const start = () =>
      startPty({
        command: ["opencode", "--server", `http://127.0.0.1:${port}`],
        cwd: paths.work,
        env: referenceEnv(paths),
      });
    pty = await start();
    // The composer can render before the TUI subscribes to the event stream;
    // typing then would miss the turn's frames.
    await waitForSubscriber(framesPath);
    await runSteps(
      {
        slug: script.slug,
        side: "maki",
        pty,
        restart: async () => {
          const before = existsSync(framesPath)
            ? readFileSync(framesPath, "utf8").split('"server.connected"').length - 1
            : 0;
          await pty!.close();
          await Bun.sleep(500);
          pty = await start();
          await waitForSubscriber(framesPath, 15_000, before + 1);
          return pty;
        },
        onCheckpoint: (id, text) => {
          checkpoints.set(id, normalize(text, { workdir: paths.work, home: paths.home, models: makiModels }));
        },
      },
      script.steps,
    );
  } catch (err) {
    // A Maki-side wait failure is recorded as unreached, not as a run error:
    // the reference side already succeeded, so the journey is `broken`.
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await pty?.close();
    bridge.kill();
    await Promise.race([bridge.exited, Bun.sleep(3000)]);
    void new Response(bridge.stderr).text();
  }

  const requests = existsSync(requestsPath) ? readFileSync(requestsPath, "utf8") : "";
  rmSync(root, { recursive: true, force: true });
  return { checkpoints, requests, error };
}

export function writeRun(dir: string, snapshots: Map<string, string>, order: string[]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const id of order) {
    const text = snapshots.get(id);
    if (text !== undefined) writeFileSync(join(dir, `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  }
}

function updateCatalog(slug: string, status: string, evidence: Record<string, string>) {
  updateJourneyStatus(slug, status);
  updateJourneyEvidence(slug, evidence);
}

export const checkpointIds = (script: Journey) =>
  script.steps.flatMap((step) => (step.kind === "checkpoint" ? [step.id] : []));

function evidenceFor(slug: string) {
  const base = `bridge/test/journeys/${slug}`;
  return { reference: `${base}/reference/`, maki: `${base}/maki/`, diff: `${base}/diff.json` };
}

async function record(scriptPath: string): Promise<"parity" | "diverges" | "broken"> {
  const script = (await import(pathToFileURL(scriptPath).href)).default as Journey;
  if (!script?.slug) throw new Error(`${scriptPath}: no journey default export`);
  const id = checkpointIds(script);
  if (id.length === 0) throw new Error(`${script.slug}: script has no checkpoints`);

  console.log(`journey ${script.slug}: reference`);
  const reference = await referenceRun(script);
  if (id.some((x) => reference.get(x) === undefined)) {
    throw new Error(`journey ${script.slug}: reference run did not reach every checkpoint`);
  }

  console.log(`journey ${script.slug}: maki`);
  const maki = await makiRun(script);
  if (maki.error) console.log(`journey ${script.slug}: maki stopped: ${maki.error}`);

  const journeyDir = join(JOURNEYS, script.slug);
  writeRun(join(journeyDir, "reference"), reference, id);
  writeRun(join(journeyDir, "maki"), maki.checkpoints, id);
  writeFileSync(join(journeyDir, "maki-requests.jsonl"), maki.requests);

  const inputs: CheckpointInput[] = id.map((checkpoint) => ({
    id: checkpoint,
    reference: reference.get(checkpoint)!,
    maki: maki.checkpoints.get(checkpoint),
  }));
  const result: DiffResult = diffCheckpoints(inputs);
  writeFileSync(join(journeyDir, "diff.json"), `${JSON.stringify(result, null, 2)}\n`);
  updateCatalog(script.slug, result.status, evidenceFor(script.slug));
  console.log(`journey ${script.slug}: ${result.status}`);
  return result.status;
}

if (import.meta.main) {
  const only = process.argv[2];
  const scripts = readdirSync(JOURNEYS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(JOURNEYS, entry.name, "script.ts")))
    .filter((entry) => only === undefined || entry.name === only)
    .map((entry) => join(JOURNEYS, entry.name, "script.ts"))
    .sort();
  let failed = false;
  for (const script of scripts) {
    try {
      await record(script);
    } catch (err) {
      failed = true;
      console.error(err instanceof Error ? err.message : String(err));
    }
  }
  if (failed) process.exit(1);
}
