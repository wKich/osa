# Proposal

## Why

Four more navigation journeys were unrecorded: `boot-project-context`,
`open-recent-session-or-project`, `scroll-transcript`, `open-settings`.
Recorded, each matches the reference except for the session title, offline
and against real Maki 0.6.4. In the open dialog the longer Maki title also
widens the session column, so the search placeholder's final `…` falls one
cell short. With an equal title the Maki side renders it exactly; that run is
recorded below.

## What Changes

- Scripts, snapshots and catalog rows for the four journeys, at `parity`
  offline and live.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: recorded scenarios.

## Impact

Catalog rows and snapshots only.
