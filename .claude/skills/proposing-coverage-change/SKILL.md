---
name: proposing-coverage-change
description: Use when a discovery pass found features recorded as unverified or deferred in the bridge cross-map or statuses that should be covered with offline tests, or a recorded capability whose behavior is missing and needs one small implementation plus its test, and an openspec change is wanted for that work.
---

# Proposing a coverage change

## Overview

Turn recorded-but-uncovered rows into offline tests, and recorded-but-missing
capabilities into one small implementation with its test. Start in openspec
explore, then scaffold one change. A coverage slice ships tests, fixtures,
statuses, and a regenerated report with no runtime changes; a capability
slice implements the translation and proves it. One change does one or the
other — "no runtime changes" is what keeps a coverage change reviewable.

## Process

1. **Triage in openspec explore.** Read the newest cross-map. Pick one small
   coherent slice (one subsystem or lens) and say whether it is coverage
   (behavior exists) or capability (behavior missing); everything else stays
   recorded. State the slice and why before scaffolding.
2. `openspec new change "add-…"` named after the slice; then
   proposal → specs → design → tasks with `openspec status`/`openspec
   instructions` between artifacts.
3. **Spec delta:** ADDED requirements or scenarios only for behavior the
   repo now commits to verify. Never restate an existing requirement; use
   MODIFIED only when existing behavior wording truly changes (copy the
   whole block).
4. **Tasks,** each naming its verification:
   - **Capability slice:** if no code path exists, the change also implements
     it. `design.md` cites the pinned wire (`sdk_mode.rs` line or
     `session-event.ts` type) before any code; the implementation lands in
     `bridge/src/…` and the golden/test proves the new translation. Never mix
     a capability with coverage-only rows in the same change.
   - a `bridge/test/fake-maki.ts` fixture for the wire shape under test
     (e.g. `result` error subtypes, `system api_retry`, `stream_event`);
     a file added under `bridge/test/fixtures/` also records its kind
     (`captured`/`authored`/`mixed`) in `provenance.json`, or the suite fails;
   - a golden (semantic projection) or session-api/contract test asserting
     it end to end;
   - the statuses row moves `unverified`/`deferred` → `verified` with the
     new test path as evidence;
   - when a reachable route links that feature via its `feature` field, the
     route flips to `served-live` in the same change with the new test as its
     evidence, and the feature row is `reachable` — `crosscheck.test.ts` fails
     while a verified, unblocked feature's route is not live;
   - `make compat` regeneration; and the archive-path note when statuses
     evidence points into the change dir.
5. **Wrap-up gate:** `make test`, `make test-bridge`, `make compat`,
   `make lint`, `openspec validate "<change>"` in one pass.

## Rules

- One change is either coverage-only or capability-only; the two have
  different review bars, and a coverage change must not change runtime
  behavior.
- `verified` only with a test or fixture path as evidence —
  `bridge/test/crosscheck.test.ts` rejects anything else.
- Gated targets (`test-ui`, `compat-drift`) skip cleanly and never join
  `make test`; the default suite stays offline (no Docker, gateway, network).
- If a fixture cannot exist offline (needs a streaming provider, a live
  gateway), the row stays `unverified` and the change says what is missing —
  honest status beats a fake test.
