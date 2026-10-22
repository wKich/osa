#!/usr/bin/env bun
// oskhs CLI: `run-round <repo> "<prompt>"` (B1.1–B1.2) and `worker`, the kiss
// queue worker (B1.3b).
import { hostname } from "node:os";
import { resolve } from "node:path";
import { MongoTaskStore } from "./kiss/store.ts";
import { defaultLogDir, fileTaskLog } from "./tasklog.ts";
import { echoRound, Worker, type Round, type WorkerOptions } from "./worker.ts";
import { sandboxRound } from "./kiss/sandboxRound.ts";
import { spawnRunner, type Runner } from "./exec.ts";
import { newTaskId, projectName, sandboxName } from "./names.ts";
import type { Ctx } from "./openshell.ts";
import type { RoundResult } from "./result.ts";
import { runRound, type RoundSpec } from "./round.ts";

const USAGE = `usage: oskhs worker [--round sandbox|echo] [--mirror-dir DIR] [--model SPEC]
         [--provider NAME]... [--gateway NAME] [--agent-name NAME] [--once]
         [--max-rounds N] [--max-per-project N] [--round-timeout SECS]
         [--heartbeat-sec SECS] [--cancel-poll-sec SECS] [--poll-sec SECS]
         [--fake-delay SECS] [--log-dir DIR]
       oskhs run-round <repo> "<prompt>" [--model SPEC] [--base BRANCH]
         [--branch NAME]... [--all-branches] [--no-changes] [--provider NAME]...
         [--timeout SECS] [--gateway NAME] [--task-id ID]

Environment: OSKHS_MONGO_URI (worker, required), OSKHS_HOST_ID (worker),
OSKHS_MIRROR_DIR (worker),
OSKHS_PROVIDERS (comma-separated), OSKHS_MODEL, OSKHS_TIMEOUT, OPENSHELL_BIN,
MAKI_OSS_BIN.`;

export class UsageError extends Error {}

export interface RunRoundArgs {
  repo: string;
  prompt: string;
  model?: string;
  base?: string;
  branches: string[];
  allBranches: boolean;
  collect: boolean;
  providers: string[];
  timeoutSec: number;
  gateway?: string;
  taskId?: string;
}

