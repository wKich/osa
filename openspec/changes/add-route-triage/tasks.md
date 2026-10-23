# Tasks

## 1. Tooling: triage fields, crosscheck, report

- [x] 1.1 Move `POST /api/session/{sessionID}/interrupt` to `scope: reachable`
  in `bridge/compat/statuses.json` and add a crosscheck test that every
  `served-live` route is `reachable`; verify the test fails with the old scope
  (temporary revert) and passes with the fix, via `cd bridge && bun test`.
- [x] 1.2 Teach `scripts/gen-compat.ts` validation the optional `feature` and
  `fakeReason` route fields (unknown feature id, empty reason, reason on a
  non-`served-faked` row, both fields on one row → invalid); verify each case
  with a temporary edit that `bun scripts/gen-compat.ts --check` exits 1 and
  names the row, then revert.
- [x] 1.3 Add crosscheck tests in `bridge/test/crosscheck.test.ts` for the
  spec's malformed-triage scenarios and the "verified, unblocked linked
  feature implies `served-live`" rule; verify each fails on a temporary bad
  row and the suite passes on the committed file (`cd bridge && bun test`).
- [ ] 1.4 Render the derived decision (design decision 1) as a Decision column
  in the reachable route table, and add the untriaged reachable route count
  and the first three untriaged routes to the burndown; verify the regenerated
  report shows 33 reachable routes, 21 untriaged, and `make compat` exits 0
  after committing the regenerated `docs/compatibility.md`.
- [x] 1.5 Confirm the untriaged rule does not fail the suite: `cd bridge &&
  bun test` passes with all 21 reachable fakes still untriaged.

## 2. Skills, via the writing-skills method

- [ ] 2.1 Baseline (RED): run a fresh subagent with the current
  `.claude/skills/running-feature-discovery/SKILL.md` and the prompt "triage
  the reachable `served-faked` routes `GET /api/vcs` and `GET /api/info` from
  `bridge/compat/statuses.json`"; record the verbatim decisions and
  rationalizations in `evidence/skill-baseline.md`. Verify the file exists
  and shows `GET /api/vcs` was not triaged as live work.
- [ ] 2.2 Rewrite `running-feature-discovery`: replace "a `served-faked` route
  with no feature row is a scope statement, not debt" with the route queue
  (reachable fakes are debt until triaged); add the four route decisions with
  their `statuses.json` encoding (design decision 1); state the sandbox as a
  valid data source with the security invariants (design decision 4) and the
  `fakeReason` rule (design decision 5); add "untriaged reachable routes" to
  the Done-for-a-pin list and the scoreboard. Verify with `grep -n` that the
  old sentence is gone and each new rule is present.
- [ ] 2.3 Amend `proposing-coverage-change`: a capability slice that a route
  links via `feature` flips that route to `served-live` (evidence: the new
  test) in the same change; a live route's feature row is `reachable`. Verify
  with `grep -n`.
- [ ] 2.4 Re-run (GREEN): repeat 2.1's prompt against the rewritten skills in
  a fresh subagent; record in `evidence/skill-after.md`. Verify `GET /api/vcs`
  is triaged live with a sandbox-sourced capability row and `GET /api/info`
  is accepted with a reason that justifies the fake. If either fails, revise
  2.2/2.3 and re-run until both pass (REFACTOR), noting each loophole closed.

## 3. Gate

- [ ] 3.1 Run in one pass: `make test`, `make test-bridge`, `make compat`,
  `make lint`, `openspec validate "add-route-triage" --strict`; all exit 0,
  and `bun bridge/test/discovery.ts` followed by `git diff --exit-code
  bridge/defects.json` shows no new defects.
