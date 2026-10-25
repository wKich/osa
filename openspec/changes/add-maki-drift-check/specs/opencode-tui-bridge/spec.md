## ADDED Requirements

### Requirement: Check the Maki pin against Maki releases
The repository SHALL provide a Maki-side drift check that reports the
pinned Maki version, the latest Maki release, each newer release's notes,
and whether the SDK surface files changed between the pin and the latest
release, exiting non-zero when they did.

#### Scenario: A newer release with an unchanged SDK surface
- **WHEN** Maki v0.6.5 is released while the image pins v0.6.4 and
  `src/sdk_mode.rs`, `src/cli.rs` and `maki-agent/src/mcp/protocol.rs` are
  unchanged
- **THEN** `make maki-drift` prints the v0.6.5 notes, reports the surface
  unchanged and exits 0
