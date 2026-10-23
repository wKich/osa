# Proposal

## Why

The transcript requirement already commits that a Maki `result` frame ends a
turn with `session.execution.succeeded` **or** `session.execution.failed`
(`openspec/specs/opencode-tui-bridge/spec.md`, "Turn completion is reported"),
but only the success half has ever been replayed: every committed fixture
ends with `subtype: "success"`, so the error subtype the pin defines
(`error_during_execution`, `sdk_mode.rs` v0.6.4 L995–L1000) has no test and
no report row. A failed turn is exactly where a stuck "working" spinner or a
false success would be most visible, so the offline gate should pin it before
the next change touches `handleResult`.

This is the remaining wire shape from the discovery inventory that the
coverage loop can prove without runtime work: the interrupt, model-switch,
steering, attachments, retry-visibility, handshake, and richer
permission-vocabulary rows all need bridge behavior that does not exist yet,
so they stay recorded and untouched.

## What Changes

- Add a recorded fixture `bridge/test/fixtures/maki-error.jsonl`: the
  captured plain turn with its `result` frame rewritten to the pinned
  `error_during_execution` shape (`is_error: true`, `result` carrying the
  failure message, `permission_denials` present).
- Add a committed golden `bridge/test/golden/maki-error.json` and put the
  fixture in the golden loop, pinning that the turn's parts still render and
  the turn ends with `session.step.ended {finish:"error"}` plus
  `session.execution.failed` carrying the wire's message — and never with
  `session.execution.succeeded`.
- Record the fixture's provenance as `mixed` (captured assistant output,
  source-derived result frame).
- Add the `turn-failure-mapping` feature row to
  `bridge/compat/statuses.json` as `verified` with the golden test as
  evidence, and regenerate `docs/compatibility.md`.
- No bridge runtime code change: `handleResult` already distinguishes the
  error subtype; this change only pins it.

## Capabilities

### New Capabilities

(none — no new capability path)

### Modified Capabilities

- `opencode-tui-bridge`: the existing "Translate the prompt into an OpenCode
  transcript" requirement gains one scenario pinning the failed-turn half of
  its own "Turn completion is reported" scenario. No requirement text changes.

## Impact

- Test assets only: `bridge/test/fixtures/maki-error.jsonl`,
  `bridge/test/fixtures/provenance.json`, `bridge/test/golden/maki-error.json`,
  `bridge/test/golden.test.ts`.
- Report data: `bridge/compat/statuses.json` (one added feature row),
  `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
