# Proposal

## Why

`see-file-reads-and-searches` was unrecorded. Recorded, the agent's read and
grep calls group into the same `→ Explored: 1 read, 1 search` row on both
sides, offline and against real Maki 0.6.4. The only differences are the
title and Maki's `Exit code: 0` for the setup command, both accepted on
earlier journeys.

## What Changes

- Script, snapshots and catalog row, at `parity` offline and live.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: a recorded scenario.

## Impact

Catalog row and snapshots only.
