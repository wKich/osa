# Proposal

## Why

The newest cross-map records the interrupt round trip as `unverified` (route
`served-faked`): `POST /api/session/{sessionID}/interrupt` falls through to
`synthesize`, so it answers from the pinned schema and never reaches the Maki
child. No test drives that route, so a regression that started claiming a
successful interrupt — or one that silently sent a cancellation frame — would
pass the offline suite. Interrupt is the last shipped route in the
session-control surface without coverage; the other open rows (steering,
attachments, retry visibility, the SDK handshake) need runtime behavior that
does not exist at the pin and stay recorded.

## What Changes

- Add `bridge/test/interrupt.test.ts`: one spawned bridge and one in-flight
  turn, asserting that `POST /api/session/{id}/interrupt` answers `200` with
  `{interrupted:false}`, the turn still reaches `session.execution.succeeded`,
  no `session.execution.interrupted` frame is emitted, and an unknown session
  answers `404` `SessionNotFoundError`.
- Pin the wire half: the bridge sends no `control_request` (in particular no
  `interrupt` subtype) and no other cancellation frame to the Maki child, so
  the turn is never cancelled. The pinned inbound subtype that cancels a run
  is `control_request`/`interrupt`
  (https://github.com/tontinton/maki, `src/sdk_mode.rs` v0.6.4 L840–L843).
- Move the `interrupt-round-trip` feature row from `unverified` to `degraded`,
  citing the test and naming the recorded limitation; move the
  `POST /api/session/{sessionID}/interrupt` route row's evidence from
  `bridge/src/spec-answers.ts` to the new test (status stays `served-faked`).
- Regenerate `docs/compatibility.md`.
- No bridge or translator runtime change: this pins shipped behavior.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds one requirement that an interrupt is accepted
  and answered as not interrupted without cancelling the Maki child, whose
  turn still completes normally (the pinned wire's inbound
  `control_request`/`interrupt` is not sent).

## Impact

- Tests: `bridge/test/interrupt.test.ts` (new; reuses
  `bridge/test/lib/bridge.ts` and the `MAKI_CHILD_CMD` scripted-child seam with
  `FAKE_MAKI_TRACE`; no fixture file, so no provenance entry).
- Report data: `bridge/compat/statuses.json` (one feature row moved to
  `degraded`, one route evidence path), `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
