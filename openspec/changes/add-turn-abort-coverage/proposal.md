# Proposal

## Why

The bridge already fails an in-flight turn when its Maki child exits: the
scripted-child seam reports the exit, and `Translator.abortTurn` emits
`session.execution.failed` instead of leaving the turn running
(`bridge/src/translator.ts:109-114`). Nothing in the suite ever exercises it —
every session test keeps its child alive until teardown — and the previous
change (`add-turn-failure-coverage`) deliberately left it unrecorded because
it needs a scripted-child exit knob, not a wire fixture. A dead child behind a
running turn is the lifecycle half of the same risk as a failed `result`: the
TUI shows a spinner that never stops. The behavior exists; only the coverage
and the report row are missing.

The remaining cross-map rows (interrupt, model switch, steering, attachments,
retry visibility, SDK handshake, richer permission vocabulary) stay recorded:
each needs bridge runtime behavior that does not exist, so none can be proven
by an offline fixture.

## What Changes

- Add a `FAKE_MAKI_CRASH=1` knob to `bridge/test/fake-maki.ts`: on the next
  prompt the scripted child emits one assistant text frame and then exits `1`
  without a `result` — a child dying mid-turn.
- Add `bridge/test/turn-abort.test.ts`, spawning the bridge with that knob:
  the partial text still renders, the turn ends with exactly one
  `session.execution.failed` carrying `{type: "Error", message: "maki process
  exited"}`, no `session.execution.succeeded` follows, and a later prompt on
  the dead session answers 503 instead of hanging.
- Add the `turn-abort-mapping` feature row to `bridge/compat/statuses.json` as
  `verified` with the test path as evidence, and regenerate
  `docs/compatibility.md`.
- No bridge or translator runtime change: the shipped abort path is what gets
  pinned.

## Capabilities

### New Capabilities

(none — the abort path belongs to the existing bridge conversation)

### Modified Capabilities

- `opencode-tui-bridge`: one ADDED requirement committing to how a turn ends
  when the Maki child exits mid-turn, behavior the shipped bridge already has
  and this change verifies.

## Impact

- Test assets only: `bridge/test/fake-maki.ts` (one env knob),
  `bridge/test/turn-abort.test.ts` (new).
- Report data: `bridge/compat/statuses.json` (one ADDED feature row),
  `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
