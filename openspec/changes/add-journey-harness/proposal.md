# Proposal

## Why

`bridge/compat/journeys.json` lists 59 OpenCode TUI journeys (53 reachable),
all `unrecorded`, and the native parity score is 0.0% because nothing can
record a journey yet. The status rules from `add-tui-journey-catalog` require
committed screen snapshots of real OpenCode and of the Maki side before any
journey moves. Today `make test-ui` drives one fixed boot → prompt →
permission flow with timed sleeps and keeps a raw terminal byte stream that
nothing renders, and no recording of real OpenCode exists.

The harness has to be trusted before a loop runs it 53 times: a loose
normalizer or a flaky wait would produce false `parity` or `diverges`
everywhere. This change builds it under review and proves it end to end on
three pilot journeys.

## What Changes

- A **scripted mock provider**: a local OpenAI-compatible HTTP server that
  replays a journey's model turns (text, streamed deltas, tool calls)
  deterministically, bound to loopback, needing no credentials.
- An **executable journey script** per recorded journey, beside its catalog
  row: key input, waits on screen content instead of fixed sleeps, checkpoint
  markers whose ids match the catalog, and the model turns. One script drives
  both sides; `fake-maki.ts` gains a mode that plays the same turns as Maki
  wire frames.
- A **PTY driver** (Bun's built-in terminal support) that runs the script
  against (a) the real OpenCode server + TUI at v2.0.32 using the mock
  provider, in a temporary XDG home and workdir, and (b) the TUI against the
  bridge with the scripted `fake-maki.ts`.
- A **headless terminal renderer** that turns each run into text screens at
  every checkpoint, a **normalizer** for volatile tokens, and a
  **per-checkpoint diff**. Snapshots, diffs, and the Maki-side request log are
  committed per journey.
- `make test-journeys`: gated like `make test-ui` (skips cleanly without
  `opencode`), records and compares the journeys that have scripts, and
  updates their catalog status and evidence.
- Offline consistency in `bridge/test/crosscheck.test.ts`: re-diffing the
  committed snapshots must reproduce each journey's committed status, and
  Maki-side journey request logs join the measured reachable route set.
- **Pilots** recorded and compared in this change:
  `send-prompt-stream-reply` and `allow-permission-once` (the flow `make
  test-ui` already drives; expected near parity), and
  `resume-session-history` (expected to diverge or break: it calls
  `GET /api/session/{sessionID}/message`, which the bridge answers as a
  deferred empty list). The third pilot proves the diff path, the hand-off,
  and the widening of the measured set; its fix is left to the journey loop.

The gated live run against real Maki in the sandbox, and the policy rule it
needs, are a separate change (`add-journey-live-run`). No bridge runtime
behavior changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `tui-journey-parity`: adds how a journey is recorded and compared (one
  script for both sides, real OpenCode against a credential-free scripted
  provider, normalized text snapshots, committed diffs), the gated recording
  target, offline status consistency, and journey traffic as measured
  traffic.

## Impact

- New harness code under `bridge/test/journeys/` (driver, renderer,
  normalizer, diff, mock provider) and per-journey scripts and snapshots.
- `bridge/test/fake-maki.ts` (scripted-turns mode), `Makefile`
  (`test-journeys`), `bridge/test/crosscheck.test.ts`,
  `bridge/compat/journeys.json` (three pilot rows move), regenerated
  `docs/compatibility.md`.
- New dev dependencies in `bridge/package.json`: `@xterm/headless` and
  `@xterm/addon-serialize` (pinned versions) for screen rendering.
- Reference runs execute the real OpenCode on the host in a temporary
  workdir, against loopback only, with no credentials. No sandbox, egress, or
  credential-boundary change; the default `make test` stays offline.
