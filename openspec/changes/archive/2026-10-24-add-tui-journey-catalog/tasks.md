# Tasks

## 1. Catalog schema and gate

- [x] 1.1 Create `bridge/compat/journeys.json` with the shape in design
  decision 2 (`pin` plus an empty `journeys` list) and verify it parses with
  `bun -e 'require("./bridge/compat/journeys.json")'`.
- [x] 1.2 Validate the catalog in `scripts/gen-compat.ts`: required fields,
  unique kebab-case slugs, the `area`, `scope`, `blockedBy`, and status
  vocabularies, at least one step and one checkpoint, `acceptedDiffs` naming a
  real checkpoint with a non-empty reason, an out-of-scope reason. Verify each
  rule with a temporary bad row that `bun scripts/gen-compat.ts --check`
  exits 1 and names the row, then revert.
- [x] 1.3 Add crosscheck tests in `bridge/test/crosscheck.test.ts` for the
  spec scenarios: linked route and feature rows exist; every status past
  `unrecorded` has a committed reference snapshot; `parity`, `diverges`, and
  `broken` have committed Maki-side and diff evidence; `parity` has no
  unaccepted difference; `broken` has no accepted difference. Verify each with
  a temporary bad row, then `cd bridge && bun test` passes on the committed
  file.
- [x] 1.4 Render the journey lens in `docs/compatibility.md` (table split by
  scope, burndown line with reachable counts by status and the native parity
  score, accepted-difference reasons beside their journey); verify
  `make compat` exits 0 after committing the regenerated report and that an
  empty catalog renders a 0-journey line without dividing by zero.

## 2. Skill, via the writing-skills method

- [x] 2.1 Baseline (RED): run a fresh subagent without the new skill on the
  three pressure scenarios in design decision 7; record verbatim choices and
  rationalizations in `evidence/skill-baseline.md`. Verify the file shows at
  least one failure per scenario (sampling from captures, parity without
  snapshots, or a wrong scope).
- [x] 2.2 Write `.claude/skills/discovering-tui-journeys/SKILL.md` with the
  sections in design decision 7, addressing each recorded rationalization
  explicitly; verify the frontmatter `description` states when to use it and
  `grep -n` finds the hand-off table and every "Do not" rule.
- [x] 2.3 Amend `.claude/skills/running-feature-discovery/SKILL.md`: a
  diverging or broken journey is a discovery input, and Maki-side journey
  request logs join the measured reachable set once they exist (design
  decision 6); verify with `grep -n`.
- [x] 2.4 Re-run (GREEN): repeat 2.1's scenarios with the skill loaded in a
  fresh subagent; record in `evidence/skill-after.md`. Verify every scenario
  now passes; if not, close the loophole in 2.2 and re-run (REFACTOR), noting
  each fix.

## 3. Seed the catalog

- [x] 3.1 Add the OpenCode TUI source location at tag `v2.0.32` to
  `docs/ai/references.md` if absent; verify `scripts/check-links.sh` passes.
- [x] 3.2 Run the skill's enumeration pass against the TUI source at
  `v2.0.32` (read-only: a shallow clone into the scratch area or raw fetches
  at the tag) and record every journey as `unrecorded` with scenario, source
  citation, scope, and linked rows; write the enumeration log to
  `evidence/journey-enumeration.md` listing each source file read. Verify
  `bun scripts/gen-compat.ts --check` and `cd bridge && bun test` pass.
- [x] 3.3 Cross-check the seed: every route in the two committed captures is
  linked from at least one journey, and every out-of-scope journey carries a
  reason; verify with a `bun -e` tally recorded in the enumeration log.

## 4. Gate

- [x] 4.1 Run in one pass: `make test`, `make test-bridge`, `make compat`,
  `make lint`, `openspec validate "add-tui-journey-catalog" --strict`; all exit
  0, and `bun bridge/test/discovery.ts` followed by `git diff --exit-code
  bridge/defects.json` shows no new defects.
