# Spec Delta

## MODIFIED Requirements

### Requirement: Heartbeat and cancellation
While a claimed task is running, the worker SHALL refresh its heartbeat with
an update filtered on `cancelRequestedAt: null` and a runtime state other
than `stopping`/`idle_stopped`, at an interval well inside kiss's
dead-runtime timeout, and SHALL check for cancellation every few seconds.
On cancellation it SHALL abort the round and finish the cancel by setting
`cancelledAt`, `runtimeState: 'idle_stopped'`, and `wakeRequestedAt: null`,
without writing any result. The abort SHALL also reach every external side
effect of the round: after cancellation no branch push, ref update, or merge
request SHALL be started, and an in-flight GitLab or git call SHALL be
bounded by a timeout and checked before its next step.

#### Scenario: Cancel mid-round
- **WHEN** `cancelRequestedAt` is set while a round is running
- **THEN** the round is aborted within seconds, `cancelledAt` is set, `runtimeState` is `idle_stopped`, and no `replyMessage` is written

#### Scenario: Cancel during publication
- **WHEN** cancellation arrives while the round is pushing a branch or waiting to create a merge request
- **THEN** no new push or merge request is started, the task is finished as cancelled or requeued, and no result is written

#### Scenario: Heartbeat keeps the task alive
- **WHEN** a round runs longer than several heartbeat intervals
- **THEN** `lastRuntimeHeartbeatAt` advances on each interval and reconcile never treats the task as dead
