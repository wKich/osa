// kiss's task-document protocol as oskhs speaks it (B1.3b, design in
// add-oskhs-task-worker). Pure builders: every filter and update the worker
// sends, so tests can check them against kiss's own schema. Field meanings
// follow kiss's AgentTask/AgentSubTask models and the external-executor
// contract in kiss AGENTS.md. kiss's mongoose models keep `updatedAt` with
// timestamps; the raw driver does not, so every $set carries it.

export const EXECUTOR = "oskhs";
export const TASKS = "agenttasks";
export const SUBTASKS = "agentsubtasks";
export const PROJECTS = "projects";

/** kiss gives up on a task after this many failed starts (KHS uses the same bound). */
export const MAX_START_FAILURES = 4;
/** oskhs closes a task visibly once it lost this many rounds to its own crashes. */
export const MAX_LOST_ROUNDS = 3;

export type Doc = Record<string, unknown>;
export interface Update {
  $set: Doc;
}

/** KHS's claim filter (kiss KissHostService.claimTask) plus the executor clause. */
export function claimFilter(now: Date, saturatedProjects: unknown[] = []): Doc {
  const filter: Doc = {
    state: { $in: ["processing", "review", "completed", "closed"] },
    runtimeState: { $in: ["queued", "failed"] },
    wakeRequestedAt: { $ne: null, $lte: now },
    cancelRequestedAt: null,
    executor: EXECUTOR,
    $and: [
      { $or: [{ runtimeRetryAfter: null }, { runtimeRetryAfter: { $lte: now } }] },
      { $or: [{ runtimeStartFailures: { $exists: false } }, { runtimeStartFailures: { $lt: MAX_START_FAILURES } }] },
    ],
  };
  if (saturatedProjects.length) filter.projectId = { $nin: saturatedProjects };
  return filter;
}

export const CLAIM_SORT = { wakeRequestedAt: 1, createdAt: 1 } as const;

export function claimUpdate(now: Date, hostId: string): Update {
  return { $set: { runtimeState: "running", agentHostId: hostId, lastRuntimeHeartbeatAt: now, wakeRequestedAt: null, updatedAt: now } };
}

/** kiss `updateHeartbeatUnlessStopped`: never revives a stopping or stopped runtime. */
export function heartbeatFilter(taskId: string): Doc {
  return { _id: taskId, cancelRequestedAt: null, runtimeState: { $nin: ["stopping", "idle_stopped"] } };
}

// Unlike kiss's container heartbeat, runtimeStartFailures is not reset here:
// oskhs counts rounds lost to its own crashes in it (design decision 8).
export function heartbeatUpdate(now: Date): Update {
  return { $set: { runtimeState: "running", runtimeRetryAfter: null, lastRuntimeHeartbeatAt: now, updatedAt: now } };
}

/** kiss `updateFieldsUnlessCancelling`: result writes lose to a cancel. */
export const unlessCancelling = (taskId: string): Doc => ({ _id: taskId, cancelRequestedAt: null });

export function answerUpdate(now: Date, text: string): Update {
  return { $set: { state: "completed", replyMessage: text, errorMessage: null, lastMeaningfulActivityAt: now, updatedAt: now } };
}

/** kiss's mergeRequestsCreated handler: MR fields per repository, then review. */
export function reviewUpdate(
  now: Date,
  repos: Doc[],
  mrs: { projectPath: string; mrUrl: string; mrIid: number; branchName: string }[],
  reply: string,
  taskDescription: string | null,
): Update {
  const taskRepositories = repos.map((repo) => {
    const mrPath = (repo.upstreamProjectPath as string | undefined) ?? (repo.projectPath as string);
    const mr = mrs.find((m) => m.projectPath === mrPath);
    return mr ? { ...repo, mrUrl: mr.mrUrl, mrIid: mr.mrIid, branchName: mr.branchName } : repo;
  });
  return {
    $set: {
      taskRepositories,
      ...(taskDescription ? { taskDescription } : {}),
      replyMessage: reply || null,
      state: "review",
      errorMessage: null,
      lastMeaningfulActivityAt: now,
      updatedAt: now,
    },
  };
}

export function failureUpdate(now: Date, message: string): Update {
  return { $set: { state: "closed", errorMessage: message, runtimeState: "failed", lastMeaningfulActivityAt: now, updatedAt: now } };
}

/** Fail-closed refusal: never claimed again (start failures at kiss's cap), no wake. */
export function refusalUpdate(now: Date, message: string): Update {
  return {
    $set: {
      state: "closed",
      errorMessage: message,
      runtimeState: "failed",
      runtimeStartFailures: MAX_START_FAILURES,
      wakeRequestedAt: null,
      lastRuntimeHeartbeatAt: null,
      lastMeaningfulActivityAt: now,
      updatedAt: now,
    },
  };
}

export const ownRunning = (taskId: string, hostId: string): Doc => ({ _id: taskId, agentHostId: hostId, runtimeState: "running" });

export function idleUpdate(now: Date): Update {
  return { $set: { runtimeState: "idle_stopped", idleStoppedAt: now, runtimeStartFailures: 0, updatedAt: now } };
}

/** kiss `markCancelFinished`. */
export const cancelFinishFilter = (taskId: string): Doc => ({ _id: taskId, cancelRequestedAt: { $ne: null } });
export function cancelFinishUpdate(now: Date): Update {
  return { $set: { cancelledAt: now, runtimeState: "idle_stopped", wakeRequestedAt: null, updatedAt: now } };
}

/** Back into kiss's queue for a re-claim (kiss `scheduleRecovery` shape). */
export function requeueUpdate(now: Date, startFailures: number): Update {
  return {
    $set: {
      runtimeState: "failed",
      wakeRequestedAt: now,
      runtimeStartFailures: startFailures,
      lastExternalActivityAt: now,
      idleStoppedAt: null,
      updatedAt: now,
    },
  };
}

export const ownRunningTasks = (hostId: string): Doc => ({ executor: EXECUTOR, agentHostId: hostId, runtimeState: "running" });

// Sub-tasks (kiss AgentSubTaskService).
export const pendingSubTask = (taskId: string): Doc => ({ taskId, state: "pending" });
export const SUBTASK_SORT = { createdAt: 1 } as const;
export const processingSubTasks = (taskId: string): Doc => ({ taskId, state: "processing" });
export const subTaskClaimUpdate = (now: Date): Update => ({ $set: { state: "processing", updatedAt: now } });
export const subTaskResetUpdate = (now: Date): Update => ({ $set: { state: "pending", updatedAt: now } });
export const subTaskCompleteUpdate = (now: Date, reply: string): Update => ({
  $set: { state: "completed", reply, completedAt: now, updatedAt: now },
});
export const subTaskErrorUpdate = (now: Date, message: string): Update => ({
  $set: { state: "error", errorMessage: message, completedAt: now, updatedAt: now },
});

export const RESTRICTED_MESSAGE =
  "oskhs does not run tasks of projects with a network restriction profile yet; unmark the channel or remove the profile.";
export const unsupportedSubTaskMessage = (type: string) => `oskhs does not handle '${type}' follow-ups yet.`;
export const lostRoundsMessage = (n: number) => `oskhs lost this task's round ${n} times (worker restarts); giving up.`;
