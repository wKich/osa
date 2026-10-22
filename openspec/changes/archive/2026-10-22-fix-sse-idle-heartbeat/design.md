# Design

## Context

The polish loop's machinery is in place (`add-bridge-verification`,
`fix-bridge-transcript-defects`), and the TUI-level pass is the one discovery
surface this defect lives on: `bun bridge/test/discovery.ts` drives the bridge
over HTTP and never holds an idle stream, so it printed five `ok` scenarios
while `make test-ui` failed. See `proposal.md` for why; the requirement is in
the delta spec.

## Goals / Non-Goals

Goals: an idle event stream stays connected so the composer's next submit
reaches the bridge; the wire rule the checker enforces matches the measured
wire; the inventory entry and compatibility row close with a test as evidence.

Non-goals: any other event-stream work (per-client replay cursors, `id:`
lines, durable-event replay on reconnect); changing the TUI; touching the
sandbox transport; the other cross-map rows still `unverified`/`degraded`.

## Decisions

1. **Expected behavior is pinned from evidence, in order:** the archived
   capture (`…/add-opencode-tui-bridge/evidence/mapping-table.md` §0 — "one
   bare `data: <json>` per frame … `: heartbeat` comments between frames",
   measured on the real wire), the vendored OpenAPI contract (which declares
   the `text/event-stream` schema but no keepalive, so it cannot settle this),
   then the pinned TUI client itself. The client source in the installed
   OpenCode 2.0.32 binary reads: `idleTimeout` defaults to 45000 ms, every
   received byte calls `onActivity`, and no activity inside the window aborts
   with `"Event stream stalled"`. That pins *both* halves: the comment form
   and the ceiling on the interval. No live capture was needed.

2. **The keepalive is per open stream, not global.** Each subscriber owns its
   own interval, cleared in `cancel()` and on the first enqueue failure, so a
   client that walks away leaves no timer behind and a dead controller is
   dropped the way `pushFrame` already drops it.

3. **Interval 15 s by default, overridable.** A third of the client's stall
   window survives timer jitter and a slow event loop; `SSE_HEARTBEAT_MS`
   exists so the test observes a heartbeat in milliseconds instead of waiting
   out production timing (same process-seam pattern as `MAKI_CHILD_CMD`,
   `BRIDGE_LOG`, `PORT`).

4. **Comments are comments.** The client parser keeps only `data:` lines, so
   a heartbeat never becomes an event frame; `checkRawSse` now accepts lines
   starting with `:` and still rejects anything else, and the test asserts the
   frame list is unchanged. The bridge does not write heartbeats to
   `BRIDGE_SSE_LOG`, so goldens and discovery captures stay frame-only.

5. **The model list is refreshed by the event the client listens for.** The
   TUI's submit gate is `available(selection)`, defined as "the selected
   `{providerID, modelID}` appears in the location model list", and it fetches
   that list once at boot — 11 seconds before the first session exists, so it
   holds only the synthesized `sample/sample`. When `system.init` then
   announces `synthetic/fake`, the session's model changes under a stale list
   and every later submit returns false with a "Model unavailable" toast
   (quoted from the failing transcript). The client refetches that list only
   from a location-scoped `model.updated` frame, so the bridge emits exactly
   that on the announcement; the refetched `/api/model` already carries the
   announced model, because `modelList()` patches it in on every read. The
   event name is pinned from the client's own handler — the consumer is the
   authority here, since the vendored OpenAPI names no event types at all and
   no archived capture contains one.

6. **Closure follows the loop's rules.** The entry flips to `fixed` with no
   marker to drop (this defect never carried an `expectedFailure` marker or a
   `want-*.json` golden — its assertions are the live-stream test, the
   model-update test, and the TUI pass, which is what the status rows cite),
   the capture stays, and `make compat` regenerates the report.
   `tui-check.ts` needs no change: it only records open entries, and its
   prompt/permission invariants are what failed while the defect was open.
   The model gate was never a separate inventory entry — it was found while
   triaging this one and is recorded as its own spec scenario, test, and
   status row instead.

## Risks / Trade-offs

- [Client idle timeout changes upstream] → the clause names the pinned 45 s
  value and `make compat-drift` is the gate that reports a contract change; a
  faster client would need a shorter interval, a one-constant change.
- [Heartbeat bytes widen the SSE log or golden output] → heartbeats are never
  written to `BRIDGE_SSE_LOG`, and `checkRawSse` is the only reader of raw
  bytes.
- [A silent disconnect is masked by heartbeats] → enqueue to a closed
  controller throws, which clears the interval and removes the subscriber; a
  client that vanished is detected on the next write either way.
- [The TUI smoke is a scripted, ~75 s run] → it is the only surface that
  exercises an idle gap, so the pass and its capture are recorded as this
  change's evidence rather than replaced by a synthetic test.

## Migration Plan

Behavior-only change behind the existing suites. Rollback: revert the commit;
the inventory entry, statuses row, and generated report return with it.

## Open Questions

None blocking. Deferred: whether the real server's exact heartbeat cadence
differs from 15 s — nothing on the client side measures it, and only the
ceiling (< 45 s) is observable behavior.
