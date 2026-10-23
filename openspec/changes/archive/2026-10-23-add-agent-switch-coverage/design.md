# Design

## Context

See proposal.md — Why. The shipped path is three lines and already load-bearing:

- `sessionRoute` stores the body's agent on the session when it is a string and
  answers `204` (`bridge/src/bridge.ts:355-358`); the session lookup happens
  before dispatch, so an unknown session takes the `SessionNotFoundError`
  branch (`bridge/src/bridge.ts:348-349`).
- `sessionObject` reports `s.agent`, and the list route maps every live session
  through it (`bridge/src/bridge.ts:152-164`, `:254-257`).
- `Translator.beginTurn` emits `session.step.started` with
  `agent: this.hooks.agent()`, which `createSession` binds to a getter over
  `s.agent` (`bridge/src/translator.ts:100-106`,
  `bridge/src/bridge.ts:190-194`).

The pinned Maki wire has no inbound `set_agent`: the inbound
`control_request` subtypes at v0.6.4 are `initialize`, `interrupt`,
`set_permission_mode`, and `set_model` (recorded in
`2026-10-23-rebaseline-compat-iteration-3/evidence/maki-sdk-wire-features.md`).
The bridge sends none of them, so the child keeps the agent it started with.
`opencode-tui-features.md` records the TUI-side switch as "measured as
accepted; faked"; `bridge/compat/statuses.json` has no feature row for it, and
the route row's evidence is the source file.

The offline harness is the black-box one: `startBridge()` spawns the real
entrypoint with `bridge/test/fake-maki.ts` on `MAKI_CHILD_CMD`.

## Goals / Non-Goals

**Goals:**

- Make the shipped agent-selection state executable with one offline test file.
- Move the route row's evidence from source to behavior.
- Record the child-not-retasked limitation as its own `degraded` feature row,
  so the report does not imply a working agent switch.

**Non-Goals:**

- No runtime change: the route and the step-frame plumbing are shipped.
- No re-tasking the child: the pin exposes no subtype for it, and inventing
  one would be fabricating wire support.
- No mid-session model coverage: `POST /model` also stores state, but after
  the child announces, `sessionObject` and `step.started` prefer the
  announced model, so the route's effect is not observable; the
  `mid-session-model-switch` row stays `unverified` until `set_model` is
  forwarded.
- No other unverified row (interrupt, steering, attachments, retry
  visibility, SDK handshake, richer permission replies): each needs runtime
  behavior the bridge does not have.

## Decisions

1. **A new file, `bridge/test/agent-switch.test.ts`, with its own bridge.**
   `session-api.test.ts` shares one session and asserts turn-completion
   counters; adding a selection that changes later step frames would couple
   its cases. One extra spawned bridge keeps both files deterministic.
2. **The feature row is `degraded`, not `verified`.** The tested claim is
   "selection is recorded and reported"; the recorded limitation is "the
   child is not re-tasked". `verified` would erase the compatibility signal,
   exactly as it would for `permission-reask`. The row title names both
   halves, and the test path is the evidence.
3. **Assert the selection on all three observables** — route status, session
   read/list, next `session.step.started` — because the TUI may render any of
   them, and a partial regression is exactly what the route lacked evidence
   for.
4. **Prove the absence of a control frame with a trace knob, not by reading
   the source.** `fake-maki.ts` gains an opt-in `FAKE_MAKI_TRACE=<path>` that
   appends every inbound frame it parses; the test asserts no
   `control_request` mentioning the agent arrives. Default-off, so no
   existing test's behavior or output changes. Without this, "the child is
   not re-tasked" would be a comment rather than a check.
5. **The unknown-session case is asserted on both status and state.** The
   route answers `404` before touching a session; the test also confirms a
   later read of that id still `404`s, so no phantom session was created.

## Risks / Trade-offs

- [A test that pins a `degraded` feature looks weaker than a `verified`
  flip] → That is the honest signal: the simulator child cannot prove the real
  agent changed, because the pinned wire offers no way to change it. The row's
  title carries the limitation and points at the test.
- [The trace knob could grow into a general debugging surface] → It is one
  append line behind an env var, used by one test; no report or runtime path
  reads it.
- [Statuses/report drift] → `make compat` regenerates
  `docs/compatibility.md` and fails on a diff; part of the task gate.
- No evidence path enters this change's directory, so archiving later breaks
  no status row.

## Migration Plan

None: tests and a generated report update land together in the apply phase;
revert is a git revert of one change.

## Open Questions

None.
