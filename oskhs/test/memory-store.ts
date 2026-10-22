// In-memory TaskStore that evaluates the protocol's own filters and updates,
// so worker tests exercise the same documents MongoTaskStore sends.
import * as p from "../src/kiss/protocol.ts";
import type { HeartbeatOutcome, SubTaskDoc, TaskDoc, TaskStore } from "../src/kiss/store.ts";

type D = Record<string, unknown>;
const cmp = (v: unknown) => (v instanceof Date ? v.getTime() : v !== null && typeof v === "object" ? String(v) : v);
const eq = (a: unknown, b: unknown) => (b === null ? a === null || a === undefined : cmp(a) === cmp(b));
const isOps = (v: unknown): v is D => !!v && typeof v === "object" && !(v instanceof Date) && Object.keys(v).some((k) => k.startsWith("$"));

function ops(a: unknown, o: D): boolean {
  return Object.entries(o).every(([op, arg]) => {
    if (op === "$in") return (arg as unknown[]).some((x) => eq(a, x));
    if (op === "$nin") return !(arg as unknown[]).some((x) => eq(a, x));
    if (op === "$ne") return !eq(a, arg);
    if (op === "$exists") return (a !== undefined) === arg;
    if (a === null || a === undefined) return false;
    const [x, y] = [cmp(a) as number, cmp(arg) as number];
    if (op === "$lt") return x < y;
    if (op === "$lte") return x <= y;
    throw new Error(`unsupported ${op}`);
  });
}

export function matches(doc: D, filter: D): boolean {
  return Object.entries(filter).every(([k, v]) =>
    k === "$and" ? (v as D[]).every((f) => matches(doc, f)) : k === "$or" ? (v as D[]).some((f) => matches(doc, f)) : isOps(v) ? ops(doc[k], v) : eq(doc[k], v),
  );
}

export class MemoryStore implements TaskStore {
  tasks = new Map<string, D>();
  subTasks = new Map<string, D>();
  projects = new Map<string, D>();

  /** A copy: Bun's toMatchObject writes asymmetric matchers into the object it checks. */
  task(id: string): D {
    return { ...this.tasks.get(id)! };
  }
  private apply(map: Map<string, D>, doc: D, update: p.Update) {
    map.set(String(doc._id), { ...doc, ...update.$set });
  }
  private first(map: Map<string, D>, filter: D, sortKeys: string[]): D | undefined {
    const docs = [...map.values()].filter((d) => matches(d, filter));
    docs.sort((a, b) => {
      for (const k of sortKeys) {
        const [x, y] = [cmp(a[k]) as number, cmp(b[k]) as number];
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    });
    return docs[0];
  }

  async claim(hostId: string, saturated: unknown[]): Promise<TaskDoc | null> {
    const now = new Date();
    const doc = this.first(this.tasks, p.claimFilter(now, saturated), Object.keys(p.CLAIM_SORT));
    if (!doc) return null;
    this.apply(this.tasks, doc, p.claimUpdate(now, hostId));
    return this.tasks.get(String(doc._id)) as TaskDoc;
  }
  async heartbeat(taskId: string): Promise<HeartbeatOutcome> {
    if (await this.updateTask(p.heartbeatFilter(taskId), p.heartbeatUpdate(new Date()))) return "updated";
    return (await this.isCancelling(taskId)) ? "cancelled" : "stopped";
  }
  async isCancelling(taskId: string): Promise<boolean> {
    const t = this.tasks.get(taskId);
    return !!t && t.cancelRequestedAt !== null && t.cancelRequestedAt !== undefined;
  }
  async updateTask(filter: D, update: p.Update): Promise<boolean> {
    const doc = [...this.tasks.values()].find((d) => matches(d, filter));
    if (!doc) return false;
    this.apply(this.tasks, doc, update);
    return true;
  }
  async project(projectId: unknown) {
    const doc = this.projects.get(String(projectId));
    return doc ? { _id: projectId, ...doc } : null;
  }
  async claimSubTask(taskId: string): Promise<SubTaskDoc | null> {
    const doc = this.first(this.subTasks, p.pendingSubTask(taskId), Object.keys(p.SUBTASK_SORT));
    if (!doc) return null;
    this.apply(this.subTasks, doc, p.subTaskClaimUpdate(new Date()));
    return this.subTasks.get(String(doc._id)) as unknown as SubTaskDoc;
  }
  async updateSubTask(id: string, update: p.Update): Promise<void> {
    this.apply(this.subTasks, this.subTasks.get(id)!, update);
  }
  async resetSubTasks(taskId: string): Promise<number> {
    const docs = [...this.subTasks.values()].filter((d) => matches(d, p.processingSubTasks(taskId)));
    for (const d of docs) this.apply(this.subTasks, d, p.subTaskResetUpdate(new Date()));
    return docs.length;
  }
  async ownRunning(hostId: string): Promise<TaskDoc[]> {
    return [...this.tasks.values()].filter((d) => matches(d, p.ownRunningTasks(hostId))) as TaskDoc[];
  }
}

export const dueTask = (id: string, over: D = {}): D => ({
  _id: id,
  prompt: `question ${id}`,
  state: "processing",
  runtimeState: "queued",
  wakeRequestedAt: new Date(Date.now() - 1000),
  cancelRequestedAt: null,
  executor: "oskhs",
  projectId: "proj-1",
  createdAt: new Date(),
  ...over,
});
