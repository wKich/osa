## ADDED Requirements

### Requirement: Title a session the way Maki does
When a session's first Maki run ends, the bridge SHALL title the session with
Maki's rule (`generate_title`, `maki-storage/src/sessions.rs` v0.6.4
L677–L695) applied to the session's first non-empty prompt text, SHALL emit
`session.renamed` with that title, and SHALL return it as `title` from
`GET /api/session` and `GET /api/session/{sessionID}`. Before the first run
ends the session SHALL carry no title.

#### Scenario: A short first prompt becomes the title
- **WHEN** the first prompt is `Reply with the word PONG only.` and its run
  ends
- **THEN** the bridge emits `session.renamed` with title
  `Reply with the word PONG only.` and the session read returns it

#### Scenario: A long first prompt is cut like Maki cuts it
- **WHEN** the first prompt is longer than 60 bytes
- **THEN** the title is cut at the last space past byte 30 within the first 60
  bytes (or at the last char boundary when there is none) and ends with `…`

#### Scenario: Later runs keep the first title
- **WHEN** a second run ends
- **THEN** no further `session.renamed` is emitted
