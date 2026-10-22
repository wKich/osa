// Project, sandbox, and task naming (design decision 3).
import { basename, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export function projectName(repoPath: string): string {
  const raw = basename(resolve(repoPath)).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const name = raw.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!name) throw new Error(`cannot derive a project name from '${repoPath}'`);
  return name;
}

export const sandboxName = (project: string) => `repo-${project}`;

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

// Sandbox layout (design decision 2).
export const REPO_DIR = "/sandbox/repo";
export const TASKS_DIR = "/sandbox/tasks";
export const IN_DIR = "/sandbox/.oskhs/in";
export const OUT_DIR = "/sandbox/.oskhs/out";
export const worktreePath = (taskId: string) => `${TASKS_DIR}/${checkTaskId(taskId)}`;
