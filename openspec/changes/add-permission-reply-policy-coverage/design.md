# Design

## Context

`replyPermission` (`bridge/src/bridge.ts`) has three outcomes: a valid
`once`/`always`/`reject` decision maps onto Maki's `allow`/`deny`, and anything
else answers 400 after denying the child. Two of those three are covered
offline by `bridge/test/session-api.test.ts` (deny and allow); the `always`
branch and the fail-closed branch are not. The `permission-reask` row's evidence
is the archived live `api-check.log`, which `make test-bridge` never runs.

The harness already exists: one spawned `bun src/bridge.ts` per test file with
`MAKI_CHILD_CMD` pointing at `bridge/test/fake-maki.ts`, which emits a fresh
`can_use_tool` control request for every command containing `rm`. See
proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Two black-box tests in the existing session-api describe block pinning the
  `always` re-ask policy and the fail-closed invalid reply.
- The `permission-reask` row's evidence becomes an offline test path.

**Non-Goals:**
- No bridge runtime change: shipped reply handling is what gets pinned.
- No status flip for `permission-reask` (stays `degraded`, decided with the
  user) and no work on the other recorded-but-uncovered rows —
  `interrupt-round-trip`, `mid-session-model-switch`, `mid-turn-steering`,
  `sdk-control-handshake`, `subagent-nesting` all need runtime forwarding, a
  design decision, or a live capture first.
- No fixture file: the permission round trip is a route-level behavior, so the
  session-api harness is the lens, not the golden projection.

## Decisions

1. **Keep `degraded`, swap the evidence string.** The row's limitation — Maki's
   wire offers only `allow`/`deny`, so `always` can never persist across calls —
   is a property of the upstream wire and was a deliberate row decision in the
   archived cross-map; a test does not remove it, and `verified` would erase
   the compatibility signal from the report. `bridge/test/crosscheck.test.ts`
   only constrains `verified` rows to test/fixture evidence, and
   `scripts/gen-compat.ts` accepts any existing path for `degraded`, so the
   swap is gate-clean.
2. **Test through the spawned bridge, not by unit-testing the handler.**
   `replyPermission` is unexported and its contract includes the child's stdin
   answer (`control_response`), which only the process seam can observe. The
   alternative — exporting it for a unit test — would change runtime code for
   the test's sake, which this change forbids.
3. **New cases append after the existing ones in the same describe block.**
   The block shares one bridge and asserts with per-test deltas (`count()`
   before/after), so ordering only matters for the probe file and the message
   ids: each new test gets its own probe path and `msg_` id, and the re-ask
   test reuses the existing `rm`-gated prompt shape (which already forces
   `can_use_tool` twice across two turns).
4. **Fail closed is asserted on all three observable outcomes** — HTTP 400,
   the child's `behavior: deny` (via the resulting `session.tool.failed` with a
   permission-denied message), and the untouched target — so the test pins the
   security-relevant part (the tool never runs) rather than just the status
   code.

## Risks / Trade-offs

- [Shared-bridge ordering: an earlier test's in-flight turn could make the new
  tests' frame-count deltas flaky] → each new test waits for its own
  `session.execution.succeeded` threshold, matching the existing cases.
- [`fake-maki` gates on the literal `rm` in the prompt] → reuse the exact
  prompt shape the current permission tests use rather than inventing a new
  command form.
- [The evidence swap changes `docs/compatibility.md`, which `make compat`
  diffs against git] → regenerate in the same change; the wrap-up gate runs
  `make compat`, which fails until the regenerated report is committed.
- No evidence path enters this change's directory, so archiving the change
  later breaks no status row.

## Migration Plan

None: tests and a generated report update land together; revert is a git
revert of one change.

## Open Questions

None.
