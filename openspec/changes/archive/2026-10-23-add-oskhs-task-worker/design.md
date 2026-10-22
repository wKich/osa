# Design

## Context

kiss's task document is the hand-off point. The bot creates and schedules
tasks; an executor claims one, keeps a heartbeat, writes the result, and ends
its runtime; the bot's status sync posts replies by `state` vs
`notificationState`. B1.3a added `executor: 'oskhs'` and documented the
contract an external executor follows (kiss `AGENTS.md`).

## Explore findings (kiss origin/master + B1.3a branch, 2026-10-23)

1. A no-MR answer is `replyMessage` plus `state: 'completed'`;
   `MattermostTaskSource.syncTaskStatuses` (every 5 s) posts it in the thread
   via `TaskStatusNotifier.notifyCompleted` and moves `notificationState`.
   `state: 'closed'` with `errorMessage` posts a failure.
2. Thread follow-ups are `AgentSubTask` documents (`thread_instruction`, state
   `pending → processing → completed|error`, `reply`) plus a `requestWake` on
   the parent. kiss posts `completed`/`error` sub-tasks itself
   (`flushPendingThreadReplies`). A woken task whose sub-tasks stay `pending`
   is re-woken by reconcile every minute (`stoppedWithWork`), so an executor
   must drain or fail every pending sub-task it is woken for.
3. Cancellation (`/stop`, admin) sets `cancelRequestedAt`, clears the wake,
   and for a live runtime waits for the executor to call the equivalent of
   `markCancelFinished` (`cancelledAt`, `idle_stopped`, `wakeRequestedAt:
   null`). kiss's heartbeat interval is 60 s; cancel is noticed on the next
   heartbeat.
4. KHS's claim filter: `state ∈ processing|review|completed|closed`,
   `runtimeState ∈ queued|failed`, `wakeRequestedAt ≤ now`, no cancel,
   retry window open, `runtimeStartFailures < 4`; sort `wakeRequestedAt,
   createdAt`.
5. The `mongodb` driver (6.x) connects to the dev stand's Mongo from Bun, and
   Bun can import kiss's `src/models/AgentTask.ts` / `AgentSubTask.ts`
   (resolving mongoose from kiss's `node_modules`): schemas, enums, and
   `validateSync` are usable in oskhs tests without importing kiss services.

## Decisions

1. **Identity.** `agentHostId = OSKHS_HOST_ID ?? oskhs-<hostname>`; it is how a
   restarted worker recognizes its own in-flight tasks.
2. **Claim.** KHS's filter (finding 4) plus `executor: 'oskhs'` and
   `projectId: { $nin: <projects at cap> }`, setting `runtimeState:
   'running'`, `agentHostId`, `lastRuntimeHeartbeatAt`, `wakeRequestedAt:
   null`, same sort. The worker claims only while below its global cap.
3. **Work selection after claim.**
   - restricted project (`networkRestrictionProfileId` set) → refuse;
   - `state: 'processing'` → first round on `prompt`, written as
     `replyMessage` + `state: 'completed'` (cancel-gated);
   - then every pending `thread_instruction` sub-task (claimed
     `pending → processing` one by one) → round → `completed` + `reply`;
     other sub-task types → `error` with "not supported by oskhs yet";
   - finally `runtimeState: 'idle_stopped'`, `idleStoppedAt`, CAS on
     `agentHostId` + `running`.
4. **Round.** An injected `(input, signal) => Promise<{ text } | { error }>`;
   this slice ships `echoRound` (`echo: <prompt>` after an optional delay)
   so cancel and kill can be exercised mid-round. B1.3c swaps in the sandbox
   round.
5. **Heartbeat and cancel watch.** Every `--heartbeat-sec` (default 20) the
   heartbeat update runs with `cancelRequestedAt: null` and `runtimeState ∉
   stopping|idle_stopped` in the filter; every `--cancel-poll-sec` (default 3)
   a read checks `cancelRequestedAt`. Either signal aborts the round's
   `AbortSignal`; a cancel then finishes as `markCancelFinished`.
6. **Failures.** A round error or timeout on the first round → `state:
   'closed'`, `errorMessage`, `runtimeState: 'failed'` (cancel-gated) — kiss
   posts it as a failure. On a sub-task → that sub-task `error`.
7. **Restricted network.** `state: 'closed'`, `errorMessage` naming the
   reason, `runtimeState: 'failed'`, `runtimeStartFailures: 4`, no wake: the
   claim filter never picks it again and the user sees why.
8. **Restart recovery.** On start, tasks with `executor: 'oskhs'`,
   `agentHostId: me`, `runtimeState: 'running'` were lost mid-round. Each is
   requeued (`failed` + wake, `runtimeStartFailures + 1`) unless it already
   lost 2 rounds, in which case it is closed with a visible error. Sub-tasks
   left `processing` by the lost round go back to `pending`. Graceful
   shutdown (SIGINT/SIGTERM) aborts rounds and requeues without counting.
9. **Caps and limits.** `--max-rounds` (default 2) per worker,
   `--max-per-project` (default 1) — one sandbox per project, so this is the
   per-sandbox cap; `--round-timeout` (default 600 s) per round.
10. **Logs.** `${XDG_STATE_HOME:-~/.local/state}/oskhs/tasks/<task-id>.jsonl`,
    one JSON event per line (`claimed`, `round-start`, `round-end`,
    `heartbeat-lost`, `cancelled`, `refused`, `recovered`, `idle`), never a
    credential. B1.3c appends sandbox logs and Maki's result there.
11. **Contract tests.** With `KISS_REPO` set (default `../../yourpapai/kiss`
    when present, else skipped with a message), every update oskhs builds is
    applied to a document and checked with kiss's `validateSync`, and every
    enum value oskhs writes is checked against kiss's schema.

## Open questions resolved

- *Keep the runtime alive for follow-ups like KHS does?* No: oskhs ends each
  wake with `idle_stopped`; kiss wakes it again for the next sub-task.
- *What if oskhs is down?* Marked tasks wait `queued` (like KHS being down);
  a task oskhs held when it died is requeued by kiss's reconcile after the
  10-minute dead-runtime timeout, or immediately by oskhs's restart recovery.
