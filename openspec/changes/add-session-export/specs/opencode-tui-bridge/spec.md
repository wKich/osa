## ADDED Requirements

### Requirement: Export the session transcript
`GET /api/experimental/session/{sessionID}/export` SHALL answer `{data: {info,
messages}}` with the session read and its settled projected messages oldest
first, SHALL redact text, tool input and output, titles, metadata, and the
session directory when `sanitize=true` as the pinned transfer does, and SHALL
answer 404 `SessionNotFoundError` for an unknown session.

#### Scenario: Copying the transcript copies the real exchange
- **WHEN** the user runs "Copy session transcript" after a PONG exchange
- **THEN** the export the TUI formats carries the prompt and PONG, not a
  synthesized sample

#### Scenario: A sanitized export carries no content
- **WHEN** the export is requested with `sanitize=true`
- **THEN** every prompt and reply text is `[redacted:<kind>:<id>]`
