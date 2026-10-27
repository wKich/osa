// Publishing a code round (B1.4): the collected branch of every changed
// repository goes to GitLab under kiss's branch name and gets a merge
// request shaped like kiss's own (GitLabAgent + GitlabService), assigned to
// the token's user so kiss's GitLabMRTaskSource tracks it.
import { randomUUID } from "node:crypto";
import { checkAbort, RoundAborted } from "../exec.ts";
import type { Changes } from "../collect.ts";
import type { Ctx } from "../openshell.ts";
import { GitLab, type GitLabConfig } from "./gitlab.ts";
import { mirrorPath, pushBranch } from "./mirror.ts";
import { BRANCH_NAME_MAX_LENGTH } from "./prompt.ts";
import { defaultMRDescription, sanitizeBranchName } from "./result.ts";

export interface MRRecord {
  projectPath: string;
  mrUrl: string;
  mrIid: number;
  branchName: string;
}

export interface PublishRepo {
  projectPath: string;
  target: string; // the merge request's target branch
  changes: Changes;
  branchName?: string | null; // this repository's existing MR branch: force-updated as is; absent → a newly chosen one
}

export interface PublishInput {
  ctx: Ctx;
  gitlab: GitLabConfig;
  mirrorDir: string;
  taskId: string;
  taskPrompt: string;
  taskBranchName?: string | null;
  authorUsername?: string | null;
  source?: string | null;
  fields: Record<string, string>; // the [RESULT] fields
  repos: PublishRepo[];
  signal?: AbortSignal; // the round's: no push or MR starts once it aborts
}

export const fallbackBranch = () => `kiss-agent/${randomUUID().slice(0, 8)}`;

/** kiss's order: the /branch directive, else the agent's proposal if free, else kiss-agent/<id>. */
export async function chooseBranch(
  directive: string | null | undefined,
  proposed: string | undefined,
  taken: (branch: string) => Promise<boolean>,
): Promise<string> {
  if (directive) return sanitizeBranchName(directive) || fallbackBranch();
  const suggestion = proposed ? sanitizeBranchName(proposed, BRANCH_NAME_MAX_LENGTH) : "";
  if (suggestion && !(await taken(suggestion))) return suggestion;
  return fallbackBranch();
}

export function mrLabels(field: string | undefined): string[] {
  const labels = (field ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return labels.includes("ai_generated") ? labels : [...labels, "ai_generated"];
}

export const commitTitle = (fields: Record<string, string>, taskId: string) => fields.Title?.trim() || `oskhs: changes from task ${taskId}`;

export async function publish(input: PublishInput): Promise<MRRecord[]> {
  const { signal } = input;
  checkAbort(signal);
  const api = new GitLab(input.gitlab, signal);
  // a repository with an MR keeps its own branch; the others share one new name
  const fresh = input.repos.filter((r) => !r.branchName);
  const newBranch = fresh.length
    ? await chooseBranch(input.taskBranchName, input.fields.Branch, async (b) => {
        for (const r of fresh) if (await api.branchExists(r.projectPath, b)) return true;
        return false;
      })
    : undefined;
  const me = await api.currentUser();
  const reviewer = input.authorUsername ? await api.userId(input.authorUsername.replace(/^@/, "")) : null;
  const title = commitTitle(input.fields, input.taskId);
  const description = [input.fields.Description?.trim() || defaultMRDescription(input.taskPrompt), input.source ? `Источник задачи: ${input.source}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const labels = mrLabels(input.fields.Labels);
  const records: MRRecord[] = [];
  for (const repo of input.repos) {
    const step = (what: string) => `${repo.projectPath}: ${what}`;
    const branch = (repo.branchName || newBranch)!;
    checkAbort(signal);
    try {
      await pushBranch(input.ctx, input.gitlab, mirrorPath(input.mirrorDir, repo.projectPath), repo.projectPath, `refs/heads/${repo.changes.branch}`, branch, !!repo.branchName, signal);
    } catch (err) {
      if (err instanceof RoundAborted) throw err;
      throw new Error(step(`push of ${branch} failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    checkAbort(signal); // an in-flight push may have completed; no MR starts after the abort
    try {
      const reviewerIds = reviewer && (await api.isMember(repo.projectPath, reviewer)) ? [reviewer] : undefined;
      const mr =
        (await api.findOpenMR(repo.projectPath, branch, repo.target)) ??
        (await api.createMR(repo.projectPath, { title, description, source: branch, target: repo.target, labels, assigneeId: me.id, reviewerIds }));
      records.push({ projectPath: repo.projectPath, mrUrl: mr.web_url, mrIid: mr.iid, branchName: branch });
      input.ctx.log(`MR !${mr.iid} for ${repo.projectPath} (${branch} → ${repo.target})`);
    } catch (err) {
      if (err instanceof RoundAborted) throw err;
      throw new Error(step(`merge request failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
  return records;
}
