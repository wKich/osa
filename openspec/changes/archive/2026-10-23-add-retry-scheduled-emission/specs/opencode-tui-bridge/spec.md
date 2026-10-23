# Spec Delta

## MODIFIED Requirements

### Requirement: Tolerate recorded Maki wire frames with no OpenCode counterpart
The bridge SHALL consume outbound Maki frames it cannot render without
disturbing the in-progress turn: frames with no OpenCode representation SHALL
leave the emitted transcript identical to the same turn replayed without them.
A `system{subtype:"api_retry"}` frame with `attempt`, `retry_delay_ms`, and
`error` (Maki SDK wire v0.6.4) has a pinned OpenCode counterpart and SHALL be
surfaced as one durable `session.retry.scheduled` event carrying the turn's
`assistantMessageID`, the frame's positive `attempt`, an epoch-millisecond
`at`, and the frame's error as `{type, message}`. Retry frames MUST NOT open,
close, or reorder the turn: they add no part frames, the turn still ends with
its single `session.execution.succeeded`, and every frame around them keeps
its order.

#### Scenario: A mid-turn api_retry surfaces as session.retry.scheduled
- **WHEN** a recorded Maki fixture replays a plain turn with two
  `system{subtype:"api_retry"}` frames interleaved between its assistant and
  result frames
- **THEN** exactly two `session.retry.scheduled` events are emitted, in
  arrival order and before the result, each carrying the turn's assistant
  message id, the frame's `attempt`, a non-negative `at`, the frame's error
  message with type `Error`, and a durable envelope aggregated on the session

#### Scenario: A mid-turn api_retry leaves the transcript undisturbed
- **WHEN** the projected frame sequence for that fixture is compared with the
  committed plain-turn golden after excluding `session.retry.scheduled`
- **THEN** the two sequences match exactly — no extra, dropped, or reordered
  part frames — and the turn still ends in `session.execution.succeeded`

#### Scenario: A frame with no representation leaves no event
- **WHEN** a recorded fixture carries outbound frames the bridge does not
  render, such as `driver.exit` and `control_response`
- **THEN** no event frame is emitted for them and the committed golden for
  that fixture still matches
