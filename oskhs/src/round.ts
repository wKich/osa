// One round: ensure + seed the warm sandbox, add a detached task worktree,
// run Maki headless in it through maki-oss, and remove the worktree again —
// also after a failure (design decision 8).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tail } from "./exec.ts";
import { REPO_DIR, worktreePath } from "./names.ts";
import { sandboxSh, type Ctx } from "./openshell.ts";
import { interpretRun, StageError, type RoundResult } from "./result.ts";
import { ensureSandbox, seedIfNeeded } from "./seed.ts";

export interface RoundSpec {
  repo: string; // host clone the seed comes from
  sandbox: string;
  providers: string[];
  taskId: string;
  base: string; // branch name, delivered as refs/remotes/origin/<base>
  prompt: string;
  model?: string;
  timeoutSec: number;
}

// The client backstop fires only if the in-sandbox timeout never returns.
const BACKSTOP_SEC = 30;

const ADD_WORKTREE = `git -C "$1" worktree add -q --detach "$2" "refs/remotes/origin/$3"`;
const REMOVE_WORKTREE = `git -C "$1" worktree remove --force "$2" 2>/dev/null || rm -rf "$2"
git -C "$1" worktree prune`;

export async function addWorktree(ctx: Ctx, sandbox: string, taskId: string, base: string): Promise<string> {
  const path = worktreePath(taskId);
  const out = await sandboxSh(ctx, sandbox, ADD_WORKTREE, [REPO_DIR, path, base]);
  if (out.code !== 0) throw new StageError("worktree", out.code, tail(out.stderr));
  return path;
}

export async function removeWorktree(ctx: Ctx, sandbox: string, taskId: string): Promise<void> {
  const out = await sandboxSh(ctx, sandbox, REMOVE_WORKTREE, [REPO_DIR, worktreePath(taskId)]);
  if (out.code !== 0) ctx.log(`worktree cleanup for ${taskId} failed (exit ${out.code}): ${tail(out.stderr, 3)}`);
}

export async function runMaki(ctx: Ctx, spec: RoundSpec, workdir: string): Promise<RoundResult> {
  const argv = [ctx.makiOss, "run", "--no-sync", "--timeout", String(spec.timeoutSec)];
  if (spec.model) argv.push("--model", spec.model);
  argv.push("--", spec.prompt);
  const env: Record<string, string> = { MAKI_OSS_SANDBOX_NAME: spec.sandbox, MAKI_OSS_WORKDIR: workdir };
  if (spec.providers.length) env.MAKI_OSS_PROVIDERS = spec.providers.join(",");
  if (ctx.gateway) env.MAKI_OSS_GATEWAY = ctx.gateway;
  // An empty cwd: if the sandbox vanished mid-round, maki-oss would recreate
  // it and upload its cwd — an empty directory fails that upload instead of
  // shipping whatever directory oskhs happens to run in.
  const cwd = await mkdtemp(join(tmpdir(), "oskhs-run-"));
  try {
    const out = await ctx.run(argv, { env, cwd, timeoutMs: (spec.timeoutSec + BACKSTOP_SEC) * 1000 });
    return interpretRun(out, spec.timeoutSec);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function runRound(ctx: Ctx, spec: RoundSpec): Promise<RoundResult> {
  let added = false;
  try {
    await ensureSandbox(ctx, spec);
    await seedIfNeeded(ctx, spec.sandbox, spec.repo);
    const workdir = await addWorktree(ctx, spec.sandbox, spec.taskId, spec.base);
    added = true;
    ctx.log(`round ${spec.taskId} in ${spec.sandbox}:${workdir}`);
    return await runMaki(ctx, spec, workdir);
  } catch (err) {
    if (err instanceof StageError) return { kind: "failed", stage: err.stage, exitCode: err.exitCode, stderr: err.stderr };
    throw err;
  } finally {
    if (added) await removeWorktree(ctx, spec.sandbox, spec.taskId);
  }
}
