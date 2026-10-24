## ADDED Requirements

### Requirement: Fork a whole session
`POST /api/session/{sessionID}/fork` without `before` SHALL open a new session
whose Maki child continues the parent's stored Maki session under a new id,
whose transcript is the parent's settled messages, whose title is the
parent's with the ` (fork #N)` suffix, and whose `fork` field names the
parent; the bridge SHALL emit `session.forked` and answer the new session.
With `before`, an unknown message SHALL answer 404 `MessageNotFoundError` and a
known one 400 `InvalidRequestError`, since the pinned child cannot cut a
session's history; an empty session SHALL answer 400.

#### Scenario: The full fork continues the conversation
- **WHEN** the user forks a session with two exchanges as Full session and
  prompts in the fork
- **THEN** the fork's tab shows the copied exchanges and the new reply comes
  from the forked child

#### Scenario: A cut fork is refused
- **WHEN** the TUI forks before an earlier message
- **THEN** the bridge answers 400 and opens no session
