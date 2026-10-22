// Per-task JSON-lines logs (design decision 10): one file per kiss task id
// under the oskhs state dir, so everything about a task is findable by its
// id. Callers pass only values oskhs produced (states, counts, messages it
// wrote); never a credential, never the Mongo URI.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkTaskId } from "./names.ts";

export type TaskLog = (taskId: string, event: string, details?: Record<string, unknown>) => void;

export function defaultLogDir(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_STATE_HOME || join(homedir(), ".local/state"), "oskhs/tasks");
}

export function fileTaskLog(dir: string): TaskLog {
  mkdirSync(dir, { recursive: true });
  return (taskId, event, details = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...details });
    appendFileSync(join(dir, `${checkTaskId(taskId)}.jsonl`), line + "\n");
  };
}
