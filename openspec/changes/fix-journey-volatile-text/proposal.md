# Proposal

## Why

Two snapshot values still moved with wall-clock time, which a re-record
exposed:

- A dialog drawn over a turn footer cuts its duration mid-unit (`700ms`
  shows as `700m` behind the `/diff` source dialog), and the duration rule
  needs a whole `ms`/`s` unit, so the cut value stayed in the snapshot.
- The timeline and fork dialogs right-align each message's clock time; the
  time normalizes to `<TIME>`, but the gap before it depends on the hour's
  width (`9:59 PM` vs `10:05 PM`), so `jump-to-message` and
  `fork-session-from-message` changed by one space between runs.

## What Changes

- Whatever stands after a footer's `<MODEL> · ` is a duration.
- A run of two or more spaces before `<TIME>` collapses to two.
- `jump-to-message` and `fork-session-from-message` re-record offline and
  live.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the snapshot comparison requirement names both
  normalizations.

## Impact

`bridge/test/journeys/harness/normalize.ts` and its test, two journeys'
snapshots. No bridge runtime change.
