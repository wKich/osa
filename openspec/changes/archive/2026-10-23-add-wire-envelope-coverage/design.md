# Design

## Context

See `proposal.md` — Why. Two facts shape the approach:

- Every outbound frame in the captured fixtures already carries top-level
  `session_id` and `uuid`; the wire shape needs no new fixture, only an
  assertion.
- `bridge/src/bridge.ts` creates one `MakiSession` per OpenCode session and
  routes its frames through a closure holding that session id. The envelope's
  `session_id` reaches `Translator` only on `system.init`, where it is stored
  as `makiSessionID` and never read again. Binding is by the spawn handle, so
  the recorded row's "used to bind" wording is the thing to correct.

## Goals / Non-Goals

**Goals:**

- Pin that captured outbound frames carry the envelope.
- Pin that a child announcing its own `session_id` does not rebind the
  session: events and durable aggregates stay under the minted `ses_` id.
- Leave the report honest: the row's title describes the tested behavior.

**Non-Goals:**

- No routing change and no use of `makiSessionID`.
- No new fixture, `fake-maki.ts` knob, golden, or runtime code. The scripted
  child gains the envelope on its frames so the end-to-end case can reject a
  foreign id; that is wire fidelity in a test seam, not bridge behavior.
- No coverage of a second live session or of `uuid` uniqueness: one spawned
  child with a deliberately foreign `session_id` is enough to disprove
  rebinding.

## Decisions

1. **Two tests in one new file, `bridge/test/envelope.test.ts`.**
   Test one reads the captured fixtures through `loadFixture` and asserts the
   envelope on every outbound line. Test two uses the existing `startBridge`
   harness and `fake-maki.ts`; the scripted child stamps
   `session_id: "fake-maki-session"` and a fresh `uuid` on every frame, the
   test sends one prompt, and asserts every event's `data.sessionID` and every
   durable `aggregateID` is the minted `ses_` id. Alternatives: a golden
   projection (would not exercise the session binding) or a new fixture
   (duplicates what every captured fixture already contains).

2. **Correct the row instead of proving its claim.** The title becomes "Maki's
   per-message envelope (top-level session_id + uuid) rides every wire frame;
   the bridge keeps the child on its OpenCode-minted session instead of
   rebinding on the envelope id". Verifying the old wording would require a
   runtime change, which a coverage change does not make.

3. **Evidence is the test path, not the discovery change directory.** That
   also removes this row from the archive-time path rewrite the discovery
   change recorded for its own evidence links.

4. **Match provenance notes by whole fixture name.** `scripts/gen-compat.ts`
   previously used a substring test, so the new test's `maki-stream-live`
   reference would also attach the authored `maki-stream` caveat (and
   `maki-subagent-live` → `maki-subagent`). Fix the shared match rather than
   trim the live fixtures out of the test: the live captures are the stronger
   evidence and the next test that names one would hit the same false note.

## Risks / Trade-offs

- **Fixture-shape assertion ages with the upstream pin.** If a later Maki
  release drops the envelope, the test fails and the row must be revisited
  rather than silently passing. The failure names the fixture and line.
- **Single-child test cannot catch cross-session routing.** It is not meant
  to; the claim under test is that the envelope does not replace the owning
  session, which one foreign id disproves. Cross-session isolation stays
  covered by the session CRUD tests.
- **`uuid` is asserted as shape, not uniqueness.** Ordering/uniqueness is not
  a bridge responsibility; a format assertion is enough to keep the top-level
  field from being dropped silently.
