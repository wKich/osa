# Design

## Context

See proposal.md — Why. `sessionRoute` has no interrupt arm, so
`POST /api/session/{sessionID}/interrupt` falls through to `synthesize`
(`bridge/src/bridge.ts:337–368`). The vendored pin defines the operation as
`SessionInterruptResponse` (`interrupted: boolean`), so the synthesized sample
answers `200 {interrupted:false}` (`bridge/src/spec-answers.ts:111–125`) and
nothing is written to the child. The cross-map is explicit that the wire's
cancellation message is inbound `control_request`/`interrupt` (L840–L843),
not `control_cancel_request`. The scripted child records every inbound frame
when `FAKE_MAKI_TRACE` names a file (`bridge/test/fake-maki.ts:22,102`), which
is the same seam `model-switch.test.ts` uses to prove what is *not* sent.

## Goals / Non-Goals

**Goals**
- Pin the route's shipped answer: `200 {interrupted:false}` for an open
  session, `404 SessionNotFoundError` for an unknown one.
- Pin the wire half during a live in-flight turn: no `interrupt` control
  request (nor any other cancellation frame), the turn still succeeds, and no
  `session.execution.interrupted` frame appears.
- Make the "accepted but never cancels" limitation an asserted fact rather
  than an untested claim.

**Non-Goals**
- No `control_request`/`interrupt` forwarding: cancelling the child is a
  runtime feature, and the TUI's interrupted rendering is not exercised
  offline.
- No changes to abort-on-child-exit (`turn-abort.test.ts`) or to permission
  cancellation (`control_cancel_request` denies that ask, not the run).
- No work on the other four `unverified` rows; each needs runtime behavior
  that does not exist.

## Decisions

1. **A new test file, one spawned bridge.** The trace is a per-bridge env
   value and the lifecycle is the test's own; `interrupt.test.ts` follows the
   one-bridge pattern rather than sharing another file's process.
2. **Interrupt a genuinely in-flight turn.** The scripted child keeps a turn
   open with `run exactly: sleep 2 .`; the test waits for
   `session.execution.started`, asserts no `session.execution.succeeded` has
   arrived yet, then interrupts. Without that boundary the test could pass by
   interrupting an idle session.
3. **Assert the response body, not just the status.** The honest value is
   `interrupted:false`; pinning the exact body fails if a future implementation
   starts claiming success without cancelling.
4. **Assert on the child's inbound trace for the wire half.** The claim is
   about what is not sent, so the test reads the scripted child's recorded
   stdin and filters out its own outbound asks (`dir:"out"`).
5. **Wait for the turn's success after the interrupt.** This proves the
   interrupt had no effect on the child; a future cancellation path fails here
   instead of silently passing.
6. **Status is `degraded`, not `verified`.** The route is accepted and the
   limitation is now tested, but the capability the row's title describes —
   an interrupt that stops the run — does not exist. The route row stays
   `served-faked`; only its evidence moves to the test.
7. **Spec delta is ADDED, not MODIFIED.** No existing requirement covers the
   interrupt route; the new requirement names the accepted-but-not-forwarded
   contract, mirroring the model-selection requirement.

## Risks / Trade-offs

- [The test pins a no-op and would fail when `interrupt` forwarding lands]
  → That is the intended tripwire: the scenario names the child-not-cancelled
  behavior explicitly, so implementing the interrupt must update the row, the
  spec, and this test together.
- [The turn could finish before the interrupt arrives]
  → The scripted child sleeps 2 s and the test verifies no success frame
  exists immediately before the interrupt; a shorter synthetic turn fails the
  in-flight precondition visibly rather than passing vacuously.
- [The route answer depends on `synthesize`'s schema sample]
  → Asserting the exact body turns a pin update that changes the answer into a
  visible failure, which is the point of the coverage.
- [Trace file leftovers between runs] → Removed in `beforeAll` and
  `afterAll`, as `model-switch.test.ts` does.
