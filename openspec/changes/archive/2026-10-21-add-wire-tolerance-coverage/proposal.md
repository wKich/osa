# Proposal

## Why

The compatibility report claims the bridge tolerates Maki's `system
api_retry` frames without disturbing the transcript, but no test or fixture
exercises that path — the `api-retry-tolerance` row sits at `unverified`
with only a planning note as evidence, and the wire shape (recorded from
`sdk_mode.rs` at v0.6.4) has never been replayed through the shipped
Translator.

## What Changes

- Add a recorded fixture `bridge/test/fixtures/maki-retry.jsonl`: the
  existing plain-turn transcript with `system{subtype:"api_retry"}` frames
  interleaved mid-turn, shapes taken from the Maki v0.6.4 wire inventory.
- Add a golden test asserting its projected translation is identical to the
  committed plain-turn golden — "transcript undisturbed" as an executable
  check, not a claim.
- Flip the `api-retry-tolerance` row in `bridge/compat/statuses.json` from
  `unverified` to `verified` with the new test path as evidence, and
  regenerate `docs/compatibility.md` via `make compat`.
- No runtime code changes; the translator's existing tolerance behavior is
  what gets pinned.

## Capabilities

### New Capabilities

(none — no new capability path)

### Modified Capabilities

- `openspec/specs/opencode-tui-bridge/spec.md`: adds one requirement —
  tolerance of recorded Maki wire frames (`system api_retry`) the bridge has
  no OpenCode counterpart for, verified by an offline fixture. No existing
  requirement's wording changes.

## Impact

- Test assets only: `bridge/test/fixtures/`, `bridge/test/golden.test.ts`
  fixture list, `bridge/compat/statuses.json`, `docs/compatibility.md`.
- The cross-map row for `api-retry-tolerance` moves from "iteration 2
  candidate" to covered; `stream-deltas` and the control-plane rows stay
  recorded and untouched (they need a live capture or runtime work this
  change does not do).
- Offline only: no Docker, gateway, or network added to `make test-bridge`.
