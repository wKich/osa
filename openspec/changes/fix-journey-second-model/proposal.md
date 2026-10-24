# Proposal

## Why

`switch-model` picks the journey catalog's second model, but the comparison
normalized every model label to `<MODEL>`, so a checkpoint could not show
which model the footer named: a switch that never happened would compare
equal.

## What Changes

- The second journey model's labels (`Mock Model Two`, `mock-model-2`,
  `mock/mock-model-2`, `maki/mock-model-2`) normalize to `<MODEL-2>`.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the comparison requirement names `<MODEL-2>`.

## Impact

`bridge/test/journeys/harness/normalize.ts` and its test. No committed
snapshot names the second model yet.
