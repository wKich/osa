# Proposal

## Why

After `/cd sub` the footer reads `<WORKDIR>/sub` followed by padding sized by
the raw path, which differs between the offline temp root and the live
sandbox. The padding rule only collapsed the gap after `<WORKDIR>` or
`<WORKDIR>:branch`, so a subdirectory footer differed on a harness property.

## What Changes

- The padding rule also covers a subdirectory (`<WORKDIR>/sub`, with or
  without a branch).

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the comparison requirement names the subdirectory
  footer.

## Impact

`bridge/test/journeys/harness/normalize.ts` and its test. No committed
snapshot is affected.
