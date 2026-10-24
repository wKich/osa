# Proposal

## Why

The sidebar (`toggle-sidebar`, and the palette's "Show sidebar") prints the
project path middle-elided and cut at the column
(`/…/fold…/bb/4_lk…/T/maki-journey-ref-toggle-sidebar`). The workdir rule only
matched a token that still ends in the workdir's basename, so each side kept
its own temp path and the checkpoints differed on a harness property.

## What Changes

- A `/…`-led token whose kept segments run along the workdir's in order (a
  `…`-ended or final segment may be a prefix, at least two kept) normalizes
  to `<WORKDIR>`; any other elided path is left alone.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the comparison requirement names the elided workdir.

## Impact

`bridge/test/journeys/harness/normalize.ts` and its test. No committed
snapshot contains an elided workdir.
