## MODIFIED Requirements

### Requirement: Forward an interrupt to the Maki child
The bridge SHALL answer `POST /api/session/{sessionID}/interrupt` for an open
session. When a turn is in flight, it MUST write one `control_request` with
subtype `interrupt` (the pinned Maki wire's cancellation message) to that
session's child and answer `200` with `interrupted` set to `true`. When no turn
is in flight, it MUST answer `200` with `interrupted` set to `false` and write
nothing to the child. A permission ask still pending when the interrupt arrives
MUST be answered `deny` before the interrupt is written and reported to the TUI
as `permission.replied` with reply `reject`. The interrupted turn's result
SHALL end the execution with `session.execution.interrupted` and reason
`user`, never `session.execution.succeeded` or `session.execution.failed`.
The bridge MUST answer `404` `SessionNotFoundError` for an unknown session.

#### Scenario: An idle session is a no-op
- **WHEN** the TUI interrupts a session with no turn in flight
- **THEN** the route answers `200` with `{interrupted:false}` and no frame is
  written to the child

#### Scenario: An in-flight turn is cancelled
- **WHEN** the TUI interrupts a session whose turn is still running
- **THEN** the route answers `200` with `{interrupted:true}`, the child
  receives exactly one `control_request` with subtype `interrupt`, and the turn
  ends with one `session.execution.interrupted` frame with reason `user` and
  neither a succeeded nor a failed execution frame

#### Scenario: A parked permission ask is settled first
- **WHEN** the TUI interrupts a turn that is waiting on a permission ask
- **THEN** the child receives a `deny` answer for that ask before the
  `interrupt` request, the TUI sees `permission.replied` with reply `reject`,
  and the session's pending permission list is empty

#### Scenario: The session keeps working
- **WHEN** a new prompt is sent after an interrupted turn
- **THEN** the turn runs to `session.execution.succeeded` and a later interrupt
  of the idle session answers `{interrupted:false}`

#### Scenario: An unknown session is not a silent success
- **WHEN** the interrupt route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and no frame is
  written to any child

#### Scenario: The interrupted step reads as interrupted
- **WHEN** an interrupted turn's error result arrives
- **THEN** the bridge emits `session.step.failed` with error
  `{type: "aborted", message: "Step interrupted"}` and no usage, then
  `session.execution.interrupted`, and the TUI footer marks the turn
  `interrupted`

