# Tasks

## 1. Fixture and golden

- [x] 1.1 Add `bridge/test/fixtures/maki-error.jsonl`: copy the captured
      plain turn and rewrite only its `result` line to the pinned
      `error_during_execution` shape (`is_error: true`, `result` carrying the
      failure message, `permission_denials: []`). Verify: the fixture parses
      line by line and its assistant frames are byte-identical to
      `maki-plain.jsonl`'s.
- [x] 1.2 Record `maki-error.jsonl` in `bridge/test/fixtures/provenance.json`
      as `mixed`, naming the captured assistant frames and the source-derived
      result (pin: `sdk_mode.rs` v0.6.4 L995–L1000). Verify:
      `cd bridge && bun test crosscheck` passes.
- [x] 1.3 Add `maki-error` to the `FIXTURES` loop in
      `bridge/test/golden.test.ts` and commit `bridge/test/golden/maki-error.json`
      (seed with `UPDATE_GOLDENS=1`, then review the diff). Verify:
      `cd bridge && bun test golden` passes, and the golden contains
      `session.step.ended` with `finish: "error"`,
      `session.execution.failed` with the wire's message, and no
      `session.execution.succeeded`.

## 2. Status and report

- [x] 2.1 Add the `turn-failure-mapping` feature row to
      `bridge/compat/statuses.json`: status `verified`, evidence
      `bridge/test/golden.test.ts`, title naming the failed-turn mapping and
      the no-success guarantee. Verify: `cd bridge && bun test crosscheck`
      passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm the new row reads
      `verified` with the golden-test link. Verify: `make compat` exits 0.
- [x] 2.3 Confirm no row this change touches points its evidence into
      `openspec/changes/add-turn-failure-coverage/`, so archiving needs no
      path rewrite. Verify: `grep -n "add-turn-failure-coverage"
      bridge/compat/statuses.json docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-turn-failure-coverage"`. Verify: all five exit
      0. `make compat`'s `git diff` half needs the regenerated report staged,
      so run it against a temporary index containing `docs/compatibility.md`
      (`GIT_INDEX_FILE=<tmp> git add docs/compatibility.md`) rather than
      altering the real index.
