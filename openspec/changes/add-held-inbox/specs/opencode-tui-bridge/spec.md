## MODIFIED Requirements

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
turn at once with its requested delivery, preceded by
`session.inbox.delivered` for that item.
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

#### Scenario: A prompt on an idle session is delivered at once
- **WHEN** the TUI posts a prompt with no turn running
- **THEN** the turn starts at once with the requested delivery, a delivered
  frame for the item precedes its assistant text, and no delivery change is
  emitted

#### Scenario: A queued prompt is cancelled when the child dies
- **WHEN** the child exits while a turn runs and a prompt is queued behind it
- **THEN** the running turn fails, the queued item gets one
  `session.inbox.cancelled`, and no turn starts for it

#### Scenario: A waiting prompt can be listed and cancelled
- **WHEN** two prompts wait behind a running turn and the user deletes the
  first from the Queued prompts dialog
- **THEN** `GET /api/session/{sessionID}/inbox` listed both in delivery order,
  the delete emits `session.inbox.cancelled` for the first, the child never
  receives it, and only the second runs after the current turn

#### Scenario: Steering a waiting prompt is a conflict
- **WHEN** the TUI patches a waiting prompt's delivery to `steer`
- **THEN** the bridge answers 409 `ConflictError` and the prompt stays queued;
  patching it to `queue` answers 204

### Requirement: Answer deferred session read surfaces without fabricating rows
The bridge SHALL answer the pinned session read routes it does not implement
from Maki — forms (`GET /api/session/{id}/form`) — and the message history
of a session with no turn yet and the inbox of a session with no waiting
prompt, with the pinned contract's success shape and an empty `data` list,
so a synthesized sample message, inbox item, or form never reaches the TUI as
a phantom transcript row. For a session id the bridge does not know, each route
SHALL answer `404` with `SessionNotFoundError` instead of an empty success.

#### Scenario: Deferred read surfaces stay empty
- **WHEN** the TUI reads a live session's forms, or the message history or
  inbox of a session with no turn or waiting prompt, through the bridge
- **THEN** each route answers `200` with a schema-valid body whose `data` list
  is empty, and the bridge emits no event frame for the read

#### Scenario: An unknown session is not an empty success
- **WHEN** the TUI reads message history, inbox, or forms for a session id the
  bridge does not know
- **THEN** each route answers `404` with `SessionNotFoundError` rather than a
  `200` empty list
