// Bare mirrors of kiss repositories on the oskhs host, fetched from GitLab
// (B1.4). A mirror's refspec is +refs/*:refs/*, so a pruning fetch deletes
// any ref GitLab lacks — the collected refs/heads/oskhs/<task> branch is
// pushed and dropped within the round that made it.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkAbort, tail } from "../exec.ts";
import type { Ctx } from "../openshell.ts";
import { gitAuthEnv, repoUrl, type GitLabConfig } from "./gitlab.ts";

export class MirrorError extends Error {}

export const mirrorPath = (mirrorDir: string, projectPath: string) => join(mirrorDir, `${projectPath}.git`);

/** Backstop for one clone, fetch, or push: a hung transport must not hold the round. */
export const GIT_TIMEOUT_MS = 10 * 60_000;

async function git(ctx: Ctx, args: string[], env: Record<string, string>, what: string, signal?: AbortSignal) {
  checkAbort(signal);
  const out = await ctx.run(["git", ...args], { env, timeoutMs: GIT_TIMEOUT_MS, signal });
  if (out.code !== 0) {
    checkAbort(signal); // a killed child is a cancellation, not a git failure
    throw new MirrorError(out.timedOut ? `${what} timed out after ${GIT_TIMEOUT_MS / 1000}s` : `${what} failed (exit ${out.code}): ${tail(out.stderr, 4)}`);
  }
  return out;
}

/** Clones the mirror when missing, else points it at GitLab over HTTPS and fetches. */
export async function refreshMirror(ctx: Ctx, gitlab: GitLabConfig, mirrorDir: string, projectPath: string, signal?: AbortSignal): Promise<string> {
  const path = mirrorPath(mirrorDir, projectPath);
  const url = repoUrl(gitlab, projectPath);
  const env = gitAuthEnv(gitlab.token);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    await git(ctx, ["clone", "-q", "--mirror", url, path], env, `cloning ${projectPath}`, signal);
    ctx.log(`cloned mirror ${projectPath}`);
  } else {
    await git(ctx, ["-C", path, "remote", "set-url", "origin", url], env, `setting the remote of ${projectPath}`, signal);
    await git(ctx, ["-C", path, "fetch", "-q", "--prune", "origin"], env, `fetching ${projectPath}`, signal);
  }
  return path;
}

/**
 * Pushes a collected branch under its GitLab name, then drops the local ref.
 * To the URL, not `origin`: a mirror's origin has `mirror = true`, which
 * refuses a push with a refspec. The signal is checked before the push but
 * not handed to it: a push already in flight may complete (killing it
 * halfway would not undo anything), bounded by the git timeout; the local ref
 * is dropped either way.
 */
export async function pushBranch(ctx: Ctx, gitlab: GitLabConfig, mirror: string, projectPath: string, localRef: string, branch: string, force = false, signal?: AbortSignal): Promise<void> {
  const env = gitAuthEnv(gitlab.token);
  checkAbort(signal);
  await git(ctx, ["-C", mirror, "push", "-q", repoUrl(gitlab, projectPath), `${force ? "+" : ""}${localRef}:refs/heads/${branch}`], env, `pushing ${branch}`);
  await git(ctx, ["-C", mirror, "update-ref", "-d", localRef], env, `dropping ${localRef}`);
}
