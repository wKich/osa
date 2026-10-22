// The worker's real round (B1.3c): a kiss task becomes a read-only round in
// the project's warm sandbox, one worktree per task repository, synced from
// the host's bare mirrors; Maki's answer becomes the reply kiss posts.
import { existsSync } from "node:fs";
import { tail } from "../exec.ts";
import { checkTaskId, projectName, repoSubdir, sandboxName } from "../names.ts";
import { sandboxSh, type Ctx } from "../openshell.ts";
import { runRound, type RepoSpec } from "../round.ts";
import { ensureSandbox } from "../sandbox.ts";
import { ensureModelProvider, ModelError, pinSandboxProvider, planModel, providerStateFile, type KissModelProvider } from "./model.ts";
import type { Round, RoundReply } from "../worker.ts";
import { agentsMd, buildCodeTaskPrompt, buildTaskPrompt, type PromptTask } from "./prompt.ts";
import { parseResultFields, replyText } from "./result.ts";
import { MirrorError, mirrorPath, refreshMirror } from "./mirror.ts";
import type { GitLabConfig } from "./gitlab.ts";
import { commitTitle, publish } from "./publish.ts";

export interface SandboxRoundConfig {
  ctx: Ctx;
  mirrorDir: string; // <mirrorDir>/<project path>.git, bare mirrors (B1.4 fetches them)
  providers: string[]; // fallback for a task without modelProvider
  model?: string; // fallback for a task without modelProvider
  agentName: string; // the identity line's @name (kiss: GITLAB_USER_NAME)
  internalModels: boolean; // this gateway reaches kiss's internal models
  stateDir: string; // oskhs state: provider fingerprints
  gitlab?: GitLabConfig; // mirrors fetched from GitLab and MRs; without it, hand-made mirrors and read-only rounds
}

// $1 Maki's config dir in the sandbox (HOME is /sandbox in the image).
const WRITE_MAKI_CONFIG = `mkdir -p "$1" && cat > "$1/providers.toml"`;
export const MAKI_CONFIG_DIR = "/sandbox/.config/maki";

interface TaskRepository {
  projectPath: string;
  worktreeSubdir?: string | null;
  description?: string | null;
  branchName?: string | null;
}


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
      if (cfg.gitlab) {
        try {
          await refreshMirror(cfg.ctx, cfg.gitlab, cfg.mirrorDir, r.projectPath);
        } catch (err) {
          if (err instanceof MirrorError) return { ok: false, error: `oskhs mirror of ${r.projectPath}: ${err.message}` };
          throw err;
        }
      }
      const mirror = mirrorPath(cfg.mirrorDir, r.projectPath);
      if (!existsSync(mirror)) return { ok: false, error: `oskhs has no mirror of ${r.projectPath} (expected ${mirror})` };
      const base = r.branchName || (await defaultBranch(cfg.ctx, mirror));
      if (!base) return { ok: false, error: `oskhs cannot read the default branch of ${mirror}` };
      repos.push({ key: repoSubdir(r.projectPath, r.worktreeSubdir), hostRepo: mirror, base, branches: [], allBranches: false, projectPath: r.projectPath, description: r.description });
    }
    const sandbox = sandboxFor(input.project, String(task.projectId ?? task._id));
    const mp = task.modelProvider as KissModelProvider | null | undefined;
    let providers = cfg.providers;
    let model = cfg.model;
    if (mp) {
      if (mp.isExternal === false && !cfg.internalModels) {
        return { ok: false, error: `model '${mp.id}' is internal (isExternal: false); this oskhs worker runs without --internal-models, its gateway does not reach it` };
      }
      try {
        const plan = planModel(mp, sandbox.replace(/^repo-/, ""));
        await ensureModelProvider(cfg.ctx, plan, mp.apiKey!, providerStateFile(cfg.stateDir));
        providers = [plan.providerName];
        model = plan.modelSpec;
        await ensureSandbox(cfg.ctx, { sandbox, providers });
        await pinSandboxProvider(cfg.ctx, sandbox, plan.providerName);
        const wrote = await sandboxSh(cfg.ctx, sandbox, WRITE_MAKI_CONFIG, [MAKI_CONFIG_DIR], { stdin: plan.makiConfig });
        if (wrote.code !== 0) return { ok: false, error: `oskhs could not write Maki's provider config (exit ${wrote.code})` };
      } catch (err) {
        if (err instanceof ModelError) return { ok: false, error: `oskhs model setup: ${err.message}` };
        throw err;
      }
    } else if (!model) {
      return { ok: false, error: "the task has no model provider and the worker has no --model" };
    }
    // Code rounds: a first round of a task that may change code, with GitLab to
    // publish to. Follow-ups stay read-only until B3.
    const code = !input.subTask && task.readOnly !== true && !!cfg.gitlab;
    // a follow-up's prompt was already built by kiss
    const prompt = input.subTask
      ? input.prompt
      : code
        ? buildCodeTaskPrompt(task as unknown as PromptTask, cfg.agentName)
        : buildTaskPrompt(task as unknown as PromptTask, cfg.agentName);
    const { result, repos: outcomes } = await runRound(cfg.ctx, {
      sandbox,
      providers,
      taskId: checkTaskId(task._id),
      repos,
      prompt,
      model,
      timeoutSec: input.timeoutSec,
      collect: code,
      commitMessage: (answer) => commitTitle(parseResultFields(answer), String(task._id)),
      agentsMd: agentsMd(repos),
      signal,
    });
    switch (result.kind) {
      case "answer": {
        const text = replyText(result.text);
        const changed = outcomes.filter((o) => o.changes);
        if (!code || !changed.length) return { ok: true, text };
        const fields = parseResultFields(result.text);
        try {
          const mrs = await publish({
            ctx: cfg.ctx,
            gitlab: cfg.gitlab!,
            mirrorDir: cfg.mirrorDir,
            taskId: String(task._id),
            taskPrompt: task.prompt,
            taskBranchName: task.taskBranchName as string | null | undefined,
            authorUsername: task.authorUsername as string | null | undefined,
            source: task.source as string | null | undefined,
            fields,
            repos: changed.map((o) => {
              const spec = repos.find((r) => r.key === o.key)!;
              return { projectPath: spec.projectPath, base: spec.base, changes: o.changes! };
            }),
          });
          return { ok: true, text, mrs, taskDescription: fields.Description?.trim() || null };
        } catch (err) {
          return { ok: false, error: `oskhs could not publish the changes: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      case "agent-error":
        return { ok: false, error: `Maki reported an error: ${result.message}` };
      case "timeout":
        return { ok: false, error: `round timed out after ${result.seconds}s` };
      case "failed":
        return { ok: false, error: `oskhs round failed at ${result.stage} (exit ${result.exitCode}): ${tail(result.stderr, 5)}` };
    }
  };
}
