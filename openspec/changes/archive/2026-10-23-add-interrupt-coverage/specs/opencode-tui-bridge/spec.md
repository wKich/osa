# Spec Delta

## ADDED Requirements

### Requirement: Accept an interrupt without claiming the child stopped
The bridge SHALL accept `POST /api/session/{sessionID}/interrupt` for an open
session and answer `200` with `interrupted` set to `false`, because the pinned
Maki wire's cancellation subtype is not sent. The bridge MUST answer `404`
`SessionNotFoundError` for an unknown session. It MUST NOT write a
`control_request` with subtype `interrupt` — or any other cancellation frame —
to the Maki child. An in-flight turn SHALL continue to its normal result, and
the bridge MUST NOT emit `session.execution.interrupted`.

#### Scenario: Interrupt is accepted and reports no interruption
- **WHEN** the TUI interrupts a session whose turn is still running
- **THEN** the route answers `200` with `{interrupted:false}` and the route
  makes no claim that the running model was stopped

#### Scenario: The child is not cancelled
- **WHEN** an interrupt is accepted during an in-flight turn
- **THEN** the Maki child receives no `interrupt` control request or other
  cancellation frame, the turn reaches `session.execution.succeeded`, and no
  `session.execution.interrupted` frame is emitted

#### Scenario: An unknown session is not a silent success
- **WHEN** the interrupt route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and no frame is
  written to any child
