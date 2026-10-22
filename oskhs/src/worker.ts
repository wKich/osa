// The oskhs queue worker (B1.3b, design in add-oskhs-task-worker): claims
// marked kiss tasks, keeps their heartbeat, runs one round per prompt or
// follow-up, and writes results the way kiss's in-container executor does.
// The round itself is injected; this slice ships `echoRound`.
import * as p from "./kiss/protocol.ts";
import type { ProjectDoc, SubTaskDoc, TaskDoc, TaskStore } from "./kiss/store.ts";
import type { TaskLog } from "./tasklog.ts";

export interface RoundInput {
  task: TaskDoc;
  project: ProjectDoc | null;
  prompt: string;
  subTask?: SubTaskDoc;
  timeoutSec: number;
}

export type RoundReply = { ok: true; text: string } | { ok: false; error: string };

export type Round = (input: RoundInput, signal: AbortSignal) => Promise<RoundReply>;

export interface WorkerOptions {
  hostId: string;
  maxRounds: number;
  maxPerProject: number;
  roundTimeoutSec: number;
  heartbeatSec: number;
  cancelPollSec: number;
  abortGraceSec: number; // how long an aborted round may take to clean up
  log: TaskLog;
  info: (msg: string) => void;
}

type AbortReason = "cancelled" | "stopped" | "shutdown";

interface Active {
  projectKey: string;
  controller: AbortController;
  done: Promise<void>;
}

const abortable = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Echo stand-in for the sandbox round (B1.3c replaces it). */
export const echoRound =
  (delaySec = 0): Round =>
  async (input, signal) => {
    if (delaySec) await abortable(delaySec * 1000, signal);
    if (signal.aborted) return { ok: false, error: "aborted" };
    return { ok: true, text: `echo: ${input.prompt}` };
  };

export class Worker {
  private readonly active = new Map<string, Active>();

  constructor(
    private readonly store: TaskStore,
    private readonly round: Round,
    private readonly opts: WorkerOptions,
  ) {}

  get running(): number {
    return this.active.size;
  }

  /** Tasks this worker still holds as running were lost with a previous process. */
  async recover(): Promise<void> {
    for (const task of await this.store.ownRunning(this.opts.hostId)) {
      const now = new Date();
      const own = p.ownRunning(task._id, this.opts.hostId);
      if (task.cancelRequestedAt) {
        await this.store.updateTask(p.cancelFinishFilter(task._id), p.cancelFinishUpdate(now));
        this.opts.log(task._id, "recovered", { action: "cancel-finished" });
        continue;
      }
      const lost = (task.runtimeStartFailures ?? 0) + 1;
      await this.store.resetSubTasks(task._id);
      if (lost >= p.MAX_LOST_ROUNDS) {
        await this.store.updateTask(own, p.refusalUpdate(now, p.lostRoundsMessage(lost)));
        this.opts.log(task._id, "recovered", { action: "closed", lost });
      } else {
        await this.store.updateTask(own, p.requeueUpdate(now, lost));
        this.opts.log(task._id, "recovered", { action: "requeued", lost });
      }
      this.opts.info(`recovered task ${task._id} (lost rounds: ${lost})`);
    }
  }

  private saturatedProjects(): string[] {
    const counts = new Map<string, number>();
    for (const a of this.active.values()) counts.set(a.projectKey, (counts.get(a.projectKey) ?? 0) + 1);
    return [...counts].filter(([, n]) => n >= this.opts.maxPerProject).map(([k]) => k);
  }

