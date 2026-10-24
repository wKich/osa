# Proposal

## Why

`allow-permission-always` was unrecorded. Recorded, both sides show the
always-allow patterns, and a second command of the same pattern runs without
a prompt, offline and against real Maki 0.6.4 (the bridge answers `always`
with Maki's session-scoped allow). The only differences are the untitled
first turn and Maki's `Exit code: 0`, each accepted on earlier journeys.

## What Changes

- Script and record `allow-permission-always`; accept the two differences.
  The `permission-reask` feature stays `degraded`/pin: Maki keeps the allow
  for the session, not the project (`sdk_mode.rs` v0.6.4 L918–L927), which
  this one-session journey cannot show.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: a recorded scenario.

## Impact

Catalog row and snapshots only.
