# Tasks

## 1. Status fields

- [x] 1.1 Add `scope` and `blockedBy` to every route and feature row in
  `bridge/compat/statuses.json` using the design's assignment rule: routes
  present in `bridge/test/captures/tui-last-requests.jsonl` or
  `bridge/test/fixtures/bridge-requests.jsonl` are `reachable`, the rest
  `out-of-scope`; features are `reachable` except `sdk-control-handshake`
  (`out-of-scope`); `blockedBy: pin` on `mid-session-model-switch` and
  `agent-switch-state`, `none` elsewhere. Verify every row carries both fields
  and the reachable route count is 32:
  `jq -e '([.routes[], .features[]] | map(has("scope") and has("blockedBy")) | all) and ([.routes[] | select(.scope=="reachable")] | length == 32)' bridge/compat/statuses.json`
  exits 0.
- [x] 1.2 Confirm no status value changed in the same edit: `git diff -U0
  bridge/compat/statuses.json` shows only added keys, and
  `cd bridge && bun test` still passes.

## 2. Crosscheck

- [x] 2.1 Extend `bridge/test/crosscheck.test.ts` to reject a route or feature
  row whose `scope` is not `reachable|out-of-scope` or whose `blockedBy` is
  not `pin|none`; verify with a temporary edit that the suite fails, then
  revert.
- [x] 2.2 Add the measured-route check: normalize `ses_…`/`per_…` ids in both
  request captures to the status templates and assert every measured route has
  a row with `scope: reachable`. Verify the suite passes, and fails when one
  captured route's scope is flipped to `out-of-scope`.
- [x] 2.3 Keep the SSE stream covered: assert `GET /api/event` remains
  `served-live` and is not counted by the HTTP capture check; verify with
  `cd bridge && bun test`.

## 3. Burndown

- [x] 3.1 Extend `scripts/gen-compat.ts` with the Burndown section: reachable
  route counts by status, reachable feature counts split by `blockedBy`, open
  defect count, and up to three next items filtered as designed. Verify the
  rendered counts against a one-off `bun -e` tally of `statuses.json` (32
  reachable routes: 10 live, 1 deferred, 21 faked; 30 reachable features: 22
  verified, 6 degraded (2 pin-blocked), 2 unverified; 1 out-of-scope feature,
  `sdk-control-handshake`; 0 open defects).
- [x] 3.2 Regenerate `docs/compatibility.md` and verify the Burndown sits
  above the full tables, excludes `out-of-scope` rows from counts, and
  `make compat` exits 0.

## 4. Skills and gates

- [x] 4.1 Confirm `.opencode/skills/running-feature-discovery/SKILL.md` has
  the Scope and Triage sections plus the `compat-drift` baseline command, and
  `.opencode/skills/proposing-coverage-change/SKILL.md` has the
  capability branch and the one-change rule; verify the wording matches this
  change's vocabulary (`scope`, `blockedBy`, `reachable`, `out-of-scope`).
- [x] 4.2 Run the full gate in one pass: `make test`, `make test-bridge`,
  `make compat`, `make lint`, and `openspec validate "add-compat-burndown"`;
  all exit 0 and `bun bridge/test/discovery.ts` appends nothing.
