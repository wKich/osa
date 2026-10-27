// One round: ensure the warm sandbox, sync every repository of the round,
// build the workspace (one worktree per repository plus an AGENTS.md
// index), run Maki headless at the workspace root through maki-oss, collect
// each repository's changes, and remove the workspace again — also after a
// failure, and before starting when a lost round left one behind.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAbort, RoundAborted, tail } from "./exec.ts";
import { repoDir, workspacePath, worktreePath } from "./names.ts";
import { sandboxSh, type Ctx } from "./openshell.ts";
import { interpretRun, StageError, type RoundResult } from "./result.ts";
import { CALLER_ENV, ensureSandbox } from "./sandbox.ts";
import { syncRefs, type SyncStats } from "./sync.ts";
import { collectChanges, type Changes } from "./collect.ts";

export interface RepoSpec {
  key: string; // workspace subdir and sandbox repository name
  hostRepo: string; // host repository: local clone or bare mirror
  base: string; // branch name, delivered as refs/remotes/origin/<base>
  branches: string[]; // the task's own branches, delivered with the base
  allBranches: boolean; // also every other branch and tag
}

export interface RoundSpec {
  sandbox: string;
  providers: string[];
  taskId: string;
  repos: RepoSpec[];
  prompt: string;
  model?: string;
  timeoutSec: number;
  collect: boolean; // false for read-only rounds: changes are discarded
  agentsMd?: string; // workspace-root index; default lists the repositories
  signal?: AbortSignal; // stops Maki in the sandbox (by its run tag) and the round
  commitMessage?: (answer: string) => string | undefined; // message for leftovers, from the answer
}

export interface RepoOutcome {
  key: string;
  sync?: SyncStats; // absent when the round failed before this repository synced
  changes: Changes | null; // null when nothing was collected
}

export interface RoundOutcome {
  result: RoundResult;
  repos: RepoOutcome[];
}

// The client backstop fires only if the in-sandbox timeout never returns.
const BACKSTOP_SEC = 30;

// $1 repo, $2 path, $3 base, $4 task id. -B resets a re-run task's branch.
const ADD_WORKTREE = `git -C "$1" worktree add -q -B "task-$4" "$2" "refs/remotes/origin/$3"`;

// $1 workspace, then repository dirs. Removes each repository's worktree in
// the workspace, then the workspace itself. Also drops local branches no
// remaining worktree has checked out: an agent's `git checkout <b>` creates
// refs/heads/<b> from origin/<b>, and a later task checking out <b> would
// otherwise get that stale copy instead of the freshly synced ref.
const REMOVE_WORKSPACE = `ws=$1
shift
for repo in "$@"; do
    [ -d "$repo" ] || continue
    wt="$ws/\${repo##*/}"
    git -C "$repo" worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"
    git -C "$repo" worktree prune
    busy=$(git -C "$repo" worktree list --porcelain | sed -n 's/^branch //p')
    git -C "$repo" for-each-ref --format='%(refname)' refs/heads | while read -r ref; do
        printf '%s\\n' "$busy" | grep -qxF "$ref" || git -C "$repo" update-ref -d "$ref"
    done
done
rm -rf "$ws"`;

const WRITE_FILE = `mkdir -p "$1" && cat > "$1/$2"`;

// $1 run tag. maki-oss's timeout wrapper watches this file and stops the
// run itself: a separate exec cannot find the run's processes (it may not
// read their environment), but the wrapper can.
const STOP_RUN = `mkdir -p /tmp/maki-oss-stop && touch "/tmp/maki-oss-stop/$1"`;

export const runTag = (taskId: string) => `oskhs-${taskId}`;

export function defaultAgentsMd(repos: RepoSpec[]): string {
  const lines = ["# Workspace repositories", "", "Each repository is a git worktree in its own subdirectory.", ""];
  for (const r of repos) lines.push(`- \`${r.key}/\` — base branch \`${r.base}\``);
  return lines.join("\n") + "\n";
}

export async function addWorktree(ctx: Ctx, sandbox: string, taskId: string, repo: RepoSpec): Promise<string> {
  const path = worktreePath(taskId, repo.key);
  const out = await sandboxSh(ctx, sandbox, ADD_WORKTREE, [repoDir(repo.key), path, repo.base, taskId]);
  if (out.code !== 0) throw new StageError("worktree", out.code, tail(out.stderr));
  return path;
}

export async function removeWorkspace(ctx: Ctx, sandbox: string, taskId: string, keys: string[]): Promise<void> {
  const out = await sandboxSh(ctx, sandbox, REMOVE_WORKSPACE, [workspacePath(taskId), ...keys.map(repoDir)]);
  if (out.code !== 0) ctx.log(`workspace cleanup for ${taskId} failed (exit ${out.code}): ${tail(out.stderr, 3)}`);
}

