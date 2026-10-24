#!/usr/bin/env bun
// Live journey run (design decisions 1–6). For every scripted journey, run the
// Maki side against the real pinned Maki inside one throwaway OpenShell
// sandbox, with the harness's scripted provider on the sandbox's own loopback.
// Render and normalize the screens with the same rules as the offline run,
// compare them with the journey's committed reference snapshots, and record
// `evidence.live` on the journey row.
//
//   bun bridge/test/journeys/harness/live.ts [slug]
//
// Skips cleanly (exit 0, no catalog edit) when opencode, openshell, a
// reachable gateway, or the project image is unavailable.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Journey } from "./journey.ts";
import { startPty, runSteps, type Pty } from "./driver.ts";
import { normalize } from "./normalize.ts";
import { diffCheckpoints, type CheckpointInput, type Verdict } from "./diff.ts";
import {
  bridgePort,
  checkpointIds,
  makePaths,
  makiModels,
  referenceEnv,
  waitForSubscriber,
  writeRun,
} from "./record.ts";
import { journeyRow, updateJourneyLive } from "./catalog.ts";
import {
  gatewayReady,
  imageId,
  imagePresent,
  liveEnvironment,
  makiVersion,
  openshellFound,
  resetSandbox,
  SANDBOX_WORKDIR,
  startProvider,
  uploadJourneyConfig,
  withSandbox,
  type LiveEnvironment,
} from "./live-sandbox.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const JOURNEYS = join(HERE, "..");
const ROOT = join(JOURNEYS, "..", "..", "..");

// The bridge reports its own catalog labels; the mock provider's labels can
// surface too if Maki prints them, so both normalize to <MODEL>. Maki's
// assistant frames name the custom provider `maki`, so the provider display
// (and its `sample` placeholder before the first announcement) joins the map.
export const LIVE_MODELS = [
  ...makiModels,
  "maki/mock-model",
  "mock/mock-model",
  "Mock Model",
  "sample/sample",
  "mock-model",
  "sample",
  "maki",
  "Mock",
  "mock",
];

export interface LiveVersions {
  maki: string;
  image: string;
}

/** The evidence.live shape (design decision 5). */
export function liveEvidence(slug: string, verdict: Verdict, versions: LiveVersions) {
  const base = `bridge/test/journeys/${slug}`;
  return {
    snapshots: `${base}/live/`,
    diff: `${base}/live-diff.json`,
    maki: versions.maki,
    image: versions.image,
    verdict,
  };
}

const checkpointIdsOf = (script: Journey) => checkpointIds(script);

function referenceSnapshots(slug: string, ids: string[]): Map<string, string> {
  const dir = join(JOURNEYS, slug, "reference");
  return new Map(
    ids.map((id) => {
      const file = join(dir, `${id}.txt`);
      if (!existsSync(file)) {
        throw new Error(`journey ${slug}: no committed reference snapshot ${id}`);
      }
      return [id, readFileSync(file, "utf8")];
    }),
  );
}

