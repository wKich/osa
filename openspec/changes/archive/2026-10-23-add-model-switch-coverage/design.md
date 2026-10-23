# Design

## Context

See proposal.md — Why. The route lives in `sessionRoute`
(`bridge/src/bridge.ts:351–354`): it stores `s.model` and answers `204`, and
forwards nothing to the child. What the TUI actually renders comes from
`sessionObject` (`bridge/src/bridge.ts:152–164`), which prefers
`s.translator.announcedModel` over the stored model, and from
`Translator.modelNow()` (`bridge/src/translator.ts:77–79`), which does the
same. The scripted child announces `synthetic/fake` on `system.init` and
records every inbound frame when `FAKE_MAKI_TRACE` names a file
(`bridge/test/fake-maki.ts:22,102`). `agent-switch.test.ts` already uses that
seam for the sibling route; there is no model-switch test.

## Goals / Non-Goals

**Goals**
- Pin what the route does and does not do: `204` for a valid selection, `404`
  `SessionNotFoundError` for an unknown session, no model-control frame to the
  child, and the child's announced model still reported on the session read,
  the session list, and the next turn's `session.step.started`.
- Make the recorded limitation ("state only", cross-map) an asserted fact
  rather than an untested claim.

**Non-Goals**
- No `set_model` forwarding and no new control-plane path: the pinned wire
  defines it, but sending it is a runtime feature with no TUI-visible
  verification available offline.
- No changes to the boot-time model list (`GET /api/model`) or to the
  announcement path (`model.updated`); both are already verified by
  `contract.test.ts`.
- No work on the other five `unverified` rows; each needs runtime behavior
  that does not exist.

## Decisions

1. **A new test file, one spawned bridge.** The trace is a per-bridge env value
   and the session lifecycle is the test's own; a dedicated
   `model-switch.test.ts` follows `agent-switch.test.ts`'s one-bridge pattern
   instead of sharing another file's process.
2. **Wait for the announcement before reading the model.** `system.init`
   arrives asynchronously after session creation; the test waits for the
   session-scoped `model.updated` frame the bridge emits on init, so the
   "announced model wins" assertion cannot race the child's startup.
3. **Assert on the child's inbound trace for the wire half.** The claim is
   about what is not sent, so the test reads the scripted child's recorded
   stdin (the same black-box seam `agent-switch.test.ts` uses) and filters out
   the child's own outbound `can_use_tool` entries (`dir:"out"`).
4. **Status is `degraded`, not `verified`.** The route is accepted and the
   limitation is now tested, but the capability the title describes — a
   switch that changes the model — does not exist. `degraded` matches the
   cross-map's "state only" wording; `verified` would overclaim. The route row
   stays `served-live` and only its evidence moves to the test.
5. **Spec delta is ADDED, not MODIFIED.** No existing requirement covers the
   model route; the new requirement names the accepted-but-not-forwarded
   contract, mirroring the agent-selection requirement. No existing wording
   changes.

## Risks / Trade-offs

- [The test pins a no-op and would have to be rewritten when `set_model` lands]
  → That is the intended tripwire: the scenario names the child-is-not-re-tasked
  behavior explicitly, so implementing the switch must update the row and this
  test together.
- [The announced model is read after `model.updated` but the child could
  announce again] → The scripted child announces exactly once at startup and
  the assertion compares against the same `synthetic/fake` value before and
  after, so a later announcement would fail visibly rather than silently.
- [Trace file leftovers between runs] → Removed in `beforeAll` and `afterAll`,
  as `agent-switch.test.ts` does.
