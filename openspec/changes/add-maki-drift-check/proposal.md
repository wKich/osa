# Proposal

## Why

Thirteen features, two routes and nine journeys are `blockedBy: "pin"`, each
citing Maki v0.6.4 source. Nothing told us when a Maki release could close
one: `scripts/compat-drift.ts` watches OpenCode only. Every pin row also
needs either the Maki version that closes it (cited) or an upstream issue
draft.

## What Changes

- `scripts/maki-drift.ts` (`make maki-drift`) compares the Dockerfile's
  `ARG MAKI_VERSION` with Maki's latest release tag. It reads tags with
  `git ls-remote` and public raw files and release notes over HTTPS, nothing
  else. For newer releases it prints the notes and whether the SDK surface
  the pin citations rest on changed between the tags: `src/sdk_mode.rs`,
  `src/cli.rs`, `maki-agent/src/mcp/protocol.rs`. It exits non-zero when that
  surface changed, skips without network, and is never part of `make test`.
- `evidence/pins.md`: for every pin row, the closing Maki version or, where
  none exists through the latest release, the upstream issue draft under
  `evidence/issues/`. Nothing is posted.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the Maki drift requirement.

## Impact

`scripts/maki-drift.ts`, `bridge/test/maki-drift.test.ts`, `Makefile`, evidence.
No bridge runtime change.
