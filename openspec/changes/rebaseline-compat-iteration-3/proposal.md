# Proposal

## Why

Iteration 2 enumerated the pinned contract and closed the row gap for every
`/api/*` operation. It scoped itself there, so the one pinned operation outside
`/api/` was never looked at, and the matrices it produced have since been
overtaken by two landed changes (live stream deltas, live subagent capture)
and by a re-read of the pins. Concretely, at the pins:

- `bridge/src/openapi-2.0.32.json` defines **143** operations; `statuses.json`
  holds 142, and the missing one (`GET /auth/connect/{code}`) is answered by
  the bridge (`200`, `matched: true`).
- The event table says the bridge emits 15 of the 51 pinned envelopes; it
  emits 18 (`session.execution.started/succeeded/failed` were unmarked).
- The cross-map says Maki's `system api_retry` has "no direct counterpart";
  the pin defines `session.retry.scheduled`.
- Two matrix rows still describe fixed defects (`message-order-inversion`,
  `synthesized-model-name`) and two still sit `unverified`/`deferred` after
  their statuses flipped to `verified`.
- Maki's per-message envelope (`session_id`, `uuid`) and inbound image blocks
  are wire features the matrices never recorded, while the bridge relies on
  the first and forwards neither side of the second.

None of this is a runtime regression — the passes are green. It is the
enumeration drifting from the pins, which is exactly what the discovery loop
exists to catch.

## What Changes

- Add the missing route row (`GET /auth/connect/{code}`, `served-faked`,
  probe-backed) to `bridge/compat/statuses.json`.
- Add three feature rows the pins define but the status file lacked:
  `wire-envelope`, `prompt-attachments`, `retry-scheduled` — all `unverified`,
  each citing this change's evidence.
- Copy the three evidence matrices and the route classification forward into
  this change and refresh the stale claims (status flips, emit counts, retry
  counterpart, measured terminal route, two wrong dispatch labels).
- Regenerate `docs/compatibility.md`.

No bridge source, test, or defect inventory change. This is a recording pass:
it adds one route row and three feature rows and corrects evidence documents.

## Capabilities

### New Capabilities

(none — the added rows describe existing pinned behavior; none is claimed
verified)

### Modified Capabilities

(none — `openspec/changes/add-oauth-mcp-support` owns the next behavioral
change; this one records compatibility state only)

## Impact

- `bridge/compat/statuses.json` — +1 route row, +3 feature rows.
- `docs/compatibility.md` — regenerated.
- `openspec/changes/rebaseline-compat-iteration-3/evidence/**` — matrices
  copied forward and corrected; `discovery-log.md` records the passes.
- Evidence rows in `statuses.json` cite this change's directory; the archive
  commit must rewrite them to the archived path in the same commit.
- Unaffected: `bridge/src/**`, `bridge/test/**`, `bridge/defects.json`, and
  every security invariant in `AGENTS.md`. Read-only fetches only.
