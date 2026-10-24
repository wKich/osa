# Proposal

## Why

Scripting `change-working-directory` (`/cd`) showed the move notice and the
`pwd` output wrapping across lines on both offline sides. Their temp roots
(`$TMPDIR/maki-journey-ref-<slug>-XXXX/journey-work` on macOS) are too long for
the 120-column TUI, and each side wraps at a different point; the live
sandbox path (`/sandbox/journey-work`) does not wrap at all. Line structure
then depends on the harness's temp path, not on the journey.

## What Changes

- Journey roots live under a short real path: `realpath(/tmp)/mjr-XXXX`
  (reference), `mjm-` (Maki side) and `mjl-` (live), so a printed workdir fits
  and both sides resolve the same prefix.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement names the journey root.

## Impact

`bridge/test/journeys/harness/{record,live}.ts`. A full offline and live
re-record left every verdict and snapshot unchanged.
