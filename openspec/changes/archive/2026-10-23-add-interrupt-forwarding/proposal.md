# Proposal

## Why

`interrupt-round-trip` is `degraded` with `blockedBy: none`: the TUI's
`POST /api/session/{sessionID}/interrupt` is answered `interrupted:false` and
the Maki child is never cancelled, so pressing interrupt in the TUI lets the
run finish anyway. Both pins define the capability. Maki v0.6.4 cancels a run
on inbound `control_request` subtype `interrupt` (`src/sdk_mode.rs` L840–L843)
and ends the cancelled run with an `error_during_execution` result
(L1168–L1172). OpenCode v2.0.32 pins `session.execution.interrupted`
`{reason}` (`packages/schema/src/session-event.ts` L253–L257) and a route whose
`interrupted` says whether an active execution was stopped (vendored OpenAPI,
`session.interrupt`). The iteration-4 triage (this change's
`evidence/cross-map.md`) marks it `capability`.

## What Changes

- The interrupt route writes `control_request`/`interrupt` to the child when a
  turn is in flight and answers `{interrupted:true}`; an idle session stays the
  pinned no-op `{interrupted:false}` with nothing written.
- A permission ask parked when the interrupt arrives is answered `deny` first
  and settled for the TUI (`permission.replied` `reject`), so neither side keeps
  a dangling ask.
- The translator ends an interrupted turn's error result as
  `session.execution.interrupted` `{reason:"user"}` (durable v1) instead of
  `session.execution.failed`.
- The scripted child honors `control_request`/`interrupt` the way the pin does
  (ack, then an `error_during_execution` result).
- `interrupt-round-trip` → `verified`; the interrupt route row →
  `served-live`. Evidence matrices are copied forward with the iteration-4
  triage.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: removes "Accept an interrupt without claiming the child stopped" and adds "Forward an interrupt to the Maki child" (the requirement changes from "accepted
  without cancelling" to "forwarded to the Maki child").

## Impact

- Runtime: `bridge/src/bridge.ts` (interrupt route arm), `bridge/src/maki.ts`
  (`interrupt()`), `bridge/src/translator.ts` (interrupted end).
- Tests: `bridge/test/interrupt.test.ts` (rewritten), `bridge/test/fake-maki.ts`
  (interrupt handling). No fixture file, so no provenance entry.
- Report data: `bridge/compat/statuses.json`, `docs/compatibility.md`.
- No dependency, sandbox, or security-surface change; the suite stays offline.
