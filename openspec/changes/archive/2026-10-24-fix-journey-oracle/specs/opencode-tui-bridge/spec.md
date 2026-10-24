# Spec Delta

## ADDED Requirements

### Requirement: Deliver an admitted prompt before its assistant turn
The bridge SHALL emit `session.inbox.delivered` for every prompt it admits,
before the first assistant frame that prompt causes. The event SHALL carry the
prompt's inbound id as `inboxID` and SHALL be durable on the session. This
SHALL hold for a prompt that starts its turn immediately as well as for a
prompt that waits behind a running turn, which is delivered when its turn
starts. A prompt whose turn starts immediately SHALL NOT be left in the
enqueued state; the TUI renders the assistant turn only after the delivered
frame arrives.

#### Scenario: An immediately-started prompt is delivered
- **WHEN** the user submits a prompt and no turn is in flight, so the prompt
  starts its turn at once
- **THEN** the bridge emits `session.inbox.enqueued` followed by
  `session.inbox.delivered` for that prompt's `inboxID`, both before the first
  assistant text frame, and the TUI renders the assistant reply

#### Scenario: A queued prompt is delivered when its turn starts
- **WHEN** a prompt is admitted while another turn is running and starts when
  that turn ends
- **THEN** the bridge emits `session.inbox.delivered` for the queued prompt
  before its first assistant frame, with the same `inboxID` it enqueued
