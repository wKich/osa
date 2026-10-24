# Design

The two segments are the only message-id path parameters the TUI calls in
the vendored contract (`bridge/src/openapi-2.0.32.json`:
`/api/session/{sessionID}/inbox/{inboxID}`,
`/api/session/{sessionID}/message/{messageID}`).
