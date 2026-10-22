// The worker's view of kiss's database. `TaskStore` is what the worker needs;
// `MongoTaskStore` speaks it over the official driver with the protocol
// builders. The Mongo URI lives only in this host process.
import { MongoClient, type Collection, type Db } from "mongodb";
import * as p from "./protocol.ts";

export interface TaskDoc {
  _id: string;
  prompt: string;
  state: string;
  runtimeState?: string | null;
  projectId?: unknown;
  runtimeStartFailures?: number;
  cancelRequestedAt?: Date | null;
  [key: string]: unknown;
}

export interface SubTaskDoc {
  _id: string;
  taskId: string;
  type: string;
  prompt: string;
  state: string;
}

export type HeartbeatOutcome = "updated" | "stopped" | "cancelled";

export interface ProjectDoc {
  _id: unknown;
  title?: string | null;
  networkRestrictionProfileId?: unknown;
}

export interface TaskStore {
  claim(hostId: string, saturatedProjects: unknown[]): Promise<TaskDoc | null>;
  heartbeat(taskId: string): Promise<HeartbeatOutcome>;
  isCancelling(taskId: string): Promise<boolean>;
  /** Applies `update` when `filter` matches; true if it did. */
  updateTask(filter: p.Doc, update: p.Update): Promise<boolean>;
  project(projectId: unknown): Promise<ProjectDoc | null>;
  claimSubTask(taskId: string): Promise<SubTaskDoc | null>;
  updateSubTask(subTaskId: string, update: p.Update): Promise<void>;
  resetSubTasks(taskId: string): Promise<number>;
  ownRunning(hostId: string): Promise<TaskDoc[]>;
}

export class MongoTaskStore implements TaskStore {
  private constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
  ) {}

  static async connect(uri: string): Promise<MongoTaskStore> {
    const client = new MongoClient(uri);
    await client.connect();
    return new MongoTaskStore(client, client.db());
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private get tasks(): Collection<TaskDoc> {
    return this.db.collection<TaskDoc>(p.TASKS);
  }

  private get subTasks(): Collection<SubTaskDoc> {
    return this.db.collection<SubTaskDoc>(p.SUBTASKS);
  }

  async claim(hostId: string, saturatedProjects: unknown[]): Promise<TaskDoc | null> {
    const now = new Date();
    return this.tasks.findOneAndUpdate(p.claimFilter(now, saturatedProjects), p.claimUpdate(now, hostId), {
      sort: p.CLAIM_SORT,
      returnDocument: "after",
    });
  }

  async heartbeat(taskId: string): Promise<HeartbeatOutcome> {
    const res = await this.tasks.updateOne(p.heartbeatFilter(taskId), p.heartbeatUpdate(new Date()));
    if (res.matchedCount) return "updated";
    return (await this.isCancelling(taskId)) ? "cancelled" : "stopped";
  }

  async isCancelling(taskId: string): Promise<boolean> {
    return (await this.tasks.countDocuments({ _id: taskId, cancelRequestedAt: { $ne: null } }, { limit: 1 })) > 0;
  }

  async updateTask(filter: p.Doc, update: p.Update): Promise<boolean> {
    return (await this.tasks.updateOne(filter, update)).matchedCount > 0;
  }

  async project(projectId: unknown): Promise<ProjectDoc | null> {
    if (projectId === null || projectId === undefined) return null;
    return this.db.collection<ProjectDoc>(p.PROJECTS).findOne({ _id: projectId as never }, { projection: { title: 1, networkRestrictionProfileId: 1 } });
  }

  async claimSubTask(taskId: string): Promise<SubTaskDoc | null> {
    return this.subTasks.findOneAndUpdate(p.pendingSubTask(taskId), p.subTaskClaimUpdate(new Date()), {
      sort: p.SUBTASK_SORT,
      returnDocument: "after",
    });
  }

  async updateSubTask(subTaskId: string, update: p.Update): Promise<void> {
    await this.subTasks.updateOne({ _id: subTaskId }, update);
  }

  async resetSubTasks(taskId: string): Promise<number> {
    return (await this.subTasks.updateMany(p.processingSubTasks(taskId), p.subTaskResetUpdate(new Date()))).modifiedCount;
  }

  async ownRunning(hostId: string): Promise<TaskDoc[]> {
    return this.tasks.find(p.ownRunningTasks(hostId)).toArray();
  }
}