  /** Claims and starts at most one task; true if one was claimed. */
  async tick(): Promise<boolean> {
    if (this.active.size >= this.opts.maxRounds) return false;
    const saturatedKeys = new Set(this.saturatedProjects());
    const saturated = [...this.projectIds.entries()].filter(([k]) => saturatedKeys.has(k)).map(([, id]) => id);
    const task = await this.store.claim(this.opts.hostId, saturated);
    if (!task) return false;
    const projectKey = String(task.projectId ?? "");
    this.projectIds.set(projectKey, task.projectId);
    const controller = new AbortController();
    const done = this.handle(task, controller)
      .catch((err) => this.opts.info(`task ${task._id}: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => this.active.delete(task._id));
    this.active.set(task._id, { projectKey, controller, done });
    return true;
  }

  private readonly projectIds = new Map<string, unknown>();

  /** Waits for every running task to finish. */
  async drain(): Promise<void> {
    await Promise.all([...this.active.values()].map((a) => a.done));
  }

  /** SIGINT/SIGTERM: abort rounds, requeue their tasks without counting a loss. */
  async shutdown(): Promise<void> {
    for (const a of this.active.values()) a.controller.abort("shutdown" satisfies AbortReason);
    await this.drain();
  }

  private async handle(task: TaskDoc, controller: AbortController): Promise<void> {
    const { log, hostId } = this.opts;
    const id = task._id;
    const own = p.ownRunning(id, hostId);
    log(id, "claimed", { state: task.state, runtimeState: "running" });
    const abort = (reason: AbortReason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const heartbeat = setInterval(async () => {
      try {
        const outcome = await this.store.heartbeat(id);
        if (outcome === "cancelled") abort("cancelled");
        else if (outcome === "stopped") abort("stopped");
      } catch (err) {
        log(id, "heartbeat-error", { message: err instanceof Error ? err.message : String(err) });
      }
    }, this.opts.heartbeatSec * 1000);
    const cancelWatch = setInterval(async () => {
      try {
        if (await this.store.isCancelling(id)) abort("cancelled");
      } catch {
        // the next heartbeat reports a persistent failure
      }
    }, this.opts.cancelPollSec * 1000);
    try {
      const project = await this.store.project(task.projectId);
      if (project?.networkRestrictionProfileId) {
        await this.store.updateTask(own, p.refusalUpdate(new Date(), p.RESTRICTED_MESSAGE));
        log(id, "refused", { reason: "restricted-network" });
        return;
      }
      // we own the task now, so any processing sub-task is an orphan of a lost round
      await this.store.resetSubTasks(id);
      if (task.state === "processing") {
        const reply = await this.runRound({ task, project, prompt: task.prompt, timeoutSec: this.opts.roundTimeoutSec }, controller.signal);
        if (controller.signal.aborted) return;
        const now = new Date();
        if (reply.ok) {
          await this.store.updateTask(p.unlessCancelling(id), p.answerUpdate(now, reply.text));
        } else {
          await this.store.updateTask(p.unlessCancelling(id), p.failureUpdate(now, reply.error));
          return;
        }
      }
      for (;;) {
        if (controller.signal.aborted) return;
        const sub = await this.store.claimSubTask(id);
        if (!sub) break;
        if (sub.type !== "thread_instruction") {
          await this.store.updateSubTask(sub._id, p.subTaskErrorUpdate(new Date(), p.unsupportedSubTaskMessage(sub.type)));
          log(id, "subtask-unsupported", { subTaskId: sub._id, type: sub.type });
          continue;
        }
        const reply = await this.runRound(
          { task, project, prompt: sub.prompt, subTask: sub, timeoutSec: this.opts.roundTimeoutSec },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        await this.store.updateSubTask(
          sub._id,
          reply.ok ? p.subTaskCompleteUpdate(new Date(), reply.text) : p.subTaskErrorUpdate(new Date(), reply.error),
        );
      }
      await this.store.updateTask(own, p.idleUpdate(new Date()));
      log(id, "idle");
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancelWatch);
      const reason = controller.signal.reason as AbortReason | undefined;
      const now = new Date();
      if (reason === "shutdown") {
        await this.store.resetSubTasks(id);
        await this.store.updateTask(own, p.requeueUpdate(now, task.runtimeStartFailures ?? 0));
        log(id, "requeued", { reason: "shutdown" });
      } else if (reason === "stopped") {
        log(id, "stopped-externally");
      } else if (reason === "cancelled" || (await this.store.isCancelling(id).catch(() => false))) {
        // a cancel also wins when it landed after the last watch tick: every
        // result write above was gated on it, so finish it here
        await this.store.updateTask(p.cancelFinishFilter(id), p.cancelFinishUpdate(now));
        log(id, "cancelled");
      }
    }
  }

  private async runRound(input: RoundInput, signal: AbortSignal): Promise<RoundReply> {
    const { log } = this.opts;
    const id = input.task._id;
    log(id, "round-start", { subTaskId: input.subTask?._id, timeoutSec: input.timeoutSec });
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort("timeout"), input.timeoutSec * 1000);
    const combined = AbortSignal.any([signal, limit.signal]);
    const timedOut = new Promise<RoundReply>((resolve) =>
      limit.signal.addEventListener("abort", () => resolve({ ok: false, error: `round timed out after ${input.timeoutSec}s` }), { once: true }),
    );
    const parentAborted = new Promise<RoundReply>((resolve) =>
      signal.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }), { once: true }),
    );
    const running = this.round(input, combined);
    try {
      const reply = await Promise.race([running, timedOut, parentAborted]);
      if (combined.aborted) {
        // let the round stop its work and clean up (the sandbox round stops
        // Maki and removes the workspace) before the task is released
        await Promise.race([running.catch(() => undefined), Bun.sleep(this.opts.abortGraceSec * 1000)]);
      }
      log(id, "round-end", { subTaskId: input.subTask?._id, ok: reply.ok, ...(reply.ok ? { chars: reply.text.length } : { error: reply.error }) });
      return reply;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(id, "round-end", { subTaskId: input.subTask?._id, ok: false, error });
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
    }
  }
}
