# Proposal

## Why

The area-end re-record after the prompt changes crossed midnight, and the
`jump-to-message` timeline and the `fork-session-from-message` picker
snapshots changed from `<TIME> PM` to `<TIME> AM` on every side. The
12-hour clock's meridiem is part of the time of day, which the comparison
already treats as volatile.

## What Changes

- `H:MM[:SS] AM|PM` normalizes to `<TIME>` as a whole.
- The two journeys re-recorded offline and live (`parity` on both).

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the comparison requirement names the meridiem.

## Impact

`bridge/test/journeys/harness/normalize.ts` and its test; the two
journeys' snapshots. No bridge runtime change.
