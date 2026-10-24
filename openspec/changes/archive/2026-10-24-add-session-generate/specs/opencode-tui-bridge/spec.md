## ADDED Requirements

### Requirement: Answer a side question without touching the session
`POST /api/session/{sessionID}/generate` SHALL answer `{data: {text}}` from a
throwaway Maki child forked from the session's stored Maki session, SHALL deny
every tool ask that child makes, SHALL emit no frame for the session and add
nothing to its history, and SHALL delete the fork from Maki's store once
answered. A failed answer SHALL be 503 `ServiceUnavailableError`.

#### Scenario: A /btw question gets an answer and leaves no trace
- **WHEN** the user asks `/btw What did you reply?` after a PONG exchange
- **THEN** the answer dialog shows the fork's reply, the session's transcript
  is unchanged, and Maki's store lists only the original session
