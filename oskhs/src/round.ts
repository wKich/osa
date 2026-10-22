// One round: ensure the warm sandbox, sync the round's refs, add a detached
// task worktree,
// run Maki headless in it through maki-oss, and remove the worktree again —
// also after a failure (design decision 8).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tail } from "./exec.ts";
import { REPO_DIR, worktreePath } from "./names.ts";
import { sandboxSh, type Ctx } from "./openshell.ts";
import { interpretRun, StageError, type RoundResult } from "./result.ts";
import { ensureSandbox } from "./sandbox.ts";
import { syncRefs, type SyncStats } from "./sync.ts";
import { collectChanges, type Changes } from "./collect.ts";

export interface RoundSpec {
  repo: string; // host clone the seed comes from
  sandbox: string;
  providers: string[];
  taskId: string;
  base: string; // branch name, delivered as refs/remotes/origin/<base>
  branches: string[]; // the task's own branches, delivered with the base
  allBranches: boolean; // also every other branch and tag
  collect: boolean; // false for read-only rounds: changes are discarded
  prompt: string;
  model?: string;
  timeoutSec: number;
}

// The client backstop fires only if the in-sandbox timeout never returns.
const BACKSTOP_SEC = 30;

// $1 repo, $2 path, $3 base, $4 task id. -B resets a re-run task's branch.
const ADD_WORKTREE = `git -C "$1" worktree add -q -B "task-$4" "$2" "refs/remotes/origin/$3"`;
// Also drops local branches no remaining worktree has checked out: an
// agent's `git checkout <b>` creates refs/heads/<b> from origin/<b>, and a
// later task checking out <b> would otherwise get that stale copy instead
// of the freshly synced remote-tracking ref.
const REMOVE_WORKTREE = `git -C "$1" worktree remove --force "$2" 2>/dev/null || rm -rf "$2"
git -C "$1" worktree prune
busy=$(git -C "$1" worktree list --porcelain | sed -n 's/^branch //p')
git -C "$1" for-each-ref --format='%(refname)' refs/heads | while read -r ref; do
    printf '%s\\n' "$busy" | grep -qxF "$ref" || git -C "$1" update-ref -d "$ref"
done`;

export async function addWorktree(ctx: Ctx, sandbox: string, taskId: string, base: string): Promise<string> {
  const path = worktreePath(taskId);
  const out = await sandboxSh(ctx, sandbox, ADD_WORKTREE, [REPO_DIR, path, base, taskId]);
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

export interface RoundOutcome {
  result: RoundResult;
  sync?: SyncStats; // absent when the round failed before or during the sync
  changes: Changes | null; // null when nothing was collected
}

export async function runRound(ctx: Ctx, spec: RoundSpec): Promise<RoundOutcome> {
  let added = false;
  let sync: SyncStats | undefined;
  try {
    await ensureSandbox(ctx, spec);
    const branches = [spec.base, ...spec.branches.filter((b) => b !== spec.base)];
    sync = await syncRefs(ctx, { repo: spec.repo, sandbox: spec.sandbox, taskId: spec.taskId, branches, allBranches: spec.allBranches });
    const workdir = await addWorktree(ctx, spec.sandbox, spec.taskId, spec.base);
    added = true;
    ctx.log(`round ${spec.taskId} in ${spec.sandbox}:${workdir}`);
    const result = await runMaki(ctx, spec, workdir);
    if (result.kind !== "answer" || !spec.collect) return { result, sync, changes: null };
    // collected before the worktree (and its branch) is removed
    const changes = await collectChanges(ctx, {
      repo: spec.repo,
      sandbox: spec.sandbox,
      taskId: spec.taskId,
      baseTip: sync.tips[`refs/heads/${spec.base}`]!,
      prerequisites: [...new Set(Object.values(sync.tips))],
    });
    return { result, sync, changes };
  } catch (err) {
    if (err instanceof StageError) return { result: { kind: "failed", stage: err.stage, exitCode: err.exitCode, stderr: err.stderr }, sync, changes: null };
    throw err;
  } finally {
    if (added) await removeWorktree(ctx, spec.sandbox, spec.taskId);
  }
}
