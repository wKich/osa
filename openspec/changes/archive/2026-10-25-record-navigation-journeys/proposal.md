# Proposal

## Why

Seven navigation journeys were unrecorded: `show-command-palette`,
`toggle-sidebar`, `view-status`, `open-help`, `view-debug-info`,
`switch-theme`, `exit-application`. Recorded, each differs from the reference
only by the session title (accepted with the standing title reason), offline
and against real Maki 0.6.4.

## What Changes

- Scripts, snapshots and catalog rows for the seven journeys, at `parity`
  offline and live.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: recorded scenarios.

## Impact

Catalog rows and snapshots only. A text snapshot cannot show a theme's
colors; `switch-theme` checks the dialog and that the session still renders.
