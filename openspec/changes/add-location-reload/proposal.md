# Proposal

## Why

`reload-configuration` (`/reload`) shows "Configuration reloaded" on both
sides, but the bridge answered `POST /api/location/reload` from the
contract and reloaded nothing. The model catalog in particular is read once
at boot, so a Maki provider added to the sandbox config never reached the
model dialog. OpenCode rebuilds the location's services
(`server/src/handlers/location.ts` v2.0.32 L22–L31), and the TUI then
refetches every location resource (client `solid/data.ts` L1955–L1967).

## What Changes

- The reload re-reads what the bridge serves from the sandbox before
  answering `204`: the model catalog, the checkout's git state, its
  worktrees (announcing a change) and its skills (`skill.updated` on a
  change).
- A running Maki child keeps the configuration it started with: the pinned
  SDK has no reload control (`sdk_mode.rs` v0.6.4 L818–L880).
- Route `served-live`/reachable, feature `location-reload`.
  `reload-configuration`: recorded, `parity` offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the reload requirement.

## Impact

`bridge/src/bridge.ts`, `bridge/test/{location-reload.test.ts,sandbox-bin/maki}`,
rows.
