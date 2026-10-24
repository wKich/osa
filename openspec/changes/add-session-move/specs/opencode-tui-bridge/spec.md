## ADDED Requirements

### Requirement: Move a session within the sandbox workdir
The bridge SHALL answer `POST /api/session/{sessionID}/move` by resolving the
destination against the session's directory, refusing one that does not
exist, is not a directory, or lies outside the sandbox workdir with
`InvalidRequestError`. For a valid destination it SHALL, after the running
turn, restart the session's Maki child there resuming the same Maki session,
and record a durable `session.moved` with the new location and subpath.

#### Scenario: The next turn runs in the new directory
- **WHEN** the user runs `/cd sub` and then asks for `pwd`
- **THEN** the transcript shows the move, the footer names `<WORKDIR>/sub`,
  and the command prints the `sub` directory

#### Scenario: A file is not a destination
- **WHEN** the move names a file
- **THEN** the route answers `400` with "Not a directory"
