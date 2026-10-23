# Spec Delta

## ADDED Requirements

### Requirement: Queue a prompt sent while a turn runs
The bridge SHALL admit a prompt posted while the session's turn is still
running and write it to the Maki child at once, but SHALL start its turn
(`session.execution.started` and `session.step.started` with a new assistant
message) only after the running turn's result, in admission order, preceded by
`session.inbox.delivered` for that item. Because the pinned Maki SDK answers
each stdin prompt in its own later run and offers no delivery into a running
one, a prompt requested with delivery `steer` MUST be reported as queued: the
`session.inbox.enqueued` item keeps the requested delivery, the bridge emits
`session.inbox.delivery.changed` with delivery `queue`, and the route's
admitted item carries delivery `queue`. A prompt requested with `queue`
SHALL emit no delivery change. A prompt on an idle session SHALL start its
turn at once with its requested delivery and no `session.inbox.delivered`.
When the child exits with a turn in flight, every prompt still queued behind
it SHALL be reported with `session.inbox.cancelled` and SHALL NOT start a
turn.

#### Scenario: A steer prompt mid-turn is queued
- **WHEN** the TUI posts a `steer` prompt while a turn runs
- **THEN** the route answers `200` with delivery `queue`, the bridge emits
  `session.inbox.delivery.changed` with delivery `queue`, and no second
  `session.execution.started` appears before the running turn succeeds

#### Scenario: The queued turn runs next with its own message
- **WHEN** the running turn's result arrives
- **THEN** the bridge emits `session.inbox.delivered` for the queued item,
  then the queued turn's `session.execution.started` and
  `session.step.started`, and the queued turn's parts carry a different
  assistant message id from the first turn's

#### Scenario: A prompt on an idle session is unchanged
- **WHEN** the TUI posts a prompt with no turn running
- **THEN** the turn starts at once with the requested delivery and no
  delivery change or delivered frame is emitted

#### Scenario: A queued prompt is cancelled when the child dies
- **WHEN** the child exits while a turn runs and a prompt is queued behind it
- **THEN** the running turn fails, the queued item gets one
  `session.inbox.cancelled`, and no turn starts for it
