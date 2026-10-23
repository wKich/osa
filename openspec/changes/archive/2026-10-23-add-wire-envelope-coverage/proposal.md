# Proposal

## Why

Discovery pass 3 recorded `maki-wire-envelope` — Maki's top-level
`session_id` + `uuid` on every outbound frame — as `unverified`, claiming the
bridge uses it "to bind a child to its session". Reading the code shows the
claim is backwards: the bridge binds a child by the spawn handle it created
for the OpenCode session, and the envelope's `session_id` is only recorded
from `system.init` (`bridge/src/bridge.ts:196`) and never read again. The
envelope is nonetheless on every captured fixture frame and the bridge must
never let it rebind a child, so the behavior exists while the coverage and
the row wording are wrong.

## What Changes

- Add `bridge/test/envelope.test.ts`:
  - every outbound frame in the captured fixtures carries a non-empty
    top-level `session_id` and a hyphenated UUID `uuid`;
  - a child that announces its own `session_id` (`fake-maki-session`) keeps
    emitting under the OpenCode-minted `ses_` id, and no event frame adopts
    the child's id.
- Correct the `maki-wire-envelope` row's title to what the bridge actually
  does — envelope carried, session not rebound — and flip it
  `unverified` → `verified` with the new test path as evidence.
- Tighten `scripts/gen-compat.ts`'s provenance-note match to whole fixture
  names, so the test's `maki-stream-live` reference does not also claim the
  authored `maki-stream` fixture.
- Regenerate `docs/compatibility.md`.

No bridge, translator, or recorded-fixture change: the captured fixtures
already carry the envelope. `bridge/test/fake-maki.ts` gains the same
envelope on every frame it emits, so the end-to-end case has a foreign
`session_id` on the child's own frames to reject.

## Capabilities

### New Capabilities

(none — the wire envelope is part of the existing bridge conversation)

### Modified Capabilities

- `opencode-tui-bridge`: one ADDED requirement committing to keep the
  child's per-message envelope from rebinding its OpenCode session.

## Impact

- `bridge/test/envelope.test.ts` — new offline test.
- `bridge/test/fake-maki.ts` — stamps the captured envelope (top-level
  `session_id`, `uuid`) on every frame it emits; no behavior knob changes.
- `scripts/gen-compat.ts` — provenance notes match whole fixture names.
- `bridge/compat/statuses.json` — one row retitled and flipped to
  `verified`; its evidence moves off the discovery change directory onto the
  test, so archiving that change needs no path rewrite for this row.
- `docs/compatibility.md` — regenerated.
- Unaffected: `bridge/src/**`, existing fixtures and goldens,
  `bridge/defects.json`, and every security invariant in `AGENTS.md`.