export function parseRunRound(argv: string[], env: Record<string, string | undefined> = process.env): RunRoundArgs {
  const positional: string[] = [];
  const providers: string[] = [];
  const branches: string[] = [];
  let allBranches = false;
  let collect = true;
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`option ${a} requires a value`);
      return v;
    };
    if (a === "--provider") providers.push(value());
    else if (a === "--branch") branches.push(value());
    else if (a === "--all-branches") allBranches = true;
    else if (a === "--no-changes") collect = false;
    else if (["--model", "--base", "--timeout", "--gateway", "--task-id"].includes(a)) opts[a.slice(2)] = value();
    else if (a === "--") positional.push(...argv.slice(i + 1)), (i = argv.length);
    else if (a.startsWith("--")) throw new UsageError(`unknown option: ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 2) throw new UsageError("run-round takes <repo> and \"<prompt>\"");
  const timeoutRaw = opts.timeout ?? env.OSKHS_TIMEOUT ?? "600";
  if (!/^[1-9][0-9]*$/.test(timeoutRaw)) throw new UsageError(`--timeout must be a positive number of seconds, got '${timeoutRaw}'`);
  const fromEnv = (env.OSKHS_PROVIDERS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return {
    repo: positional[0]!,
    prompt: positional[1]!,
    model: opts.model ?? env.OSKHS_MODEL,
    base: opts.base,
    branches,
    allBranches,
    collect,
    providers: providers.length ? providers : fromEnv,
    timeoutSec: Number(timeoutRaw),
    gateway: opts.gateway,
    taskId: opts["task-id"],
  };
}

/** Exit status: 0 only for an answer. */
export const exitCode = (r: RoundResult) => (r.kind === "answer" ? 0 : r.kind === "failed" ? 3 : 4);

async function currentBranch(run: Runner, repo: string): Promise<string> {
  const out = await run(["git", "-C", repo, "symbolic-ref", "--short", "HEAD"]);
  if (out.code !== 0) throw new UsageError(`cannot read the current branch of ${repo}; pass --base`);
  return out.stdout.trim();
}

export interface WorkerArgs {
  round: "sandbox" | "echo";
  mirrorDir?: string;
  model?: string;
  providers: string[];
  gateway?: string;
  agentName: string;
  once: boolean;
  pollSec: number;
  fakeDelaySec: number;
  logDir: string;
  options: Omit<WorkerOptions, "log" | "info">;
}

const WORKER_NUMBERS: Record<string, [keyof WorkerArgs["options"] | "pollSec" | "fakeDelaySec", number]> = {
  "--max-rounds": ["maxRounds", 2],
  "--max-per-project": ["maxPerProject", 1],
  "--round-timeout": ["roundTimeoutSec", 600],
  "--heartbeat-sec": ["heartbeatSec", 20],
  "--cancel-poll-sec": ["cancelPollSec", 3],
  "--poll-sec": ["pollSec", 2],
  "--fake-delay": ["fakeDelaySec", 0],
};

export function parseWorker(argv: string[], env: Record<string, string | undefined> = process.env): WorkerArgs {
  const values: Record<string, number> = Object.fromEntries(Object.values(WORKER_NUMBERS));
  let once = false;
  let logDir = defaultLogDir(env);
  let round: WorkerArgs["round"] = "sandbox";
  const providers: string[] = [];
  const text: Record<string, string | undefined> = { mirrorDir: env.OSKHS_MIRROR_DIR, model: env.OSKHS_MODEL, agentName: "kiss" };
  const TEXT: Record<string, string> = { "--mirror-dir": "mirrorDir", "--model": "model", "--gateway": "gateway", "--agent-name": "agentName" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--once") {
      once = true;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new UsageError(`option ${a} requires a value`);
    if (a === "--log-dir") logDir = v;
    else if (a === "--round") {
      if (v !== "sandbox" && v !== "echo") throw new UsageError(`--round must be sandbox or echo, got '${v}'`);
      round = v;
    } else if (a === "--provider") providers.push(v);
    else if (TEXT[a]) text[TEXT[a]!] = v;
    else if (WORKER_NUMBERS[a]) {
      const n = Number(v);
      const [key] = WORKER_NUMBERS[a]!;
      if (!Number.isFinite(n) || n < 0 || (n === 0 && key !== "fakeDelaySec")) throw new UsageError(`${a} must be a positive number, got '${v}'`);
      values[key] = n;
    } else throw new UsageError(`unknown option: ${a}`);
  }
  if (values.heartbeatSec! >= 300) throw new UsageError("--heartbeat-sec must stay well inside kiss's 10-minute dead-runtime timeout");
  if (round === "sandbox" && !text.mirrorDir) throw new UsageError("--round sandbox needs --mirror-dir (or OSKHS_MIRROR_DIR)");
  const { pollSec, fakeDelaySec, ...rest } = values;
  const fromEnv = (env.OSKHS_PROVIDERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    round,
    mirrorDir: text.mirrorDir,
    model: text.model,
    providers: providers.length ? providers : fromEnv,
    gateway: text.gateway,
    agentName: text.agentName!,
    once,
    pollSec: pollSec!,
    fakeDelaySec: fakeDelaySec!,
    logDir,
    options: { hostId: env.OSKHS_HOST_ID || `oskhs-${hostname()}`, ...(rest as Omit<WorkerArgs["options"], "hostId">) },
  };
}

async function runWorker(rest: string[]): Promise<number> {
  let args: WorkerArgs;
  try {
    args = parseWorker(rest);
  } catch (err) {
    if (err instanceof UsageError) return console.error(`oskhs: ${err.message}\n${USAGE}`), 1;
    throw err;
  }
  const uri = process.env.OSKHS_MONGO_URI;
  if (!uri) return console.error("oskhs: OSKHS_MONGO_URI is not set"), 2;
  const store = await MongoTaskStore.connect(uri);
  const info = (msg: string) => console.error(`oskhs: ${msg}`);
  const repoRoot = resolve(import.meta.dir, "../..");
  const ctx: Ctx = {
    run: spawnRunner,
    openshell: process.env.OPENSHELL_BIN ?? "openshell",
    makiOss: process.env.MAKI_OSS_BIN ?? `${repoRoot}/bin/maki-oss`,
    gateway: args.gateway,
    log: info,
  };
  const round: Round =
    args.round === "echo"
      ? echoRound(args.fakeDelaySec)
      : sandboxRound({ ctx, mirrorDir: resolve(args.mirrorDir!), providers: args.providers, model: args.model, agentName: args.agentName });
  const worker = new Worker(store, round, { ...args.options, log: fileTaskLog(args.logDir), info });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    info("shutting down: aborting rounds and requeuing their tasks");
    await worker.shutdown();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  info(`worker ${args.options.hostId} started (${args.round} round, rounds ≤ ${args.options.maxRounds}, per project ≤ ${args.options.maxPerProject}, logs in ${args.logDir})`);
  await worker.recover();
  for (;;) {
    if (stopping) return 0;
    let claimed = false;
    try {
      claimed = await worker.tick();
    } catch (err) {
      info(`claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (args.once && !claimed && worker.running === 0) break;
    if (!claimed) await Bun.sleep(args.pollSec * 1000);
  }
  await store.close();
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "worker") return runWorker(rest);
  if (cmd !== "run-round") {
    console.error(cmd && cmd !== "help" && cmd !== "--help" ? `unknown command: ${cmd}\n${USAGE}` : USAGE);
    return cmd === "help" || cmd === "--help" ? 0 : 1;
  }
  let args: RunRoundArgs;
  try {
    args = parseRunRound(rest);
  } catch (err) {
    if (err instanceof UsageError) return console.error(`oskhs: ${err.message}\n${USAGE}`), 1;
    throw err;
  }
  const repoRoot = resolve(import.meta.dir, "../..");
  const ctx: Ctx = {
    run: spawnRunner,
    openshell: process.env.OPENSHELL_BIN ?? "openshell",
    makiOss: process.env.MAKI_OSS_BIN ?? `${repoRoot}/bin/maki-oss`,
    gateway: args.gateway,
    log: (msg) => console.error(`oskhs: ${msg}`),
  };
  const repo = resolve(args.repo);
  let base: string;
  try {
    base = args.base ?? (await currentBranch(ctx.run, repo));
  } catch (err) {
    if (err instanceof UsageError) return console.error(`oskhs: ${err.message}`), 1;
    throw err;
  }
  const project = projectName(repo);
  const spec: RoundSpec = {
    sandbox: sandboxName(project),
    providers: args.providers,
    taskId: args.taskId ?? newTaskId(),
    repos: [{ key: project, hostRepo: repo, base, branches: args.branches, allBranches: args.allBranches }],
    collect: args.collect,
    prompt: args.prompt,
    model: args.model,
    timeoutSec: args.timeoutSec,
  };
  const { result, repos } = await runRound(ctx, spec);
  console.log(JSON.stringify({ taskId: spec.taskId, sandbox: spec.sandbox, ...result, repos }));
  return exitCode(result);
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
