---
name: proposing-coverage-change
description: Use when a discovery pass found features recorded as unverified or deferred in the bridge cross-map or statuses that should be covered with offline tests, and an openspec change is wanted for that coverage.
---

# Proposing a coverage change

## Overview

Turn recorded-but-uncovered rows into offline tests. Start in openspec
explore, then scaffold one change. A coverage change ships tests, fixtures,
statuses, and a regenerated report — no runtime behavior changes unless a
test seam demands one, and then design.md says why.

## Process

1. **Triage in openspec explore.** Read the newest cross-map. Pick one small
   coherent slice (one subsystem or lens); everything else stays recorded.
   State the slice and why before scaffolding.
2. `openspec new change "add-…"` named after the slice; then
   proposal → specs → design → tasks with `openspec status`/`openspec
   instructions` between artifacts.
3. **Spec delta:** ADDED requirements or scenarios only for behavior the
   repo now commits to verify. Never restate an existing requirement; use
   MODIFIED only when existing behavior wording truly changes (copy the
   whole block).
4. **Tasks,** each naming its verification:
   - a `bridge/test/fake-maki.ts` fixture for the wire shape under test
     (e.g. `result` error subtypes, `system api_retry`, `stream_event`);
   - a golden (semantic projection) or session-api/contract test asserting
     it end to end;
   - the statuses row moves `unverified`/`deferred` → `verified` with the
     new test path as evidence;
   - `make compat` regeneration; and the archive-path note when statuses
     evidence points into the change dir.
5. **Wrap-up gate:** `make test`, `make test-bridge`, `make compat`,
   `make lint`, `openspec validate "<change>"` in one pass.

## Rules

- `verified` only with a test or fixture path as evidence —
  `bridge/test/crosscheck.test.ts` rejects anything else.
- Gated targets (`test-ui`, `compat-drift`) skip cleanly and never join
  `make test`; the default suite stays offline (no Docker, gateway, network).
- If a fixture cannot exist offline (needs a streaming provider, a live
  gateway), the row stays `unverified` and the change says what is missing —
  honest status beats a fake test.