export async function runMaki(ctx: Ctx, spec: RoundSpec, workdir: string): Promise<RoundResult> {
  const argv = [ctx.makiOss, "run", "--timeout", String(spec.timeoutSec)];
  if (spec.model) argv.push("--model", spec.model);
  argv.push("--", spec.prompt);
  const tag = runTag(spec.taskId);
  const env: Record<string, string> = { ...CALLER_ENV, MAKI_OSS_SANDBOX_NAME: spec.sandbox, MAKI_OSS_WORKDIR: workdir, MAKI_OSS_RUN_TAG: tag };
  if (spec.providers.length) env.MAKI_OSS_PROVIDERS = spec.providers.join(",");
  if (ctx.gateway) env.MAKI_OSS_GATEWAY = ctx.gateway;
  // An empty cwd: caller mode never uploads it, and if that ever regressed,
  // an empty directory would ship nothing instead of oskhs's own cwd.
  const cwd = await mkdtemp(join(tmpdir(), "oskhs-run-"));
  // Killing the exec client leaves Maki running in the sandbox (OpenShell
  // 0.1.5), so an abort asks the wrapper to stop it; the client then returns.
  const stop = () => void sandboxSh(ctx, spec.sandbox, STOP_RUN, [tag]);
  spec.signal?.addEventListener("abort", stop, { once: true });
  try {
    const out = await ctx.run(argv, { env, cwd, timeoutMs: (spec.timeoutSec + BACKSTOP_SEC) * 1000 });
    if (spec.signal?.aborted) return { kind: "failed", stage: "run", exitCode: out.code, stderr: "aborted" };
    return interpretRun(out, spec.timeoutSec);
  } finally {
    spec.signal?.removeEventListener("abort", stop);
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function runRound(ctx: Ctx, spec: RoundSpec): Promise<RoundOutcome> {
  const repos: RepoOutcome[] = spec.repos.map((r) => ({ key: r.key, changes: null }));
  const keys = spec.repos.map((r) => r.key);
  let started = false;
  try {
    await ensureSandbox(ctx, spec);
    // a workspace left by a lost round would make `worktree add` fail
    await removeWorkspace(ctx, spec.sandbox, spec.taskId, keys);
    started = true;
    for (const [i, repo] of spec.repos.entries()) {
      const branches = [repo.base, ...repo.branches.filter((b) => b !== repo.base)];
      repos[i]!.sync = await syncRefs(ctx, { repo: repo.hostRepo, key: repo.key, sandbox: spec.sandbox, taskId: spec.taskId, branches, allBranches: repo.allBranches });
      await addWorktree(ctx, spec.sandbox, spec.taskId, repo);
    }
    const workdir = workspacePath(spec.taskId);
    const index = await sandboxSh(ctx, spec.sandbox, WRITE_FILE, [workdir, "AGENTS.md"], { stdin: spec.agentsMd ?? defaultAgentsMd(spec.repos) });
    if (index.code !== 0) throw new StageError("worktree", index.code, tail(index.stderr));
    ctx.log(`round ${spec.taskId} in ${spec.sandbox}:${workdir} (${keys.join(", ")})`);
    if (spec.signal?.aborted) return { result: { kind: "failed", stage: "run", exitCode: 0, stderr: "aborted" }, repos };
    const result = await runMaki(ctx, spec, workdir);
    if (result.kind !== "answer" || !spec.collect) return { result, repos };
    // collected before the worktrees (and their branches) are removed
    for (const [i, repo] of spec.repos.entries()) {
      checkAbort(spec.signal); // a cancel after one repository's collect stops the next
      const tips = repos[i]!.sync!.tips;
      repos[i]!.changes = await collectChanges(ctx, {
        repo: repo.hostRepo,
        key: repo.key,
        sandbox: spec.sandbox,
        taskId: spec.taskId,
        baseTip: tips[`refs/heads/${repo.base}`]!,
        prerequisites: [...new Set(Object.values(tips))],
        commitMessage: spec.commitMessage?.(result.text),
        signal: spec.signal,
      });
    }
    return { result, repos };
  } catch (err) {
    if (err instanceof RoundAborted) return { result: { kind: "failed", stage: "collect", exitCode: 0, stderr: "aborted" }, repos };
    if (err instanceof StageError) return { result: { kind: "failed", stage: err.stage, exitCode: err.exitCode, stderr: err.stderr }, repos };
    throw err;
  } finally {
    if (started) await removeWorkspace(ctx, spec.sandbox, spec.taskId, keys);
  }
}
