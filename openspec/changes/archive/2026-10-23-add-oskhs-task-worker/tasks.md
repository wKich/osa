# Tasks

## 1. Protocol

- [x] 1.1 `oskhs/src/kiss/protocol.ts`: pure builders for the claim filter
      and every update (claim, heartbeat, first-round result, failure,
      refusal, idle, cancel finish, requeue, close-after-losses, sub-task
      claim/complete/error/reset); verify unit tests asserting each shape and
      that the claim filter equals KHS's plus the executor clause
- [x] 1.2 Contract test `oskhs/test/kiss-contract.test.ts`: import kiss's
      `AgentTask`/`AgentSubTask` from `KISS_REPO`, validate every builder's
      output with `validateSync` and the enum values; skip with a message
      when kiss is absent; verify `make test-oskhs`
- [x] 1.3 `oskhs/src/kiss/store.ts` over the `mongodb` driver (claim,
      heartbeat outcome `updated|stopped|cancelled`, cancel check, writes);
      verify an integration test against an ephemeral database on the dev
      Mongo when `OSKHS_TEST_MONGO_URI` is set, skipped otherwise

## 2. Worker

- [x] 2.1 `oskhs/src/worker.ts`: claim loop with caps, per-task flow
      (refuse / first round / sub-tasks / idle), heartbeat + cancel watch with
      `AbortSignal`, round timeout, graceful shutdown; `echoRound`; verify
      with an in-memory store fake: answer, follow-up, unsupported sub-task,
      restricted refusal, cancel mid-round, timeout, project cap
- [x] 2.2 Restart recovery and `oskhs/src/tasklog.ts`; verify unit tests for
      requeue, close-after-losses, sub-task reset, and log contents (no
      credential-looking strings)
- [x] 2.3 CLI `oskhs worker [--once] [--max-rounds N] [--max-per-project N]
      [--round-timeout S] [--heartbeat-sec S] [--cancel-poll-sec S]
      [--fake-delay S]`; verify `make test-oskhs`, `bunx tsc --noEmit -p oskhs`

## 3. Live exit (dev stand, kiss on `feat/oskhs-executor-marker`)

- [x] 3.1 Mark the dev channel's project task path: create a marked
      Mattermost-shaped task on a real thread of the dev channel; run the
      worker; verify `completed` + `replyMessage` + `idle_stopped` and the
      orchestrator log shows the thread reply posted; record in
      `evidence/worker-live.md`
- [x] 3.2 Cancel mid-round (`--fake-delay 60`, then the fields kiss's
      `cancelTask` writes); verify `cancelledAt`, `idle_stopped`, no reply,
      within seconds
- [x] 3.3 Kill the worker (SIGKILL) mid-round, restart it; verify the task is
      requeued, re-claimed, and completed, and the task log shows `recovered`
- [x] 3.4 Follow-up: add a pending `thread_instruction` sub-task and wake the
      task as kiss does; verify the sub-task `completed` with a reply and kiss
      posts it

## 4. Docs

- [x] 4.1 `docs/oskhs.md` (worker, protocol, recovery, logs, configuration)
      and roadmap B1.3b done; verify `scripts/check-links.sh docs/oskhs.md
      docs/roadmap.md` and `openspec validate add-oskhs-task-worker --strict`
