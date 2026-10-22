# Spec Delta

## ADDED Requirements

### Requirement: Claiming marked tasks
The oskhs worker SHALL claim kiss tasks with a single compare-and-set whose
filter is KHS's claim filter plus `executor: 'oskhs'`, and SHALL set
`runtimeState: 'running'`, its own `agentHostId`, `lastRuntimeHeartbeatAt`,
and `wakeRequestedAt: null`. It SHALL NOT claim while at its global round cap,
and SHALL NOT claim a task whose project is at the per-project cap. The Mongo
connection string SHALL come from the oskhs host's environment and SHALL
never be passed to a sandbox.

#### Scenario: Only marked tasks are claimed
- **WHEN** one marked and one unmarked task are due
- **THEN** the worker claims the marked one and leaves the unmarked one untouched

#### Scenario: Project cap
- **WHEN** a project already has `--max-per-project` rounds running and another of its tasks is due
- **THEN** the worker does not claim it until a round of that project ends

### Requirement: Heartbeat and cancellation
While a claimed task is running, the worker SHALL refresh its heartbeat with
an update filtered on `cancelRequestedAt: null` and a runtime state other
than `stopping`/`idle_stopped`, at an interval well inside kiss's
dead-runtime timeout, and SHALL check for cancellation every few seconds.
On cancellation it SHALL abort the round and finish the cancel by setting
`cancelledAt`, `runtimeState: 'idle_stopped'`, and `wakeRequestedAt: null`,
without writing any result.

#### Scenario: Cancel mid-round
- **WHEN** `cancelRequestedAt` is set while a round is running
- **THEN** the round is aborted within seconds, `cancelledAt` is set, `runtimeState` is `idle_stopped`, and no `replyMessage` is written

#### Scenario: Heartbeat keeps the task alive
- **WHEN** a round runs longer than several heartbeat intervals
- **THEN** `lastRuntimeHeartbeatAt` advances on each interval and reconcile never treats the task as dead

### Requirement: Results in kiss's format
For a claimed task in `state: 'processing'` the worker SHALL run one round
on its prompt and write the answer as `replyMessage` with `state:
'completed'`; a failed or timed-out first round SHALL write `state:
'closed'` with an `errorMessage`. Every pending `thread_instruction` sub-task
SHALL be claimed (`pending → processing`), answered by a round, and set to
`completed` with `reply` (or `error` with `errorMessage`); sub-task types
oskhs does not support SHALL be set to `error` with a message saying so.
Afterwards the worker SHALL set `runtimeState: 'idle_stopped'` and
`idleStoppedAt`. All result writes SHALL be skipped when a cancel arrived.

#### Scenario: Echo reply posted by kiss
- **WHEN** a marked Mattermost task is processed by the echo round
- **THEN** the task ends `completed` with `replyMessage` set and `idle_stopped`, and kiss's status sync posts the reply in the source thread

#### Scenario: Follow-up sub-task
- **WHEN** a marked task is woken with a pending `thread_instruction` sub-task
- **THEN** the sub-task ends `completed` with a reply and the parent's `state` is unchanged

#### Scenario: Unsupported sub-task
- **WHEN** a marked task is woken with a pending `gitlab_review_comment` sub-task
- **THEN** that sub-task ends `error` with a message naming oskhs, and the task is not re-woken by it

### Requirement: Restricted network is refused fail-closed
The worker SHALL refuse a claimed task whose project has a network
restriction profile: `state: 'closed'`, an `errorMessage` stating that
restricted-network tasks are not supported by oskhs, `runtimeState:
'failed'`, `runtimeStartFailures: 4`, and no wake, so it is never claimed
again and the user sees the reason.

#### Scenario: Restricted project
- **WHEN** a marked task's project has `networkRestrictionProfileId` set
- **THEN** no round runs and the task is closed with that error

### Requirement: Round limits and task logs
Every round SHALL have a time limit (`--round-timeout`, default 600 s); a
round that exceeds it SHALL be aborted and reported as a timeout. The worker
SHALL write one JSON-lines log per task id under its state directory,
recording claim, round start and end, cancel, refusal, recovery, and idle
events, and SHALL never write a credential there.

#### Scenario: Round timeout
- **WHEN** a round takes longer than its limit
- **THEN** it is aborted and the task is closed with an error naming the timeout

#### Scenario: Log by task id
- **WHEN** a task was processed
- **THEN** `<state dir>/oskhs/tasks/<task-id>.jsonl` holds its events in order

### Requirement: Recovery of the worker's own tasks
On start the worker SHALL find tasks marked `oskhs` that it holds as
`running` (its `agentHostId`) and SHALL requeue each (`runtimeState:
'failed'`, a wake, `runtimeStartFailures` incremented, its `processing`
sub-tasks back to `pending`), or — after the task already lost two rounds —
close it with a visible error. On SIGINT/SIGTERM the worker SHALL abort its
rounds and requeue their tasks without counting a failure.

#### Scenario: Killed mid-round, restarted
- **WHEN** the worker is killed during a round and started again
- **THEN** the task is requeued, claimed again, and completed; it never stays `running` without a live worker

#### Scenario: Repeated losses end visibly
- **WHEN** a task was lost mid-round three times
- **THEN** it is closed with an error instead of being requeued again

### Requirement: Contract with kiss's schema
oskhs's tests SHALL validate every document shape the worker writes against
kiss's own mongoose schemas when the kiss repository is available, and SHALL
skip with a message otherwise.

#### Scenario: Schema drift is caught
- **WHEN** kiss renames a runtime state oskhs writes
- **THEN** the contract test fails
