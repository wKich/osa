## MODIFIED Requirements

### Requirement: Answer deferred session read surfaces without fabricating rows
The bridge SHALL answer the pinned session read routes it does not implement
from Maki — inbox (`GET /api/session/{id}/inbox`) and forms
(`GET /api/session/{id}/form`) — and the message history of a session with no
turn yet, with the pinned contract's success shape and an empty `data` list,
so a synthesized sample message, inbox item, or form never reaches the TUI as
a phantom transcript row. For a session id the bridge does not know, each route
SHALL answer `404` with `SessionNotFoundError` instead of an empty success.

#### Scenario: Deferred read surfaces stay empty
- **WHEN** the TUI reads a live session's inbox or forms, or the message
  history of a session with no turn yet, through the bridge
- **THEN** each route answers `200` with a schema-valid body whose `data` list
  is empty, and the bridge emits no event frame for the read

#### Scenario: An unknown session is not an empty success
- **WHEN** the TUI reads message history, inbox, or forms for a session id the
  bridge does not know
- **THEN** each route answers `404` with `SessionNotFoundError` rather than a
  `200` empty list

## ADDED Requirements

### Requirement: Serve the session's message history
The bridge SHALL answer `GET /api/session/{sessionID}/message` with the
session's transcript projected from the frames it emitted: a user message per
delivered prompt, an assistant message per turn carrying its text, reasoning,
and tool parts and its completion, and an idle marker per terminal execution
transition, in emission order. The route SHALL page as the pinned handler
does: newest first by default, `order` `asc` or `desc`, a `type` filter, a
default limit of 50, and opaque cursors naming the boundary message; a
cursor combined with `order`, or an undecodable cursor, SHALL answer 400
`InvalidCursorError`.

#### Scenario: A reopened TUI renders the history
- **WHEN** a session answered `ALPHA`, the TUI restarts, and the user reopens
  the session from the session list
- **THEN** the transcript shows the prompt and `ALPHA` as it did before the
  restart

#### Scenario: Paging follows the cursor
- **WHEN** the TUI reads two messages newest first and follows `cursor.next`
- **THEN** the second page continues with the next older messages
