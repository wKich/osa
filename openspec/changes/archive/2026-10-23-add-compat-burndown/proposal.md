# Proposal

## Why

The compatibility report enumerates 143 routes, of which 129 are `served-faked`,
and counts every one the same whether the TUI ever calls it or not. That
denominator makes the report unreadable as a work queue: PTY, integrations,
and worktrees have no Maki counterpart at the pin and will never be live, so
"129 faked" reads as debt when most of it is a scope decision. At the same
time, three `unverified` feature rows look identical whether they are open
candidates, blocked by the Maki pin, or deliberately not built.

There is no target and no scoreboard. Discovery ends with prose "candidates",
so nothing records what compatibility means for a given pin, what remains, or
whether the last iteration moved the number.

## What Changes

- Add `scope` (`reachable|out-of-scope`) and `blockedBy` (`pin|none`) to every
  row in `bridge/compat/statuses.json`. Reachable is measured from the
  committed TUI request captures plus the routes the bridge serves live, not
  assumed from the contract.
- Render a **Burndown** section in `docs/compatibility.md`: reachable route
  counts by status, feature counts split by `blockedBy`, open defects, and the
  next three unblocked reachable items. The full route/feature tables stay
  below it unchanged.
- Extend `bridge/test/crosscheck.test.ts`: every row carries a valid
  `scope`/`blockedBy`, and every route in the two committed request captures
  has a row with `scope: reachable`.
- Align the two project skills with the loop they describe (text applied in
  this change): `running-feature-discovery` gains Scope and Triage sections,
  the drift trigger, and scoreboard reporting; `proposing-coverage-change`
  gains the missing-behavior (capability) branch and its one-change rule.
- Regenerate `docs/compatibility.md`.
- No status flips and no bridge/translator runtime change in this slice; the
  triage values it enables are a follow-up.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: the generated compatibility report requirement gains
  a measured reachable/out-of-scope scope on every row, a required
  `blockedBy` marker, a reachability completeness check, and the burndown
  section that reports the scoped surface rather than the whole contract.

## Impact

- Report data: `bridge/compat/statuses.json` (two fields per row, no status
  changes).
- Report generator: `scripts/gen-compat.ts` (burndown section).
- Tests: `bridge/test/crosscheck.test.ts` (field validity + measured-route
  completeness).
- Generated artifact: `docs/compatibility.md` (regenerated).
- Skills: `.opencode/skills/running-feature-discovery/SKILL.md`,
  `.opencode/skills/proposing-coverage-change/SKILL.md` (procedural text only).
- No bridge runtime, API, dependency, sandbox, or security-surface change. The
  suite stays offline: no Docker, gateway, network, or provider call.
