# Design

## Context

See `proposal.md` — Why. Today the status file enumerates 143 pinned routes
(10 served-live, 129 served-faked, 4 deferred, 0 unhandled) and 31 wire
features (22 verified, 6 degraded, 3 unverified), and the report renders all
of them flat. Measured traffic tells a much smaller story: the committed TUI
capture (`bridge/test/captures/tui-last-requests.jsonl`) and the archived
fixture (`bridge/test/fixtures/bridge-requests.jsonl`) each contain the same
28 routes, of which 6 are `served-live`, 21 `served-faked`, and 1 `deferred`.
The remaining 115 routes are never called in the captured sessions; most have
no Maki counterpart at the pin (PTY, integrations, worktrees, voice, VCS).

The status vocabulary is spec-fixed and stays untouched: routes
`served-live|served-faked|deferred|unhandled`, features
`verified|unverified|degraded|buggy`. The change adds two orthogonal fields
rather than new statuses, so existing gates and evidence rules keep working.

## Goals / Non-Goals

**Goals**
- Give every row a measured `scope` so the report's denominator is the
  surface the TUI uses, not the whole pinned contract.
- Record why a remaining gap is not being closed: `blockedBy: pin` versus an
  open candidate.
- Generate a burndown section with counts and the next three items.
- Make reachability verifiable offline: a captured route without a reachable
  row fails the suite.

**Non-Goals**
- No status flips and no bridge/translator changes.
- No promotion of faked routes to live; triage is a follow-up.
- No trend database or history file: git history of the generated report is
  the trend.
- No change to `defects.json` or the defect loop.

## Decisions

1. **Reachability is measured, not derived from the contract.** The source of
   truth is the union of the two committed request captures. A longer TUI
   session may add routes; the crosscheck then fails until the new route is
   scoped, which is the intended prompt to re-triage. SSE (`GET /api/event`)
   is reachable by construction (the TUI subscribes and `contract.test.ts`
   asserts the stream); it is not in the HTTP request log, so the crosscheck
   counts the 28 logged routes and the feature lens covers the stream.
2. **Two fields, not a triage ledger.** `scope` answers "is this part of the
   compatibility target", `blockedBy` answers "can it move without an upstream
   change". A separate `action` field would duplicate the status: an
   `unverified` reachable row with `blockedBy: none` is an open candidate; a
   `degraded` row with `blockedBy: none` is a limitation worth closing; a
   `degraded`/`unverified` row with `blockedBy: pin` is out of our hands.
3. **Scope assignment is mechanical at first.** Route rows in either capture
   or already `served-live` become `reachable` (32: the 28 measured plus SSE,
   session list, delete, and agent switch, which the capture did not exercise);
   all other pinned routes become `out-of-scope`. Feature
   rows are `reachable` except `sdk-control-handshake`, which is
   `out-of-scope`: the pinned Maki child tolerates the bridge never sending
   `initialize` (recorded in the iteration-3 cross-map as "record, don't
   build"). `blockedBy: pin` is set on `mid-session-model-switch` and
   `agent-switch-state` — both need a Maki inbound subtype the pin does not
   expose. Everything else gets `blockedBy: none`.
4. **The burndown is a derived section, not a second artifact.** `gen-compat`
   renders it from the same status file; no hand-written counts. The section
   sits above the full tables and stays short enough to read in one screen.
5. **The next list is deterministic.** Filter feature rows: `scope:
   reachable`, effective status not `verified`, `blockedBy` not `pin`, source
   order, take 3. No priority scoring: impact ordering is a human call, and a
   generated score would pretend to be objective. Routes are summarized by
   count instead: a faked route is a scope statement, not a next item.
6. **Out-of-scope rows remain visible.** They keep their status and evidence
   in the full tables; only the burndown counts and the next list exclude
   them. This is the difference between "decided" and "forgotten".
7. **The reachability check normalizes ids.** Capture paths carry real
   `ses_…`/`per_…` ids, while status templates use `{sessionID}` /
   `{requestID}`; the check rewrites both to their template form before
   lookup, mirroring how `bridge/test/lib` already handles sessions.

## Risks / Trade-offs

- [A short capture set undercounts what the TUI really calls] → Every TUI
  pass rewrites the capture, and the crosscheck fails when a new measured
  route is unscoped, so the set grows instead of silently missing panels.
- [Marking a feature `out-of-scope` hides work] → The full table still lists
  it with evidence; the decision can be reversed with one field, and the spec
  requires the row to stay auditable.
- [The 21 reachable faked routes still look inert] → They are reported as
  `served-faked` with `scope: reachable`, counted in the route burndown but
  not as open feature gaps; promoting them is a separate product decision.
- [Skills and report can drift] → The two skill edits are procedural text in
  this same change; the report's counts are generated, so only the prose can
  stale, and the discovery skill's Finish reads the scoreboard from the
  generated report.
