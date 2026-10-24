# Proposal

## Why

Recording `undo-previous-message` measured
`POST /api/experimental/session/{sessionID}/wait`, which the TUI calls before
reverting; the bridge answered it at once from the spec, even with a turn
running. The real `session.wait` answers when the agent loop is idle
(`server/src/handlers/session.ts` v2.0.32 L456–L460).

The same pass recorded three session journeys whose behavior the pinned Maki
cannot provide: `compact-session`, `undo-previous-message`, and
`redo-reverted-message`. The Maki SDK takes only the initialize, interrupt,
set_permission_mode and set_model control requests (`src/sdk_mode.rs`
v0.6.4 L818–L880), drops its compaction events (L1057–L1058), and keeps
`/compact` and rewind in maki-ui (`maki-ui/src/app/mod.rs` L1969,
`maki-ui/src/app/session.rs` L455).

## What Changes

- `wait` answers 204 once the session has no running turn and no waiting
  prompt (404 for an unknown session); route `served-live`/reachable, feature
  `session-wait`.
- Pin records (status edits only): features `session-compaction` and
  `session-revert` (`degraded`, `blockedBy: pin`); routes
  `POST …/compact` and `POST …/revert/stage` reachable and linked; the three
  journeys recorded offline and live with `blockedBy: pin` and a
  `pinCitation`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the session wait requirement.

## Impact

`bridge/src/bridge.ts`, `bridge/test/session-idle.test.ts`, statuses,
journeys and evidence, the report. No sandbox, egress, or credential change.
