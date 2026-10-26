// Project, sandbox, and task naming (design decision 3).
import { basename, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

export function projectName(repoPath: string): string {
  const raw = basename(resolve(repoPath)).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const name = raw.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!name) throw new Error(`cannot derive a project name from '${repoPath}'`);
  return name;
}

// OpenShell allows 19 characters; `repo-` leaves 14 for the project. A longer
// project keeps 9 characters plus a hash of the whole name, as the helper
// core fits its own names, so two long titles sharing a prefix still differ.
const SANDBOX_NAME_MAX = 19;
const SANDBOX_PREFIX = "repo-";

export function sandboxName(project: string): string {
  const budget = SANDBOX_NAME_MAX - SANDBOX_PREFIX.length;
  if (project.length <= budget) return `${SANDBOX_PREFIX}${project}`;
  const hash = createHash("sha256").update(project).digest("hex").slice(0, 4);
  const keep = project.slice(0, budget - 5).replace(/-+$/, "");
  return `${SANDBOX_PREFIX}${keep ? `${keep}-` : ""}${hash}`;
}

/** CLI task ids; B1.3b replaces them with kiss task ids. */
export function newTaskId(now = Date.now()): string {
  return `t${now}-${randomBytes(2).toString("hex")}`;
}

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Task ids become paths and branch names inside the sandbox. */
export function checkTaskId(id: string): string {
  if (!TASK_ID.test(id)) throw new Error(`invalid task id '${id}'`);
  return id;
}

// Sandbox layout: one bare repository per kiss repository, one workspace per
// round with a worktree per repository (B1.3c, add-oskhs-sandbox-round).
export const REPOS_DIR = "/sandbox/repos";
export const TASKS_DIR = "/sandbox/tasks";
export const IN_DIR = "/sandbox/.oskhs/in";
export const OUT_DIR = "/sandbox/.oskhs/out";

const SUBDIR = /^[A-Za-z0-9._-]+$/;

/** Repository subdirectories become sandbox paths and file names. */
export function checkSubdir(subdir: string): string {
  if (!SUBDIR.test(subdir) || subdir === "." || subdir === "..") throw new Error(`invalid repository subdir '${subdir}'`);
  return subdir;
}

/** kiss's rule: `worktreeSubdir`, else the project path with `/` → `_`. */
export const repoSubdir = (projectPath: string, worktreeSubdir?: string | null) =>
  checkSubdir(worktreeSubdir || projectPath.replace(/\//g, "_"));

export const repoDir = (subdir: string) => `${REPOS_DIR}/${checkSubdir(subdir)}`;
export const workspacePath = (taskId: string) => `${TASKS_DIR}/${checkTaskId(taskId)}`;
export const worktreePath = (taskId: string, subdir: string) => `${workspacePath(taskId)}/${checkSubdir(subdir)}`;
