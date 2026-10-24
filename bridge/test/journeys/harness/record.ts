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
import { modelLabels, normalize } from "./normalize.ts";
import { diffCheckpoints, type CheckpointInput, type DiffResult } from "./diff.ts";
import { journeyRow, updateJourneyEvidence, updateJourneyStatus } from "./catalog.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const JOURNEYS = join(HERE, "..");
const ROOT = join(JOURNEYS, "..", "..", "..");

/** Setup failures are not journey verdicts (design decision 4). */
export class HarnessError extends Error {}

/** `MAKI_MODEL` the scripted child announces; the TUI selects it first. */
export const SCRIPTED_MODEL = "synthetic/fake";

const CATALOG = join(ROOT, "bridge", "compat", "journeys.json");

/** The OpenCode version the journey catalog pins. */
export function opencodePin(): string {
  return JSON.parse(readFileSync(CATALOG, "utf8")).pin?.opencode ?? "";
}

/** The installed OpenCode version, without a leading `v`. */
export function opencodeVersion(bin: string = Bun.which("opencode") ?? "opencode"): string {
  let out: ReturnType<typeof Bun.spawnSync>;
  try {
    out = Bun.spawnSync([bin, "--version"]);
  } catch (err) {
    throw new HarnessError(`opencode not found (${bin}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = `${out.stdout.toString()} ${out.stderr.toString()}`.trim();
  const match = /(\d+\.\d+\.\d+)/.exec(text);
  if (!match) throw new HarnessError(`could not read opencode --version from ${bin}: ${text}`);
  return match[1]!;
}

export function assertPinnedOpencode(pin: string = opencodePin(), bin?: string): string {
  const actual = opencodeVersion(bin);
  if (actual !== pin) {
    throw new HarnessError(
      `opencode version mismatch: installed ${actual}, journey pin ${pin}; no journey was recorded`,
    );
  }
  return actual;
}

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
    // The TUI's update check asks the OpenCode release feed; a journey's only
    // network peer is the loopback provider (cli services/updater.ts v2.0.32
    // L534), and a new release must not change every home-screen snapshot.
    OPENCODE_DISABLE_AUTOUPDATE: "1",
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
            // The bridge's model rows carry no context limit, so the reference
            // omits the context percentage the TUI would otherwise print.
            limit: { context: 0, output: 0 },
          },
        },
      },
    },
  };
}

/** The provider/model labels the reference config can print. */
export function referenceLabels(baseURL: string): string[] {
  const config = referenceConfig(baseURL);
  const provider = config.providers.mock;
  return modelLabels(
    {
      data: Object.entries(provider.models).map(([id, model]) => ({
        id,
        modelID: id,
        providerID: "mock",
        name: model.name,
      })),
    },
    { data: [{ id: "mock", name: provider.name }] },
  );
}

async function referenceRun(script: Journey): Promise<Map<string, string>> {
  const root = mkdtempSync(join(tmpdir(), `maki-journey-ref-${script.slug}-`));
  const paths = makePaths(root);
  let provider: ReturnType<typeof startMockProvider>;
  try {
    provider = startMockProvider(script.turns);
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw new HarnessError(`reference provider failed to bind: ${err instanceof Error ? err.message : String(err)}`);
  }
  writeFileSync(join(paths.config, "opencode.json"), JSON.stringify(referenceConfig(provider.url), null, 2));
  const labels = referenceLabels(provider.url);
  const start = async () => {
    try {
      return await startPty({ command: ["opencode", "--standalone"], cwd: paths.work, env: referenceEnv(paths) });
    } catch (err) {
      throw new HarnessError(`reference PTY failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const checkpoints = new Map<string, string>();
  let pty: Pty | undefined;
  try {
    pty = await start();
    await runSteps(
      {
        slug: script.slug,
        side: "reference",
        pty,
        restart: async () => {
          await pty!.close();
          await Bun.sleep(500);
          pty = await start();
          return pty;
        },
        onCheckpoint: (id, text) => {
          checkpoints.set(id, normalize(text, { workdir: paths.work, home: paths.home, models: labels }));
        },
      },
      script.steps,
    );
    return checkpoints;
  } catch (err) {
    // The reference is the control: its failure says the rig is wrong, not
    // the bridge.
    throw err instanceof HarnessError
      ? err
      : new HarnessError(`reference run failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pty?.close();
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

export async function makiModelLabels(base: string): Promise<string[]> {
  try {
    const [models, providers] = await Promise.all([
      fetch(`${base}/api/model`).then((r) => r.json()),
      fetch(`${base}/api/provider`).then((r) => r.json()),
    ]);
    return modelLabels(models, providers);
  } catch (err) {
    throw new HarnessError(`could not read the bridge model list: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface MakiRunResult {
  checkpoints: Map<string, string>;
  requests: string;
  frames: string;
  /** the final screen when the run stopped early, normalized */
  screen?: string;
  error?: string;
}

export async function makiRun(script: Journey): Promise<MakiRunResult> {
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
    // The helper's invocation: production selects the configured model, so a
    // scenario cannot silently run the sandbox's first catalog model.
    MAKI_MODEL: SCRIPTED_MODEL,
    BRIDGE_LOG: requestsPath,
    BRIDGE_SSE_LOG: framesPath,
    FAKE_MAKI_SCRIPT: JSON.stringify(script.turns),
    FAKE_MAKI_SCRIPT_STATE: join(root, "script-state.jsonl"),
  };

  let bridge: Bun.Subprocess;
  try {
    bridge = Bun.spawn({
      cmd: ["bun", join(ROOT, "bridge", "src", "bridge.ts")],
      cwd: join(ROOT, "bridge"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw new HarnessError(`bridge failed to spawn: ${err instanceof Error ? err.message : String(err)}`);
  }
  let pty: Pty | undefined;
  let labels: string[] = [];
  const checkpoints = new Map<string, string>();
  let error: string | undefined;
  let screen: string | undefined;
  let requests = "";
  let frames = "";
  try {
    let port: number;
    try {
      port = await bridgePort(bridge);
    } catch (err) {
      throw new HarnessError(`bridge boot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const start = async () => {
      try {
        return await startPty({
          command: ["opencode", "--server", `http://127.0.0.1:${port}`],
          cwd: paths.work,
          env: referenceEnv(paths),
        });
      } catch (err) {
        throw new HarnessError(`Maki-side PTY failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    pty = await start();
    // The composer can render before the TUI subscribes to the event stream;
    // typing then would miss the turn's frames.
    await waitForSubscriber(framesPath);
    labels = await makiModelLabels(`http://127.0.0.1:${port}`);
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
          checkpoints.set(id, normalize(text, { workdir: paths.work, home: paths.home, models: labels }));
        },
      },
      script.steps,
    );
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    // A Maki-side wait failure is recorded as unreached, not as a run error:
    // the reference side already succeeded, so the journey is `broken`.
    error = err instanceof Error ? err.message : String(err);
    // Capture before the PTY closes: the alternates screen is gone after.
    if (pty) screen = normalize(await pty.text(), { workdir: paths.work, home: paths.home, models: labels });
  } finally {
    await pty?.close();
    bridge.kill();
    await Promise.race([bridge.exited, Bun.sleep(3000)]);
    void new Response(bridge.stderr).text();
    requests = existsSync(requestsPath) ? normalizeRequests(readFileSync(requestsPath, "utf8")) : "";
    frames = existsSync(framesPath) ? normalizeFrames(readFileSync(framesPath, "utf8"), paths) : "";
    rmSync(root, { recursive: true, force: true });
  }

  return { checkpoints, requests, frames, screen, error };
}

export function writeRun(dir: string, snapshots: Map<string, string>, order: string[]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const id of order) {
    const text = snapshots.get(id);
    if (text !== undefined) writeFileSync(join(dir, `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  }
}

/** Evidence for a Maki-side checkpoint that was never reached (design decision 4). */
export function writeFailureEvidence(dir: string, screen: string | undefined, error: string | undefined) {
  mkdirSync(dir, { recursive: true });
  if (screen !== undefined) writeFileSync(join(dir, "final-screen.txt"), screen.endsWith("\n") ? screen : `${screen}\n`);
  if (error !== undefined) writeFileSync(join(dir, "error.txt"), `${error}\n`);
}

const messageIDs = /\b(?:ses|msg|per|evt|prt)_[A-Za-z0-9]+\b/g;

/** Boot probes the TUI fires on a timer: whether they reach the log before the
 * journey ends is a race, and the route is already measured by the TUI capture. */
const BOOT_PROBES = new Set(["GET /api/experimental/migration/v1"]);

/** Request evidence is the measured route set: sorted and deduped, so a
 * recording is reproducible and carries no clock or run id. */
export function normalizeRequests(log: string): string {
  const rows = new Set<string>();
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { method: string; path: string };
    const route = {
      method: row.method,
      path: row.path.replace(/\/ses_[^/]+/g, "/{sessionID}").replace(/\/per_[^/]+/g, "/{requestID}"),
    };
    if (!BOOT_PROBES.has(`${route.method} ${route.path}`)) rows.add(JSON.stringify(route));
  }
  return rows.size ? `${[...rows].sort().join("\n")}\n` : "";
}

/** A committed frame capture keeps event shape and order; ids, clock, and
 * run paths are normalized so two recordings compare byte for byte. */
export function normalizeFrames(log: string, paths: Pick<Paths, "work" | "home">): string {
  const run = join(paths.work, "..");
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value
        .split(paths.work)
        .join("<WORKDIR>")
        .split(paths.home)
        .join("<HOME>")
        .split(run)
        .join("<RUN>")
        .replace(messageIDs, "<ID>")
        .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "<TIME>");
    }
    if (typeof value === "number") return value > 1e12 ? 0 : value;
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v)]));
    }
    return value;
  };
  const rows = log
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.stringify(scrub(JSON.parse(line))));
  return rows.length ? `${rows.join("\n")}\n` : "";
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

  assertPinnedOpencode();

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
  if (maki.error) writeFailureEvidence(join(journeyDir, "maki"), maki.screen, maki.error);
  writeFileSync(join(journeyDir, "maki-requests.jsonl"), maki.requests);
  writeFileSync(join(journeyDir, "maki-frames.jsonl"), maki.frames);

  const accepted = journeyRow(script.slug).acceptedDiffs ?? [];
  const inputs: CheckpointInput[] = id.map((checkpoint) => ({
    id: checkpoint,
    reference: reference.get(checkpoint)!,
    maki: maki.checkpoints.get(checkpoint),
    acceptedReason: accepted.find((d: { checkpoint: string }) => d.checkpoint === checkpoint)?.reason,
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
