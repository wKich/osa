# Proposal

## Why

`manage-queued-prompts` diverged: deleting a queued prompt in the TUI's
Queued prompts dialog (`DELETE /api/session/{sessionID}/inbox/{inboxID}`)
did nothing, and both queued prompts ran. The bridge wrote every admitted
prompt to the Maki child at once; the pinned child queues it for its own
later run (`sdk_mode.rs` v0.6.4 L682–L702, L763) and has no way to take it
back, and the bridge answered the inbox routes from the spec.

## What Changes

- A prompt admitted while a turn runs waits in the bridge and is written to
  the child when its turn starts (the turn order is unchanged).
- `GET /api/session/{sessionID}/inbox` lists the waiting prompts;
  `DELETE …/inbox/{inboxID}` drops one before the child sees it and emits
  `session.inbox.cancelled` (an item no longer waiting is the pinned no-op);
  `PATCH …/inbox/{inboxID}` with `queue` is a no-op and with `steer` is the
  pinned 409 conflict — steering into a running Maki turn stays the existing
  pin limit (feature `mid-turn-steering`).
- The three inbox routes become `served-live`/reachable under feature
  `session-inbox-held`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the queued-prompt requirement and the deferred
  read-surface requirement (inbox is no longer deferred).

## Impact

`bridge/src/translator.ts`, `bridge/src/bridge.ts`, `bridge/test/inbox.test.ts`,
statuses, journeys, evidence, the report. No sandbox, egress, or credential
change.
