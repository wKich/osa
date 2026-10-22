# Proposal

## Why

Roadmap slice B1.3b. kiss now marks tasks for an external executor
(`AgentTask.executor: 'oskhs'`, kiss branch `feat/oskhs-executor-marker`,
B1.3a) and KHS leaves them alone — so nothing runs them yet. oskhs must speak
kiss's task-document protocol from outside any sandbox: claim, heartbeat,
cancellation, state and result writes, follow-up sub-tasks, and recovery
after its own crash. This slice builds that protocol with an echo round, so
the protocol is proven before a real sandbox round (B1.3c) depends on it.

## What Changes

- `oskhs worker`: a long-running queue worker against kiss's MongoDB
  (`OSKHS_MONGO_URI`, held only by the oskhs host process; nothing reaches a
  sandbox in this slice).
- Protocol, mirroring kiss's in-container `TaskExecutor` and KHS:
  - claim CAS: KHS's filter plus `executor: 'oskhs'`, excluding projects at
    their round cap;
  - heartbeat with the cancel and not-stopping gates
    (`updateHeartbeatUnlessStopped` semantics) and a fast cancel watch;
  - first round of a `processing` task → `replyMessage` + `state:
    'completed'` (kiss's status sync posts it); pending `thread_instruction`
    sub-tasks → `reply` + `completed`; other sub-task types fail with a
    message; then `idle_stopped`;
  - cancellation → round aborted, cancel finished as `markCancelFinished`;
  - a project with a network restriction profile → refused fail-closed
    (visible error, no retry).
- Round time limit; caps on concurrent rounds per project (= per sandbox) and
  per worker; per-task JSONL logs under the oskhs state dir.
- On start, oskhs resolves tasks it still holds as `running`: requeued for
  re-claim, or closed with a visible error after repeated losses.
- Contract tests load kiss's own mongoose schemas (`KISS_REPO`) and validate
  every document shape oskhs writes.

## Capabilities

### New Capabilities

- `oskhs-worker`: the kiss task-document protocol as spoken by oskhs.

### Modified Capabilities

(none — `oskhs-round` is untouched; the echo stands in for it)

## Impact

- New: `oskhs/src/kiss/*.ts` (protocol), `oskhs/src/worker.ts`,
  `oskhs/src/tasklog.ts`, CLI `worker`, tests; dependency `mongodb` (the
  official driver; Bun runs it unchanged).
- Docs: `docs/oskhs.md`, `docs/roadmap.md`.
- Relies on kiss's documented external-executor contract (kiss `AGENTS.md`,
  "Внешний исполнитель задач (oskhs)").
