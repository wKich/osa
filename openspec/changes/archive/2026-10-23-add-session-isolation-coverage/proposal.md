# Proposal

## Why

The spec's "Maintain one Maki session behind one OpenCode session" requirement
claims a one-to-one mapping, but the offline gate has only ever driven **one**
session at a time: `session-api.test.ts`, `turn-abort.test.ts`, and the
contract tests each create a single session. The bridge's registry is a `Map`
of sessions, each owning its own child and `Translator`, so a frame scoped to
the wrong session, or a delete that kills the wrong child, would pass the
whole suite — and in the TUI it would look like two conversations bleeding
into each other or a live session dying when another is closed.

## What Changes

- Add `bridge/test/session-isolation.test.ts`: one spawned bridge, two live
  sessions, concurrent prompts. Pins that each prompt is admitted exactly once
  in its own transcript, each turn's text renders only under its own session,
  every emitted frame is scoped to a known session, and deleting one session
  kills only its own child — the other still runs the next turn.
- Add the `session-isolation` feature row to `bridge/compat/statuses.json` as
  `verified`, citing the test path; regenerate `docs/compatibility.md`.
- No bridge or translator runtime change: the per-session registry and child
  teardown are shipped behavior; this change only pins them.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: "Maintain one Maki session behind one OpenCode
  session" gains two scenarios (no shared transcript, independent child
  lifecycle) and one independence sentence. Shipped behavior; no feature is
  added.

## Impact

- Tests: `bridge/test/session-isolation.test.ts` (new; reuses
  `bridge/test/lib/bridge.ts` and the `MAKI_CHILD_CMD` scripted-child seam, no
  fixture file).
- Report data: `bridge/compat/statuses.json` (one added feature row),
  `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
