---
name: running-feature-discovery
description: Use when asked to run features discovery for the opencode-tui-bridge, find features still uncovered between maki's SDK wire and the OpenCode TUI, check the compatibility chart against upstream docs or source, or enhance the compatibility matrices, statuses, or cross-map.
---

# Running feature discovery

## Overview

Discover → record → hand off. This skill is the discover-and-record half of
the polish loop: run the executable passes, derive the full chart from
upstream docs and source, enhance the matrices and statuses, and report a
scoped list for the next iteration. Recording is not implementing.

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
| newest `maki-sdk-wire-features.md` / `opencode-tui-features.md` / `cross-map.md` | in the newest `openspec/changes/…/evidence/` or `openspec/changes/archive/…/evidence/`; an open change's copy wins over any archive's |
| `docs/ai/references.md`, `examples/maki-image/Dockerfile` | the only index of upstream doc/source links, and the Maki pin |
| `bridge/test/README.md`, `scripts/gen-compat.ts` | loop mechanics and the enforced vocabulary |

## Run the passes (they are the job — run them, don't delegate)

```sh
bun bridge/test/discovery.ts     # API pass; appends NEW defects with captures; never edits existing entries; offline
make test-ui                     # gated TUI pass; skips cleanly without opencode; rewrites bridge/test/captures/tui-last.*
cd bridge && bun test            # baseline: suite green before any edit
bun scripts/gen-compat.ts --check
```

## Derive the chart from upstream docs and source (required)

The passes only test what the matrices already record — capabilities nobody
transcribed are invisible to them. Close that gap against upstream, at the
pins in `statuses.json` `versions`; never a newer tag (the pin is the
contract).

| Side | Sources |
| --- | --- |
| Maki wire | `docs/ai/references.md` → `tontinton/maki` source at the Dockerfile pin (`src/sdk_mode.rs`, `src/cli.rs`): every outbound/inbound wire type, `control_request` subtypes, `stream_event` delta names, CLI/headless flags the bridge may see (Maki's versionless docs are a pointer only, per the rule below) |
| OpenCode API/TUI | via `docs/ai/references.md` → vendored `bridge/src/openapi-2.0.32.json` (every path), the measured calls in `bridge/test/fixtures/bridge-requests.jsonl` (partial: one archived run — absence from it proves nothing, cross-check `bridge/test/captures/tui-last-requests.jsonl`), and `anomalyco/opencode` source at the `versions` pin (e.g. `packages/schema/src/session-event.ts`) for SSE event envelopes the OpenAPI does not pin |

- **Enumerate, don't sample:** one row per route, SSE event type, and wire
  message kind on each side; diff that enumeration against the newest
  `maki-sdk-wire-features.md`, `opencode-tui-features.md`, and `cross-map.md`.
  Present upstream but missing from the matrices is a discovery finding — and
  so is staleness: a matrix row contradicting a later `statuses.json` flip
  gets refreshed in the current change. A matrix row whose route or
  capability the pinned upstream does not define is also a finding: a
  phantom, removed or corrected rather than left standing.
- **Pinned source beats current docs:** versionless upstream docs (the
  `opencode.ai/docs/server/` pages are newer than the pin) are a pointer to
  where to look, never a citation — derive every row from source at the tag.
- **Read-only fetches:** webfetch a raw file at the pinned tag or read the
  local vendored copies; if a side's source/docs link is absent from
  `docs/ai/references.md`, add it there so `scripts/check-links.sh` tracks it.
- Record through the rules below — a doc/source read yields rows at most
  `unverified`/`deferred` with an upstream citation in the matrix; it never
  yields `verified`.

## Record findings

- **Lens vocabulary is spec-fixed.** Routes: `served-live|served-faked|deferred|unhandled`.
  Features: `verified|unverified|degraded|buggy`. A cross-map "deferred"
  capability lands as feature `unverified` (or route `deferred`); `buggy`
  only ever mirrors an open `bridge/defects.json` entry.
- New coverage rows → `bridge/compat/statuses.json`, every row with an
  `evidence` link that exists today; prefer durable paths
  (`bridge/test/…`, `openspec/changes/archive/…`) over a not-yet-archived
  change dir — except a matrix copied forward this iteration, which cites
  the current change's copy. An open-change path is legal: the archive
  commit must rewrite it to the archived path in the same commit (precedent:
  the iteration-1 rows), or `crosscheck.test.ts` goes red.
- Extend the evidence matrices in the current change — a change scoped to
  this discovery work; scaffold one (`openspec new change`) if none is open
  for it, and never record into an unrelated open change. Copy matrices
  forward into it; never edit a file under `openspec/changes/archive/`
  (the archive is the historical record), so the current change's copy is
  the newest from then on. Cite sources: an `sdk_mode.rs` line at the
  pinned tag, a fixture file, a vendored route.
- Route vocabulary discriminator — mirror adjacent recorded rows rather than
  relabeling: `served-*` = the bridge deliberately builds the response
  (live child state or faked payload as observed), `deferred` = a spec-valid
  minimal answer while the capability is not implemented (cross-map gloss),
  `unhandled` = outside the pinned contract or 404 as spelled. Never flip an
  existing route row on this rule alone — record the mismatch as a finding.
  The `contract-only` caveat lives in the evidence matrix's coverage column,
  not in `statuses.json`.
- Verify nothing: `verified` requires a test or fixture path as evidence
  (`bridge/test/crosscheck.test.ts` enforces it).

## Do not

Edit `docs/compatibility.md` by hand · delete or edit existing defect
entries · implement fixes or tests · mark rows `verified` from observation
alone · derive anything from an unpinned or newer-than-pin upstream tag ·
claim coverage of a route the TUI never called without saying
"contract-only".

## Finish

```sh
bun scripts/gen-compat.ts && bun scripts/gen-compat.ts --check
cd bridge && bun test          # crosscheck validates evidence links exist
make compat                    # regen + git diff --exit-code
```

Report: rows added/changed, defects appended, open defects deduped,
capabilities newly transcribed from upstream (with the pins they came from),
and the top next-iteration candidates from the cross-map.
