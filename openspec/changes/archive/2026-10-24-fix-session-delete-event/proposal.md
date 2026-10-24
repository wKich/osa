# Proposal

## Why

The `delete-session` journey diverges at `deleted`: after the user confirms
the delete in the session list, the reference TUI returns to the home screen,
while the Maki side keeps showing the deleted session's transcript. The real
server announces a delete with the durable `session.deleted` frame
(`schema/src/session-event.ts` v2.0.32 L177–L184), which the TUI handles by
dropping the session (`client/src/solid/data.ts` L682–L684); the bridge
deleted the session silently (defect `session-delete-emits-no-event`).

## What Changes

- `DELETE /api/session/{sessionID}` emits `session.deleted` (durable version
  2) before the session is dropped.
- The defect closes; `delete-session` is recorded offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the session lifecycle requirement gains the delete
  frame scenario.

## Impact

`bridge/src/bridge.ts`, `bridge/test/session-api.test.ts`, defects, statuses,
journeys, evidence, the report. No sandbox, egress, or credential change.
