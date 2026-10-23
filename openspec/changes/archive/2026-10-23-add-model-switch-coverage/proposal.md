# Proposal

## Why

The newest cross-map records the mid-session model switch as `unverified`
(route `served-live`, "state only"), and no test drives
`POST /api/session/{sessionID}/model`. A regression that dropped the 204, or
that started forwarding a control frame the pinned wire cannot honor, would
pass the whole offline suite. The other open rows (interrupt, steering,
attachments, retry visibility, the SDK handshake) need bridge behavior that
does not exist at the pin and stay recorded; the model route is shipped, so it
is the smallest remaining slice the coverage loop can prove without a runtime
change.

## What Changes

- Add `bridge/test/model-switch.test.ts`: one spawned bridge and one session,
  asserting that `POST /api/session/{id}/model` answers `204` for a valid
  selection, the session read and list still report the model the child
  announced on `system.init`, the next turn's `session.step.started` carries
  that same model, and an unknown session answers `404`
  `SessionNotFoundError`.
- Pin the wire half: no `set_model` (nor any other) control frame reaches the
  Maki child as a result of the selection; the child stays on the model it
  started with (inbound `control_request` subtypes at the pin are `initialize`,
  `interrupt`, `set_permission_mode`, `set_model` —
  https://github.com/tontinton/maki).
- Move the `mid-session-model-switch` feature row from `unverified` to
  `degraded`, citing the test and naming the recorded limitation; move the
  `POST /api/session/{sessionID}/model` route row's evidence from the captured
  request log to the new test (status stays `served-live`).
- Regenerate `docs/compatibility.md`.
- No bridge or translator runtime change: this pins shipped behavior.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds one requirement that a mid-session model
  selection is accepted and recorded without retasking the Maki child, whose
  announced model is still what the session and its following step frames
  report (the pinned wire's inbound `set_model` is not sent).

## Impact

- Tests: `bridge/test/model-switch.test.ts` (new; reuses
  `bridge/test/lib/bridge.ts` and the `MAKI_CHILD_CMD` scripted-child seam with
  `FAKE_MAKI_TRACE`; no fixture file, so no provenance entry).
- Report data: `bridge/compat/statuses.json` (one feature row moved to
  `degraded`, one route evidence path), `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
