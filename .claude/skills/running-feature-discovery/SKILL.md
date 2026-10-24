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
├── unverified/deferred/capability rows → proposing-coverage-change → add-… change (tests or implementation; statuses → verified on green)
├── open defects.json entries           → proposing-fix-change     → fix-… change (code fix, golden flip, status → fixed)
├── diverges/broken journey             → re-triage its linked routes and features here (discovering-tui-journeys records the journey)
└── no counterpart at the pin           → accept/out-of-scope     (status edits only, no code)
```

The branches are parallel, not sequential: `discovery.ts` appends defect
entries itself, so the fix path is entered straight from discovery. A
failing new coverage test is a discovery finding — record it as a defect,
don't ship red tests in an `add-…` change. Re-run discovery after any branch
to confirm closure.

The TUI journey is the native oracle: a feature is `journey-verified` only
when every reachable journey that lists it is at `parity`; a golden or unit
test alone leaves the row `unit-verified only` in the report. A `broken` or
unaccepted `diverges` journey is re-triaged here before new coverage is
proposed.

## Scope (before recording)

Compatibility is claimed only on the surface the TUI exercises. The reachable
set is the union of `bridge/test/captures/tui-last-requests.jsonl`,
`bridge/test/fixtures/bridge-requests.jsonl`, the SSE event stream, and the
routes the bridge serves live; recompute it after a TUI pass adds requests.
Once the journey harness exists, Maki-side journey request logs join that
union, so a route only a recorded journey calls is measured too.
Every other operation in the
pinned contract is `out-of-scope` — recorded, never counted as a gap.

A journey in `bridge/compat/journeys.json` with status `diverges` or `broken`
is a discovery input: re-triage the routes it links and the features it
exercises here before opening a change, because the journey localizes the
user-visible gap. `discovering-tui-journeys` owns the journey row and its
comparison; this skill owns the route/feature/defect rows it feeds.

Done for a pin means: 0 `unhandled`; every reachable route `served-live`,
deliberately-empty `deferred`, or `served-faked` with a triage decision (a
linked feature or a `fakeReason`); 0 untriaged reachable routes; every feature
`verified`, `degraded` with a mirrored pin limitation, or `out-of-scope` with a
reason; 0 open defects; 0 `unverified` rows without a triage decision; 0
reachable journeys that are `broken` or `diverging` without an accepted
difference. The generated report separates `unit-verified only` features from
`journey-verified` features; a route or feature count is never reported as
native proof.

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
bun scripts/compat-drift.ts      # installed OpenCode vs the vendored pin
cd bridge && bun test            # baseline: suite green before any edit
bun scripts/gen-compat.ts --check
```

A `compat-drift` delta makes this pass a rebaseline: update `versions`,
re-enumerate both pins, and re-triage before recording anything else.

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
- **Read-only fetches:** WebFetch a raw file at the pinned tag or read the
  local vendored copies; if a side's source/docs link is absent from
  `docs/ai/references.md`, add it there so `scripts/check-links.sh` tracks it.
- **The sandbox is a valid data source.** A route's real state may come from
  the Maki wire at the pin *or* from the sandbox environment through the
  existing OpenShell exec transport (`bin/maki-oss`) — files, git, processes.
  "Both pins support it" scopes the wire branch, not the route: a route whose
  data lives in the sandbox still earns a capability row, tested against a
  sandbox fixture. Security invariants hold — the bridge reads no host path on
  the client's behalf, adds no bind mount, and reaches sandbox state only
  through the transport it already uses.
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
- New fixture → a `bridge/test/fixtures/provenance.json` entry in the same change
  (`captured`|`authored`|`mixed`): an unlisted fixture fails `crosscheck.test.ts`, and the note prints on the row.
- Verify nothing: `verified` requires a test or fixture path as evidence
  (`bridge/test/crosscheck.test.ts` enforces it).

## Triage (after recording)

Every new or changed row carries `scope` (`reachable|out-of-scope`) and
`blockedBy` (`pin|none`) in `statuses.json`, plus one `action` with a
one-line rationale in the change's evidence matrix:

| Action | When | Hand-off |
| --- | --- | --- |
| `fix` | observed violation of a pinned claim | `defects.json` → proposing-fix-change |
| `coverage` | behavior exists, no proof | proposing-coverage-change, tests only |
| `capability` | behavior missing, the wire at the pin or the sandbox supports it, and the TUI needs it | proposing-coverage-change, implementation branch |
| `accept` | no counterpart at either pin, and the sandbox cannot supply it | status/doc edit in this change |

### Route queue

Every reachable `served-faked` route is debt until it carries a decision: the
TUI reads synthesized data from it today. Decide each one by writing one
optional field in `statuses.json` (never both), or by flipping its status:

| Decision | `statuses.json` encoding | Report shows |
| --- | --- | --- |
| link a feature | `feature: "<id>"` on the fake row | `pin` or `in progress` from the linked feature's `blockedBy`/`status`; `live` once the feature is `verified` and not `blockedBy: pin` |
| accept | `fakeReason: "<why synthesized data is correct>"` | `accept — <reason>` |
| defer | `status: "deferred"` | `deferred` |
| leave | neither field | `untriaged`, counted and listed in the burndown |

A linked feature makes the route real work: open or extend a capability
through `proposing-coverage-change`, and link only a feature row that exists.
A verified, unblocked feature implies `served-live` (`crosscheck.test.ts`
enforces it), so the feature and its route flip in the same change.

`fakeReason` must justify the fake, not the cost of the real thing: it explains
why synthesized data is *correct* (e.g. `GET /api/info` must report the pinned
server version so the TUI does not warn). "No Maki counterpart" or "needs
sandbox plumbing" is a reason to link a feature, not to accept.

Never open a capability change discovery has not recorded.

## Do not

Edit `docs/compatibility.md` by hand · delete or edit existing defect
entries · implement fixes or tests · mark rows `verified` from observation
alone · derive anything from an unpinned or newer-than-pin upstream tag ·
claim coverage of a route the TUI never called without saying
"contract-only".

## Finish

```sh
bun scripts/gen-compat.ts && bun scripts/gen-compat.ts --check
cd bridge && bun test          # crosscheck validates evidence links and re-diffs journeys
make compat                    # regen + git diff --exit-code
make test-journeys             # gated; omit when opencode is absent
```

Report the scoreboard before the details — reachable routes
`live/deferred/faked`, untriaged reachable routes, features
`verified/degraded/unverified/untriaged` split into `journey-verified` and
`unit-verified only`, open defects, and reachable `broken`/`diverges` journeys
without accepted differences — then rows added/changed, defects appended, open
defects deduped, capabilities newly transcribed from upstream (with the pins
they came from), and the top three unblocked reachable items from the
cross-map.
