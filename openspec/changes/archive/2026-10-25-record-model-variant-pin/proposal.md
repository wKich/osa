# Proposal

## Why

`switch-model-variant` (`ctrl+t` cycles the model's reasoning variant) was
unrecorded. On the reference the footer gains `· low`; on the Maki side,
offline and live, nothing changes. Maki v0.6.4 cannot set reasoning effort
from outside: `set_model` takes a model spec only (`src/sdk_mode.rs`
L861–L906), and the CLI accepts `--effort`, `--thinking` and
`--max-thinking-tokens` only to warn they are ignored (`src/cli.rs`
L163–L173, L181–L203).

## What Changes

- Record `switch-model-variant` (`diverges` offline and live, the same),
  `blockedBy: "pin"` with that citation.
- Feature `model-variants` (`degraded`, pin).

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: a pin-blocked journey scenario.

## Impact

Catalog rows and the journey's snapshots only.