async function liveRun(
  script: Journey,
  sandbox: string,
  env: LiveEnvironment,
  work: string,
): Promise<{ checkpoints: Map<string, string>; requests: string }> {
  const root = mkdtempSync(join(tmpdir(), `maki-journey-live-${script.slug}-`));
  const paths = makePaths(root);
  const requestsPath = join(root, "live-requests.jsonl");
  const framesPath = join(root, "live-frames.jsonl");
  const turnsFile = join(work, `${script.slug}-turns.json`);
  const checkpoints = new Map<string, string>();

  resetSandbox(env, sandbox);
  writeFileSync(turnsFile, JSON.stringify(script.turns));
  const provider = await startProvider(env, sandbox, turnsFile);
  let bridge: Bun.Subprocess | undefined;
  let bridgeErr = "";
  let stderrDone: Promise<void> | undefined;
  let pty: Pty | undefined;
  try {
    uploadJourneyConfig(env, sandbox, provider.port, join(root, "config"));
    // The bridge spawns `openshell`, so it keeps the host env (gateway
    // metadata lives under the host's home); it never forwards an env value
    // into the sandbox.
    bridge = Bun.spawn({
      cmd: [process.execPath, join(ROOT, "bridge", "src", "bridge.ts")],
      cwd: join(ROOT, "bridge"),
      env: {
        ...process.env,
        PORT: "0",
        OPENSHELL_BIN: env.openshell,
        OPENMAKI_SANDBOX: sandbox,
        OPENMAKI_CWD: SANDBOX_WORKDIR,
        BRIDGE_LOG: requestsPath,
        BRIDGE_SSE_LOG: framesPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    stderrDone = (async () => {
      for await (const part of bridge!.stderr) {
        bridgeErr += new TextDecoder().decode(part, { stream: true });
      }
    })();
    const port = await bridgePort(bridge);
    const start = () =>
      startPty({
        command: ["opencode", "--server", `http://127.0.0.1:${port}`],
        cwd: paths.work,
        env: referenceEnv(paths),
      });
    pty = await start();
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
          checkpoints.set(
            id,
            normalize(text, { workdir: SANDBOX_WORKDIR, home: paths.home, models: LIVE_MODELS }),
          );
        },
      },
      script.steps,
    );
  } catch (err) {
    // A wait failure is recorded as unreached, not as a run error: the live
    // verdict is `broken`, exactly as an offline Maki-side failure is.
    console.log(`journey ${script.slug}: live stopped: ${err instanceof Error ? err.message : String(err)}`);
    if (bridgeErr.trim()) console.error(bridgeErr.trim());
    if (pty) console.error(await pty.text());
  } finally {
    await pty?.close();
    bridge?.kill();
    if (bridge) await Promise.race([bridge.exited, Bun.sleep(3000)]);
    await Promise.race([stderrDone, Bun.sleep(1000)]);
    await provider.stop();
  }

  const requests = existsSync(requestsPath) ? readFileSync(requestsPath, "utf8") : "";
  rmSync(root, { recursive: true, force: true });
  return { checkpoints, requests };
}

/** Runs one journey, writes its live snapshots/comparison, and records the verdict. */
export async function runJourney(
  scriptPath: string,
  sandbox: string,
  env: LiveEnvironment,
  work: string,
  versions: LiveVersions,
): Promise<Verdict> {
  const script = (await import(pathToFileURL(scriptPath).href)).default as Journey;
  if (!script?.slug) throw new Error(`${scriptPath}: no journey default export`);
  const ids = checkpointIdsOf(script);
  if (ids.length === 0) throw new Error(`${script.slug}: script has no checkpoints`);

  const reference = referenceSnapshots(script.slug, ids);
  console.log(`journey ${script.slug}: live maki`);
  const live = await liveRun(script, sandbox, env, work);

  const dir = join(JOURNEYS, script.slug);
  writeRun(join(dir, "live"), live.checkpoints, ids);
  writeFileSync(join(dir, "live-maki-requests.jsonl"), live.requests);

  const accepted = journeyRow(script.slug).acceptedDiffs ?? [];
  const inputs: CheckpointInput[] = ids.map((id) => ({
    id,
    reference: reference.get(id)!,
    maki: live.checkpoints.get(id),
    acceptedReason: accepted.find((d: { checkpoint: string }) => d.checkpoint === id)?.reason,
  }));
  const result = diffCheckpoints(inputs);
  writeFileSync(join(dir, "live-diff.json"), `${JSON.stringify(result, null, 2)}\n`);
  updateJourneyLive(script.slug, liveEvidence(script.slug, result.status, versions));
  console.log(`journey ${script.slug}: live ${result.status}`);
  return result.status;
}

function scripts(only?: string): string[] {
  return readdirSync(JOURNEYS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(JOURNEYS, entry.name, "script.ts")))
    .filter((entry) => only === undefined || entry.name === only)
    .map((entry) => join(JOURNEYS, entry.name, "script.ts"))
    .sort();
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const env = liveEnvironment();
  if (!Bun.which("opencode")) {
    console.log("opencode not found; skipping live journey run");
    return;
  }
  if (!openshellFound(env)) {
    console.log("openshell not found; skipping live journey run");
    return;
  }
  if (!gatewayReady(env)) {
    console.log("no reachable OpenShell gateway; skipping live journey run");
    return;
  }
  if (!imagePresent(env)) {
    console.log(`image ${env.image} not found; skipping live journey run`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "maki-journeys-live-"));
  let failed = false;
  try {
    await withSandbox(env, async (sandbox) => {
      const versions: LiveVersions = { maki: makiVersion(env, sandbox), image: imageId(env) };
      for (const scriptPath of scripts(argv[0])) {
        try {
          await runJourney(scriptPath, sandbox, env, work, versions);
        } catch (err) {
          failed = true;
          console.error(`journey ${scriptPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (failed) process.exit(1);
}

if (import.meta.main) await main();
