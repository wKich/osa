## ADDED Requirements

### Requirement: Report sessions with a turn in flight as active
The bridge SHALL answer `GET /api/session/active` with every session whose
Maki child has a turn in flight mapped to `{type: "running"}`, and with no
entry for an idle session. A reconnecting TUI SHALL then show a running
session busy, with its interrupt control.

#### Scenario: Running only while the turn runs
- **WHEN** one session has a prompt whose turn is still running and another
  session is idle
- **THEN** the active map holds only the running session as
  `{type: "running"}`, and after the turn's result the map is empty
