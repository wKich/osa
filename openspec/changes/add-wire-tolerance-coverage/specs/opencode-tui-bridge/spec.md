# Spec Delta

## ADDED Requirements

### Requirement: Tolerate recorded Maki wire frames with no OpenCode counterpart
The bridge SHALL consume outbound Maki frames it has no OpenCode
representation for — first among them `system{subtype:"api_retry"}` with its
`attempt`, `retry_delay_ms`, and `error` fields (Maki SDK wire v0.6.4) —
without emitting any event frame for them and without disturbing the
in-progress turn: the emitted transcript SHALL be identical to the same turn
replayed without those frames.

#### Scenario: A mid-turn api_retry leaves the transcript undisturbed
- **WHEN** a recorded Maki fixture replays a plain turn with
  `system{subtype:"api_retry"}` frames interleaved between its assistant and
  result frames
- **THEN** the projected frame sequence matches the committed plain-turn
  golden exactly — no extra, dropped, or reordered frames, and the turn still
  ends in `session.execution.succeeded`
