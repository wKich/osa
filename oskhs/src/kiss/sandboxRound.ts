// The worker's real round (B1.3c): a kiss task becomes a read-only round in
// the project's warm sandbox, one worktree per task repository, synced from
// the host's bare mirrors; Maki's answer becomes the reply kiss posts.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tail } from "../exec.ts";
import { checkTaskId, projectName, repoSubdir, sandboxName } from "../names.ts";
import type { Ctx } from "../openshell.ts";
import { runRound, type RepoSpec } from "../round.ts";
import type { Round, RoundReply } from "../worker.ts";
import { agentsMd, buildTaskPrompt, type PromptTask } from "./prompt.ts";
import { replyText } from "./result.ts";

export interface SandboxRoundConfig {
  ctx: Ctx;
  mirrorDir: string; // <mirrorDir>/<project path>.git, bare mirrors (B1.4 fetches them)
  providers: string[];
  model?: string;
  agentName: string; // the identity line's @name (kiss: GITLAB_USER_NAME)
}

interface TaskRepository {
  projectPath: string;
  worktreeSubdir?: string | null;
  description?: string | null;
  branchName?: string | null;
}

export const mirrorPath = (mirrorDir: string, projectPath: string) => join(mirrorDir, `${projectPath}.git`);

/** The mirror's default branch: its HEAD. */
async function defaultBranch(ctx: Ctx, mirror: string): Promise<string | null> {
  const out = await ctx.run(["git", "-C", mirror, "symbolic-ref", "--short", "HEAD"]);
  return out.code === 0 ? out.stdout.trim() : null;
}

export function sandboxFor(project: { _id?: unknown; title?: string | null } | null, fallback: string): string {
  try {
    return sandboxName(projectName(project?.title || String(project?._id ?? fallback)));
  } catch {
    return sandboxName(projectName(fallback));
  }
}

export function sandboxRound(cfg: SandboxRoundConfig): Round {
  return async (input, signal): Promise<RoundReply> => {
    const { task } = input;
    const taskRepos = (task.taskRepositories as TaskRepository[] | undefined) ?? [];
    const repos: (RepoSpec & { projectPath: string; description?: string | null })[] = [];
    for (const r of taskRepos) {
      const mirror = mirrorPath(cfg.mirrorDir, r.projectPath);
      if (!existsSync(mirror)) return { ok: false, error: `oskhs has no mirror of ${r.projectPath} (expected ${mirror})` };
      const base = r.branchName || (await defaultBranch(cfg.ctx, mirror));
      if (!base) return { ok: false, error: `oskhs cannot read the default branch of ${mirror}` };
      repos.push({ key: repoSubdir(r.projectPath, r.worktreeSubdir), hostRepo: mirror, base, branches: [], allBranches: false, projectPath: r.projectPath, description: r.description });
    }
    // a follow-up's prompt was already built by kiss
    const prompt = input.subTask ? input.prompt : buildTaskPrompt(task as unknown as PromptTask, cfg.agentName);
    const { result } = await runRound(cfg.ctx, {
      sandbox: sandboxFor(input.project, String(task.projectId ?? task._id)),
      providers: cfg.providers,
      taskId: checkTaskId(task._id),
      repos,
      prompt,
      model: cfg.model,
      timeoutSec: input.timeoutSec,
      collect: false, // B1.3c rounds are read-only; B1.4 lands changes
      agentsMd: agentsMd(repos),
      signal,
    });
    switch (result.kind) {
      case "answer":
        return { ok: true, text: replyText(result.text) };
      case "agent-error":
        return { ok: false, error: `Maki reported an error: ${result.message}` };
      case "timeout":
        return { ok: false, error: `round timed out after ${result.seconds}s` };
      case "failed":
        return { ok: false, error: `oskhs round failed at ${result.stage} (exit ${result.exitCode}): ${tail(result.stderr, 5)}` };
    }
  };
}
