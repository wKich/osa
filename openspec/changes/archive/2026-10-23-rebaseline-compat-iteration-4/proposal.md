# Proposal

## Why

The iteration-4 capability slices closed every reachable feature row that had
`blockedBy: none`. Two out-of-band rows still read below their exit. The
`agent-switch-state` title names its pin limit without the `sdk_mode.rs`
citation. The `sdk-control-handshake` title states the capability rather than
why it is out of scope, and its evidence is an iteration-1 matrix that predates
the reason. The matrices also carry one stale row (`session.retry.scheduled`
is emitted) and miss the four event types the slices began emitting. This is
the discovery loop's record step: status text and evidence, no behavior.

## What Changes

- `bridge/compat/statuses.json`: `agent-switch-state` title cites
  `sdk_mode.rs` v0.6.4 L818–L880 (no `set_agent` subtype);
  `sdk-control-handshake` title records the out-of-scope reason (the child
  serves control requests without a handshake, L818–L827; no TUI behavior
  depends on it), and its evidence moves to the iteration-4 triage
  (`archive/2026-10-23-add-interrupt-forwarding/evidence/cross-map.md`).
- Copy the matrices forward from `add-mid-turn-prompt-queue` and the route
  classification from iteration 3. Mark the four newly emitted events and the
  stale retry row, re-enumerate routes (143 = 143), and refresh the interrupt
  and model route rows.
- Regenerate `docs/compatibility.md`.

## Impact

Report data and evidence only; no runtime, test, or spec change.
