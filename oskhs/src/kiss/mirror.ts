// Bare mirrors of kiss repositories on the oskhs host, fetched from GitLab
// (B1.4). A mirror's refspec is +refs/*:refs/*, so a pruning fetch deletes
// any ref GitLab lacks — the collected refs/heads/oskhs/<task> branch is
// pushed and dropped within the round that made it.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tail } from "../exec.ts";
import type { Ctx } from "../openshell.ts";
import { gitAuthEnv, repoUrl, type GitLabConfig } from "./gitlab.ts";

export class MirrorError extends Error {}

export const mirrorPath = (mirrorDir: string, projectPath: string) => join(mirrorDir, `${projectPath}.git`);

async function git(ctx: Ctx, args: string[], env: Record<string, string>, what: string) {
  const out = await ctx.run(["git", ...args], { env });
  if (out.code !== 0) throw new MirrorError(`${what} failed (exit ${out.code}): ${tail(out.stderr, 4)}`);
  return out;
}

/** Clones the mirror when missing, else points it at GitLab over HTTPS and fetches. */
export async function refreshMirror(ctx: Ctx, gitlab: GitLabConfig, mirrorDir: string, projectPath: string): Promise<string> {
  const path = mirrorPath(mirrorDir, projectPath);
  const url = repoUrl(gitlab, projectPath);
  const env = gitAuthEnv(gitlab.token);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    await git(ctx, ["clone", "-q", "--mirror", url, path], env, `cloning ${projectPath}`);
    ctx.log(`cloned mirror ${projectPath}`);
  } else {
    await git(ctx, ["-C", path, "remote", "set-url", "origin", url], env, `setting the remote of ${projectPath}`);
    await git(ctx, ["-C", path, "fetch", "-q", "--prune", "origin"], env, `fetching ${projectPath}`);
  }
  return path;
}

/**
 * Pushes a collected branch under its GitLab name, then drops the local ref.
 * To the URL, not `origin`: a mirror's origin has `mirror = true`, which
 * refuses a push with a refspec.
 */
export async function pushBranch(ctx: Ctx, gitlab: GitLabConfig, mirror: string, projectPath: string, localRef: string, branch: string, force = false): Promise<void> {
  const env = gitAuthEnv(gitlab.token);
  await git(ctx, ["-C", mirror, "push", "-q", repoUrl(gitlab, projectPath), `${force ? "+" : ""}${localRef}:refs/heads/${branch}`], env, `pushing ${branch}`);
  await git(ctx, ["-C", mirror, "update-ref", "-d", localRef], env, `dropping ${localRef}`);
}
