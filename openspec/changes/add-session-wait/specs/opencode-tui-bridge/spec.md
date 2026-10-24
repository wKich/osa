## ADDED Requirements

### Requirement: Wait for the session to be idle
`POST /api/experimental/session/{sessionID}/wait` SHALL answer 204 only once
the session has no running turn and no waiting prompt, or its child has
exited, and SHALL answer 404 `SessionNotFoundError` for an unknown session.

#### Scenario: Wait outlasts the running turn
- **WHEN** the TUI waits while a turn runs
- **THEN** the answer arrives after that turn's `session.execution.succeeded`
