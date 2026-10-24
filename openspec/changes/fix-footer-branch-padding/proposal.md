# Proposal

## Why

The live run of `view-session-diff` (a repository with a `main` branch)
differed only in the footer's gap after `<WORKDIR>:main`: the TUI pads the
workdir and branch to a fixed width, the live workdir
(`/sandbox/journey-work`) is shorter than the offline temp directory, and the
normalizer collapsed the gap only after a bare `<WORKDIR>`.

## What Changes

- The gap after `<WORKDIR>` or `<HOME>` collapses with or without a
  `:<branch>` suffix.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the snapshot comparison requirement names the
  footer padding.

## Impact

`bridge/test/journeys/harness/normalize.ts` and its test. No committed
snapshot carries a branch suffix yet. No bridge runtime change.
