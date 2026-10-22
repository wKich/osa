# Proposal

## Why

The TUI-level discovery pass (`make test-ui`) fails against the current build:
only one of the two scripted prompts ever reaches the bridge, so no permission
dialog appears and the gated command never runs. The capture behind
`bridge/defects.json` entry `tui-sse-idle-reconnect-drops-next-turn` shows the
first cause: `GET /api/event` writes nothing while a session is idle, and after
exactly 46 seconds of silence the TUI aborts the stream ("Event stream
stalled"), reconnects, and re-runs its whole boot route sweep. The
compatibility report carries the row as `buggy` because an open inventory
entry forces it.

The behavior is measurable in three places, all recorded before any code was
touched: the archived mapping table says the real server puts `: heartbeat`
comments between frames; the pinned OpenCode 2.0.32 client resets a 45-second
stall timer on *any* received byte and otherwise aborts and re-boots; and a
live `make test-ui` run on this build reproduces a 46.014-second gap between
the last frame and a second `server.connected`, with `POST .../prompt` called
once instead of twice.

Reproducing it also showed the entry's causal chain was half wrong. The second
submit never reached the bridge even *before* the reconnect fired, and it still
failed after the keepalive removed the reconnect. The pinned client holds a
second gate: the composer refuses a send whose selected model is missing from
the location model list it read at boot, and both failing transcripts show the
matching toast naming the child's announced model. That gate — not the
reconnect — is what dropped the submit and the permission turn, so the batch
closes both causes.

## What Changes

- The bridge writes the measured server's `: heartbeat` comment on every open
  event stream during idle gaps, well inside the client's 45-second stall
  window (`SSE_HEARTBEAT_MS`, default 15000).
- The bridge emits a location-scoped `model.updated` frame when a child
  announces its model. Without it the TUI keeps the model list it read at
  boot — before any child existed — and its composer refuses every submit
  after the first turn with a "Model unavailable" toast, which is why the
  permission turn never posted.
- The SSE wire check accepts comment lines, since the measured wire carries
  them, while still requiring every event to be a bare `data:` frame and
  `server.connected` first.
- A live-bridge test asserts that an idle stream produces heartbeats and that
  the comments are not delivered as event frames, and that the turn emits the
  model update and a model list naming the announced model.
- The inventory entry closes (`status: "fixed"`, capture kept), the
  `sse-idle-keepalive` row flips to `verified` with that test as evidence, a
  `model-list-refresh` row is added as `verified`, and
  `docs/compatibility.md` regenerates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-tui-bridge`: two MODIFIED requirements — "Serve the OpenCode boot
  and config surface" keeps its four existing scenarios unchanged and gains
  "The announced model stays selectable"; "Follow the wire, not the schema, for
  SSE frames" keeps its existing scenario and gains the keepalive clause plus
  "The stream survives an idle gap".

## Impact

- **Code**: `bridge/src/bridge.ts` (one interval per open stream, cleared on
  cancel or enqueue failure; `model.updated` on the child's first
  announcement); `bridge/test/lib/contract.ts` (`checkRawSse` tolerates `:`
  comment lines).
- **Tests/data**: `bridge/test/contract.test.ts` gains the idle-gap test, the
  model-update assertions, and runs its bridge with a short keepalive
  interval; `bridge/defects.json` entry flips to `fixed`;
  `bridge/compat/statuses.json` gains `model-list-refresh` and flips
  `sse-idle-keepalive` to `verified`; `docs/compatibility.md` regenerates.
- **Evidence** (this change): `evidence/tui-keepalive-note.md` plus the
  passing TUI run's `tui-keepalive-frames.jsonl` /
  `tui-keepalive-requests.jsonl`.
- **Upstream coupling**: the keepalive clause depends on the pinned OpenCode
  client's 45-second stall timeout and the selectable-model clause on its
  submit gate reading the location model list; `make compat-drift` is the
  gate that would notice a contract change.
