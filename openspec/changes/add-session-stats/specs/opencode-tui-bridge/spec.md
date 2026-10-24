## ADDED Requirements

### Requirement: Report session statistics from the bridge's sessions
The bridge SHALL answer `GET /api/experimental/session/stats` with the
pinned `SessionStats.Info` aggregated over its own session histories, and
SHALL refuse a range whose start is not before its end.

#### Scenario: A finished turn is counted
- **WHEN** one prompt has run to completion and the TUI opens `/stats`
- **THEN** the page shows one session, one active day and the turn's tokens

#### Scenario: An inverted range is refused
- **WHEN** the route is called with `from` after now
- **THEN** it answers `400`
