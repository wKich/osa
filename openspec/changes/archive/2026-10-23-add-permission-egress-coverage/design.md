# Design

## Context

See proposal.md — Why. The shipped bridge answers a permission ask in
`replyPermission` (`bridge/src/bridge.ts:279–296`): it validates the decision,
emits `permission.replied`, calls `MakiSession.answer`, and clears the pending
entry; `answer` writes `{type:"control_response", response:{request_id,
behavior}}` to the child's stdin (`bridge/src/maki.ts:72–74`). The scripted
child already records every inbound frame when `FAKE_MAKI_TRACE` names a file
(`bridge/test/fake-maki.ts:95`), and `agent-switch.test.ts` already uses that
seam to prove which frames are *not* sent. Existing permission tests prove
tool outcomes, never the answer frame.

## Goals / Non-Goals

**Goals**
- Pin the exact outbound answer for each decision path: `once` → `allow`,
  `always` → `allow`, `reject` → `deny`, invalid → `deny`, each naming the
  `request_id` Maki sent, exactly once per answered ask.
- Make the bare-vocabulary limitation (no `updatedPermissions`, no `message`)
  an asserted fact instead of an untested one.

**Non-Goals**
- No richer permission vocabulary: `allow` + `updatedPermissions`
  (`AllowSession`) and `deny` + `message` (`DenyWithGuidance`) stay
  unimplemented; the row records the limitation.
- No duplicate-reply/idempotency coverage: a second reply to a cleared ask is
  the route's existing 404, adds no new wire shape, and is out of this
  slice's claim.
- No work on the other six `unverified` rows; each needs runtime behavior
  that does not exist.

## Decisions

1. **A new test file, one spawned bridge.** The trace is a per-bridge env
   value and `session-api.test.ts` spawns without it; adding the env there
   would put the trace knob in every test in that file. A dedicated
   `permission-egress.test.ts` follows `agent-switch.test.ts`'s one-bridge
   pattern.
2. **Assert on the child's inbound trace, not on bridge internals.** The
   claim is about the wire, so the test reads the scripted child's recorded
   stdin (the same black-box seam used for "no control frame is sent") rather
   than importing `MakiSession`.
3. **Count deltas per gated turn.** Reading the trace after each reply and
   diffing against the previous count proves exactly one answer per ask, not
   just that one exists. The `request_id` is paired with the `control_request`
   the child recorded for that turn.
4. **Assert the exact key set** (`request_id`, `behavior`). This pins the
   current bare answer and fails if someone adds a richer shape without
   updating the row — the intended tripwire.
5. **`control-response-emission` → `verified`, `permission-reply-vocabulary`
   → `degraded`.** The first claim (every answer is emitted, addressed, and
   bare) is now wholly tested. The second claim is about shapes the bridge
   does not send, so `verified` would overclaim; `degraded` matches the
   cross-map's own wording and still cites the test. Its title is rewritten to
   name the limitation rather than the unimplemented feature. The
   `control-response-emission` title is corrected because it currently mixes
   the two wire directions (Maki→bridge is the type; the bridge→child answer
   is what the row tests).
6. **Spec delta is MODIFIED, not ADDED.** The egress detail belongs to
   "Round-trip tool permissions"; one scenario makes the tested frame
   observable without restating the requirement.

## Risks / Trade-offs

- [The bare-only assertion is read as Maki supporting only bare
  `allow`/`deny`] → The scenario and row title both say the limitation is the
  bridge's, and the reported row is `degraded` with that wording.
- [The fake child's gate is the `rm` heuristic, so a future fixture change
  breaks the trigger] → The test drives the same commands the existing
  permission tests use; a broken gate fails as "no permission.asked", which
  names the cause.
- [Trace file leftovers between runs] → Removed in `beforeAll` and
  `afterAll`, as `agent-switch.test.ts` does.
