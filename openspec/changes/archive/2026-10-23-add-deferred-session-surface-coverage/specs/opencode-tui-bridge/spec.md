# Spec Delta

## ADDED Requirements

### Requirement: Answer deferred session read surfaces without fabricating rows
The bridge SHALL answer the pinned session read routes it does not implement
from Maki — message history (`GET /api/session/{id}/message`), inbox
(`GET /api/session/{id}/inbox`), and forms (`GET /api/session/{id}/form`) —
with the pinned contract's success shape and an empty `data` list, so a
synthesized sample message, inbox item, or form never reaches the TUI as a
phantom transcript row. For a session id the bridge does not know, each route
SHALL answer `404` with `SessionNotFoundError` instead of an empty success.

#### Scenario: Deferred read surfaces stay empty
- **WHEN** the TUI reads a live session's message history, inbox, or forms
  through the bridge
- **THEN** each route answers `200` with a schema-valid body whose `data` list
  is empty, and the bridge emits no event frame for the read

#### Scenario: An unknown session is not an empty success
- **WHEN** the TUI reads message history, inbox, or forms for a session id the
  bridge does not know
- **THEN** each route answers `404` with `SessionNotFoundError` rather than a
  `200` empty list
