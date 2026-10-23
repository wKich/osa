# Design

## Context

See proposal.md — Why. Pinned wire, cited before code:

- Maki v0.6.4 `src/sdk_mode.rs`: inbound `control_request` is
  `{request_id, request:{subtype, ...}}` (L240–L253); subtype `interrupt`
  does `handle.cancel_tx.try_send(())` and acks with a `control_response`
  (L840–L843, L428–L441). A cancelled run ends `Done{reason: Cancelled}`, which
  the pump reports as `result` `error_during_execution`, `is_error:true`
  (L1168–L1172, L996–L1000). `control_cancel_request` only denies one pending
  ask (L732–L742) and is not the cancellation message.
- OpenCode v2.0.32 `packages/schema/src/session-event.ts`:
  `session.execution.interrupted` is durable (`options`, version 1) with
  `reason: "user" | "shutdown" | "superseded" | "inactivity"` (L253–L257).
  The vendored OpenAPI's `session.interrupt` returns
  `SessionInterruptResponse {interrupted}`: true when an active execution was
  interrupted, false for the idle no-op.

## Goals / Non-Goals

**Goals**
- Cancel an in-flight turn from the TUI and report it as interrupted.
- Keep the idle answer honest (`interrupted:false`, nothing written).
- Leave no permission ask dangling on either side of an interrupt.

**Non-Goals**
- The `resume` query parameter: it resumes OpenCode's pending steering input
  and control items, which the bridge does not queue; it is accepted and
  ignored.
- Mid-turn steering, the SDK handshake, and every other open row.

## Decisions

1. **Interrupt only while a turn is open.** `Translator.inTurn` is the turn
   boundary the bridge already owns (`beginTurn` … `result`). Writing
   `interrupt` to an idle child would be a no-op at the pin, but answering
   `interrupted:true` would then be false.
2. **Deny a parked ask before interrupting.** Maki forgets outstanding asks
   when the run ends (`reset_turn`, L978–L984), so the ask the TUI shows would
   never be answerable. Answering `deny` unparks the run deterministically and
   `permission.replied` `reject` clears the TUI's dialog.
3. **The interrupted end replaces the failed end.** After `markInterrupted`,
   an error result emits `session.execution.interrupted` `{reason:"user"}`;
   `session.step.ended` still closes the step with `finish:"error"` (the pinned
   `FinishReason` has no interrupt member). A success result that races the
   interrupt stays `succeeded`; the flag resets at the next `beginTurn`.
4. **Bridge-minted control ids.** `bridge_interrupt_<n>` per child keeps the
   ack distinguishable from Maki's own `req_<n>` asks; the translator already
   ignores inbound `control_response` frames.
5. **Status `verified`, route `served-live`.** The route now acts on live
   child state; the test is the evidence. The route row's scope stays
   `out-of-scope` because the measured TUI captures never call it.

## Risks / Trade-offs

- [The scripted child's cancellation is a model of the pin, not the pin] →
  It follows the cited lines (ack, then `error_during_execution`); the live
  TUI smoke is unaffected because it never interrupts.
- [The parked-ask test relies on deny and interrupt arriving close together]
  → The scripted child returns a denial to the "model" for 100 ms before
  ending the run, as the real run does, so the interrupt lands on the same run.
