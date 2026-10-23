# Proposal

## Why

The newest cross-map and `opencode-tui-features.md` record the mid-session
agent switch as "measured as accepted; faked": the bridge stores the TUI's
selection, but the Maki child is never re-tasked. The route
`POST /api/session/{sessionID}/agent` is `served-live` in
`bridge/compat/statuses.json` with `bridge/src/bridge.ts` as its only evidence,
and no test drives it — a regression that dropped the update, or that left the
next turn's `session.step.started` on the old agent, would pass the whole
offline suite. The unverified wire rows (interrupt, model switching, steering,
attachments, retry visibility, the SDK handshake, richer permission replies)
all need bridge behavior that does not exist at the pin and stay recorded; the
agent-selection half of the same subsystem is shipped, so it is the smallest
remaining slice the coverage loop can prove without a runtime change.

## What Changes

- Add `bridge/test/agent-switch.test.ts`: one spawned bridge and one session,
  asserting that `POST /api/session/{id}/agent` answers `204`, the session
  object and session list report the selected agent, the next turn's
  `session.step.started` carries it, and an unknown session answers `404`
  `SessionNotFoundError`.
- Add the `agent-switch-state` feature row to `bridge/compat/statuses.json` as
  `degraded`, citing the test: session-agent selection is recorded and
  reported, but the pinned Maki wire has no inbound `set_agent`, so the child
  keeps the agent it started with (`src/sdk_mode.rs` at v0.6.4, inbound
  `control_request` subtypes: `initialize`, `interrupt`, `set_permission_mode`,
  `set_model` — https://github.com/tontinton/maki).
- Move the `POST /api/session/{sessionID}/agent` route row's evidence from the
  source path to the new test; the status stays `served-live`.
- Regenerate `docs/compatibility.md`.
- No bridge or translator runtime change: this pins shipped behavior.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds one requirement that mid-session agent selection
  is recorded and reported on the session and its following step frames while
  the Maki child is not re-tasked (the pinned wire offers no `set_agent`).

## Impact

- Tests: `bridge/test/agent-switch.test.ts` (new; reuses
  `bridge/test/lib/bridge.ts` and the `MAKI_CHILD_CMD` scripted-child seam; no
  fixture file, so no provenance entry).
- Report data: `bridge/compat/statuses.json` (one added feature row plus one
  route evidence path), `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
