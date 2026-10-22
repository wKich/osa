#!/usr/bin/env bun
// oskhs CLI. Today: `run-round <repo> "<prompt>"` (roadmap B1.1a).
import { resolve } from "node:path";
import { spawnRunner, type Runner } from "./exec.ts";
import { newTaskId, projectName, sandboxName } from "./names.ts";
import type { Ctx } from "./openshell.ts";
import type { RoundResult } from "./result.ts";
import { runRound, type RoundSpec } from "./round.ts";

const USAGE = `usage: oskhs run-round <repo> "<prompt>" [--model SPEC] [--base BRANCH]
         [--branch NAME]... [--all-branches] [--no-changes] [--provider NAME]...
         [--timeout SECS] [--gateway NAME] [--task-id ID]

Environment: OSKHS_PROVIDERS (comma-separated), OSKHS_MODEL, OSKHS_TIMEOUT,
OPENSHELL_BIN, MAKI_OSS_BIN.`;

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

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
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
  const spec: RoundSpec = {
    repo,
    sandbox: sandboxName(projectName(repo)),
    providers: args.providers,
    taskId: args.taskId ?? newTaskId(),
    base,
    branches: args.branches,
    allBranches: args.allBranches,
    collect: args.collect,
    prompt: args.prompt,
    model: args.model,
    timeoutSec: args.timeoutSec,
  };
  const { result, sync, changes } = await runRound(ctx, spec);
  console.log(JSON.stringify({ taskId: spec.taskId, sandbox: spec.sandbox, ...result, sync, changes }));
  return exitCode(result);
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
