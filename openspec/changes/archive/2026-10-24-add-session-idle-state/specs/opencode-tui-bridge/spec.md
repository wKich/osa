## ADDED Requirements

### Requirement: Track the session's idle transition
The bridge SHALL set a session's `time.idle` and `outcome` at every terminal
execution transition it emits (`succeeded`, `failed`, `interrupted` other
than a shutdown), before the frame is sent, with `time.idle` equal to the
frame's `created` and strictly greater than any earlier value. `GET` session
reads SHALL return `time.idle`, `time.viewed`, and `outcome` once set.
`POST /api/session/{sessionID}/view` SHALL answer 204, set `time.viewed` to
the given `idle` and emit `session.viewed` only when the session has an idle
transition, the watermark is not newer than it, and it is newer than the
current `time.viewed`; a non-numeric `idle` SHALL answer 400.

#### Scenario: A finished run reads as unread
- **WHEN** a run ends and the TUI re-reads the session
- **THEN** the read carries `outcome: "succeeded"` and `time.idle` equal to
  the terminal frame's `created`, with no `time.viewed`

#### Scenario: Viewing acknowledges once
- **WHEN** the TUI posts `view` with the current `time.idle` twice
- **THEN** `time.viewed` equals it and exactly one `session.viewed` is emitted

#### Scenario: A later run is unread again
- **WHEN** another run ends after a view
- **THEN** `time.idle` is greater than `time.viewed`
