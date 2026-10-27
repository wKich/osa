// The worker's real round (B1.3c): a kiss task becomes a read-only round in
// the project's warm sandbox, one worktree per task repository, synced from
// the host's bare mirrors; Maki's answer becomes the reply kiss posts.
import { existsSync } from "node:fs";
import { checkAbort, RoundAborted, tail } from "../exec.ts";
import { checkTaskId, projectName, repoSubdir, sandboxName } from "../names.ts";
import { sandboxSh, type Ctx } from "../openshell.ts";
import { runRound, type RepoSpec } from "../round.ts";
import { ensureSandbox } from "../sandbox.ts";
import { ensureModelProvider, ModelError, pinSandboxProvider, planModel, providerStateFile, type KissModelProvider } from "./model.ts";
import type { Round, RoundInput, RoundReply } from "../worker.ts";
import { agentsMd, buildCodeTaskPrompt, buildTaskPrompt, type PromptTask } from "./prompt.ts";
import { parseResultFields, replyText, reportedNoChanges } from "./result.ts";
import { MirrorError, mirrorPath, refreshMirror } from "./mirror.ts";
import { GitLab, type GitLabConfig } from "./gitlab.ts";
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
  mrIid?: number | null;
}

/** kiss GitLabAgent: a follow-up on a merged or closed MR answers without pushing. */
export const terminalNote = (label: string) => `⚠️ MR уже ${label} — отвечаю на вопрос без внесения изменений.`;
const FOLLOW_UP_COMMIT = "AI Agent: автоматические изменения";

/** kiss getMRsTerminalState: terminal only when every MR is; an unreadable state counts as open. */
async function terminalLabel(api: GitLab, mrs: { projectPath: string; mrIid: number }[]): Promise<string | null> {
  let merged = false;
  let closed = false;
  for (const mr of mrs) {
    const state = await api.mrState(mr.projectPath, mr.mrIid).catch((err) => {
      if (err instanceof RoundAborted) throw err;
      return "opened";
    });
    if (state === "merged") merged = true;
    else if (state === "closed") closed = true;
    else return null;
  }
  return merged && !closed ? "влит" : "закрыт";
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

const ABORTED: RoundReply = { ok: false, error: "aborted" };

export function sandboxRound(cfg: SandboxRoundConfig): Round {
  const attempt = async (input: RoundInput, signal: AbortSignal): Promise<RoundReply> => {
    const { task } = input;
    const taskRepos = (task.taskRepositories as TaskRepository[] | undefined) ?? [];
    const repos: (RepoSpec & { projectPath: string; description?: string | null; target: string })[] = [];
    for (const r of taskRepos) {
      checkAbort(signal);
      if (cfg.gitlab) {
        try {
          await refreshMirror(cfg.ctx, cfg.gitlab, cfg.mirrorDir, r.projectPath, signal);
        } catch (err) {
          if (err instanceof MirrorError) return { ok: false, error: `oskhs mirror of ${r.projectPath}: ${err.message}` };
          throw err;
        }
      }
      const mirror = mirrorPath(cfg.mirrorDir, r.projectPath);
      if (!existsSync(mirror)) return { ok: false, error: `oskhs has no mirror of ${r.projectPath} (expected ${mirror})` };
      // a repository with an MR works on the MR's branch, which targets the default branch
      const target = (!r.mrIid && r.branchName) || (await defaultBranch(cfg.ctx, mirror));
      if (!target) return { ok: false, error: `oskhs cannot read the default branch of ${mirror}` };
      const base = r.mrIid && r.branchName ? r.branchName : target;
      repos.push({ key: repoSubdir(r.projectPath, r.worktreeSubdir), hostRepo: mirror, base, target, branches: [], allBranches: false, projectPath: r.projectPath, description: r.description });
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
    // Code rounds: a task that may change code, with GitLab to publish to.
    // A follow-up commits onto the task's MR branch (kiss: a thread instruction
    // after a Q&A round opens the first MR) — unless every MR is merged or
    // closed, then it only answers.
    const withMR = taskRepos.filter((r) => r.mrIid && r.branchName) as (TaskRepository & { mrIid: number; branchName: string })[];
    const terminal = input.subTask && withMR.length && cfg.gitlab ? await terminalLabel(new GitLab(cfg.gitlab, signal), withMR) : null;
    const code = task.readOnly !== true && !!cfg.gitlab && !terminal;
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
      commitMessage: (answer) => {
        const fields = parseResultFields(answer);
        return input.subTask ? fields.Commit?.trim() || fields.Title?.trim() || FOLLOW_UP_COMMIT : commitTitle(fields, String(task._id));
      },
      agentsMd: agentsMd(repos),
      signal,
    });
    switch (result.kind) {
      case "answer": {
        const text = replyText(result.text);
        const fields = parseResultFields(result.text);
        checkAbort(signal);
        if (terminal) return { ok: true, text: `${text}\n\n${terminalNote(terminal)}` };
        const changed = outcomes.filter((o) => o.changes);
        if (!code || !changed.length || reportedNoChanges(fields)) return { ok: true, text };
        let mrs;
        try {
          mrs = await publish({
            ctx: cfg.ctx,
            gitlab: cfg.gitlab!,
            mirrorDir: cfg.mirrorDir,
            taskId: String(task._id),
            taskPrompt: task.prompt,
            taskBranchName: task.taskBranchName as string | null | undefined,
            authorUsername: task.authorUsername as string | null | undefined,
            source: task.source as string | null | undefined,
            fields,
            signal,
            repos: changed.map((o) => {
              const spec = repos.find((r) => r.key === o.key)!;
              // each repository keeps the branch of its own MR; none → publish picks a new one
              const branchName = withMR.find((r) => r.projectPath === spec.projectPath)?.branchName;
              return { projectPath: spec.projectPath, target: spec.target, changes: o.changes!, branchName };
            }),
          });
        } catch (err) {
          if (err instanceof RoundAborted) throw err;
          return { ok: false, error: `oskhs could not publish the changes: ${err instanceof Error ? err.message : String(err)}` };
        }
        const fresh = mrs.filter((m) => !withMR.some((r) => r.projectPath === m.projectPath));
        const taskDescription = fields.Description?.trim() || null;
        if (!input.subTask) return { ok: true, text, mrs, taskDescription };
        // kiss: a follow-up's reply links the commits it pushed
        const links = changed
          .map((o) => {
            const projectPath = repos.find((r) => r.key === o.key)!.projectPath;
            return `Commit [${o.changes!.head.slice(0, 8)}](${cfg.gitlab!.baseUrl.replace(/\/+$/, "")}/${projectPath}/-/commit/${o.changes!.head})`;
          })
          .join(", ");
        return { ok: true, text: text ? `${text}\n\n${links}` : links, mrs: fresh, taskDescription };
      }
      case "agent-error":
        return { ok: false, error: `Maki reported an error: ${result.message}` };
      case "timeout":
        return { ok: false, error: `round timed out after ${result.seconds}s` };
      case "failed":
        return { ok: false, error: `oskhs round failed at ${result.stage} (exit ${result.exitCode}): ${tail(result.stderr, 5)}` };
    }
  };
  return async (input, signal) => {
    try {
      return await attempt(input, signal);
    } catch (err) {
      // a cancelled round ends quietly: the worker finishes the cancel and writes no result
      if (err instanceof RoundAborted) return ABORTED;
      throw err;
    }
  };
}
