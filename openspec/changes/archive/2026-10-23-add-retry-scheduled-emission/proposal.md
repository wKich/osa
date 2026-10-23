# Proposal

## Why

The newest cross-map records `retry-scheduled` as `unverified`: Maki emits
`system{subtype:"api_retry"}` with `attempt`, `retry_delay_ms`, and `error`
(`src/sdk_mode.rs` v0.6.4 L1081), the pinned OpenCode 2.0.32 schema defines a
durable counterpart (`RetryScheduled`, `session-event.ts`,
https://github.com/sst/opencode/blob/v2.0.32/packages/schema/src/session-event.ts),
and the bridge drops the frame instead of mapping it. A provider retry is
therefore invisible to the TUI, and the current requirement promises that
silence, so a later change could start emitting without the offline suite
noticing.

## What Changes

- `bridge/src/translator.ts` maps each `system api_retry` frame to one durable
  `session.retry.scheduled` event with the pinned fields
  (`assistantMessageID`, `attempt`, `at`, `error`) instead of dropping it.
- The retry frame does not open, close, or reorder the turn: parts and terminal
  status stay identical to the same turn without retries.
- `bridge/test/golden.test.ts` pins the new frames in `golden/maki-retry.json`
  and keeps the existing "undisturbed transcript" equality against
  `golden/maki-plain.json` by excluding the new event type.
- The `retry-scheduled` feature row moves `unverified` → `verified` with
  `bridge/test/golden.test.ts` as evidence, and `docs/compatibility.md`
  regenerates.
- No new fixture: `bridge/test/fixtures/maki-retry.jsonl` already carries two
  source-derived retry frames (provenance `mixed`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: the requirement "Tolerate recorded Maki wire frames
  with no OpenCode counterpart" changes — `api_retry` now has a pinned
  counterpart and SHALL be emitted as `session.retry.scheduled`; frames that
  still have no representation remain tolerated without emitting.

## Impact

- Code: `bridge/src/translator.ts` (one branch and one durable-version entry).
- Tests/data: `bridge/test/golden.test.ts`, `bridge/test/lib/projection.ts`
  (timestamp strip + turn admission on a retry frame),
  `bridge/test/golden/maki-retry.json` (new),
  `bridge/compat/statuses.json` (one row), `docs/compatibility.md`
  (regenerated).
- No route, sandbox, dependency, or security-surface change. The suite stays
  offline: no Docker, gateway, network, or provider call.
