---
name: proposing-fix-change
description: Use when open entries in bridge/defects.json — bugs found by the discovery pass or reported from TUI sessions — need an openspec change to fix a small portion of them.
---

# Proposing a fix change

## Overview

Fix a small, related batch (1–3 defects) end to end: spec scenario → code
fix → golden flip → inventory closure → discovery rerun. Bigger batches
split; the loop prefers small steps.

## Process

1. **Reproduce.** Read each defect entry's capture, then
   `bun bridge/test/discovery.ts` — its scenarios name the defect ids and
   print `known` for open entries. A defect found by a TUI journey names the
   journey and checkpoint that exposed it (`journey: { "slug", "checkpoint" }`)
   and cites the committed `maki-frames.jsonl`/snapshot as its capture.
2. `openspec new change "fix-…"`; proposal → specs → design → tasks. If an
   unarchived change for these defects already exists, work inside it —
   revise its artifacts — and never scaffold a colliding second change. Spec
   delta: MODIFIED requirement with the **entire** existing block copied and
   the new scenario added — never a partial block.
3. **Pin the expected behavior from evidence before coding**, in this order:
   archived captures → the vendored OpenAPI contract → Maki source at the
   pinned tag → a gated live capture. If no source confirms it, record the
   gap in design.md and keep the defect open instead of guessing.
4. **Fix** `bridge/src/…`; flip the defect's golden from expected-failure to
   the positive assertion, renaming it to what it asserts, not what it
   tolerated (`want-<behavior>.json`).
5. **Close the records:** `bridge/defects.json` entry → `status: "fixed"`
   with the `expectedFailure` marker removed (entries are never deleted);
   the statuses row → `verified` with the new test as evidence;
   `make compat` regenerates.
6. **Verify the loop:** `bun bridge/test/discovery.ts` prints `ok` for those
   scenarios and appends nothing; a TUI-visible fix re-runs the journey
   (`make test-journeys` or `bun bridge/test/journeys/harness/record.ts
   <slug>`), records its new status and snapshots, and regenerates the report;
   then `make test`, `make test-bridge`, `make compat`, `make lint`,
   `openspec validate "<change>"`.

## Rules

- One fix batch per change; the cross-map's next slice waits its turn.
- A journey finding names the journey checkpoint that exposed it; a
  TUI-visible fix is not closed until that journey is re-recorded and its new
  status is committed.
- `bridge/test/crosscheck.test.ts` pairs expected-failure markers with
  *open* entries — a closed defect with a leftover marker fails the suite.
- Statuses evidence links into the change dir must be rewritten to the
  dated archive path at archive time; note it in a wrap-up task.
- A fix that changes what the TUI sees (event shapes, ordering) re-runs the
  TUI smoke when the `opencode` binary is present, and records the capture.
