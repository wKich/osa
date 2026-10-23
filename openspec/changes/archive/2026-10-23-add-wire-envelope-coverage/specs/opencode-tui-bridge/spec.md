# Spec Delta

## ADDED Requirements

### Requirement: Keep the child's wire envelope from rebinding the session
Maki wraps every outbound message in a per-message envelope: the variant's
fields plus a top-level `session_id` (`SessionRef`) and a hyphenated UUIDv7
`uuid` (Maki SDK wire v0.6.4). The bridge SHALL accept that envelope on the
frame types it consumes and SHALL continue to address the OpenCode session it
minted for the child: the envelope's `session_id` is transport metadata and
MUST NOT replace or reroute the minted `ses_` id. The bridge MAY record the
id announced on `system.init`, but a frame SHALL NOT be attributed to a
different OpenCode session because of it.

#### Scenario: Captured frames carry the per-message envelope
- **WHEN** the captured Maki fixtures are read
- **THEN** every outbound frame carries a non-empty top-level `session_id` and
  a hyphenated UUID `uuid` beside its variant fields

#### Scenario: The child's envelope does not rebind the session
- **WHEN** a child announces a `session_id` different from the OpenCode
  session's minted `ses_` id and then emits a turn
- **THEN** every emitted event and every durable frame's aggregate stays under
  the minted `ses_` id, and no event adopts the child's id
