---
name: running-feature-discovery
description: Use when asked to run features discovery for the opencode-tui-bridge, find features still uncovered between maki's SDK wire and the OpenCode TUI, or enhance the compatibility matrices, statuses, or cross-map.
---

# Running feature discovery

## Overview

Discover → record → hand off. This skill is the discover-and-record half of
the polish loop: run the executable passes, enhance the matrices and
statuses, and report a scoped list for the next iteration. Recording is not
implementing.

```
running-feature-discovery
├── unverified/deferred rows → proposing-coverage-change → add-… change (tests, statuses → verified; green on archive)
└── open defects.json entries → proposing-fix-change     → fix-… change (code fix, golden flip, status → fixed)
```

The two branches are parallel, not sequential: `discovery.ts` appends defect
entries itself, so the fix path is entered straight from discovery. A
failing new coverage test is a discovery finding — record it as a defect,
don't ship red tests in an `add-…` change. Re-run discovery after either
branch to confirm closure.

## Ground first (read-only)

| File | Why |
| --- | --- |
| `docs/compatibility.md` | generated — **never hand-edit** |
| `bridge/compat/statuses.json`, `bridge/defects.json` | the durable truth |
| newest `maki-sdk-wire-features.md` / `opencode-tui-features.md` / `cross-map.md` | in the newest `openspec/changes/…/evidence/` or `openspec/changes/archive/…/evidence/` |
| `bridge/test/README.md`, `scripts/gen-compat.ts` | loop mechanics and the enforced vocabulary |

## Run the passes (they are the job — run them, don't delegate)

```sh
bun bridge/test/discovery.ts     # API pass; appends NEW defects with captures; never edits existing entries; offline
make test-ui                     # gated TUI pass; skips cleanly without opencode; rewrites bridge/test/captures/tui-last.*
cd bridge && bun test            # baseline: suite green before any edit
bun scripts/gen-compat.ts --check
```

## Record findings

- **Lens vocabulary is spec-fixed.** Routes: `served-live|served-faked|deferred|unhandled`.
  Features: `verified|unverified|degraded|buggy`. A cross-map "deferred"
  capability lands as feature `unverified` (or route `deferred`); `buggy`
  only ever mirrors an open `bridge/defects.json` entry.
- New coverage rows → `bridge/compat/statuses.json`, every row with an
  `evidence` link that exists today; prefer durable paths
  (`bridge/test/…`, `openspec/changes/archive/…`) over a not-yet-archived
  change dir.
- Extend the evidence matrices in the current change; if none is open,
  scaffold one (`openspec new change`) before recording. Cite sources:
  an `sdk_mode.rs` line at the pinned tag, a fixture file, a vendored route.
- Verify nothing: `verified` requires a test or fixture path as evidence
  (`bridge/test/crosscheck.test.ts` enforces it).

## Do not

Edit `docs/compatibility.md` by hand · delete or edit existing defect
entries · implement fixes or tests · mark rows `verified` from observation
alone · claim coverage of a route the TUI never called without saying
"contract-only".

## Finish

```sh
bun scripts/gen-compat.ts && bun scripts/gen-compat.ts --check
cd bridge && bun test          # crosscheck validates evidence links exist
make compat                    # regen + git diff --exit-code
```

Report: rows added/changed, defects appended, open defects deduped, and the
top next-iteration candidates from the cross-map.
