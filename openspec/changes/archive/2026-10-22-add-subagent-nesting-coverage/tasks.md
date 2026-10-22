# Tasks

## 1. Fixture

- [x] 1.1 Add `bridge/test/fixtures/maki-subagent.jsonl`: the
      `maki-tool.jsonl` parent frames copied verbatim (its `system.init`,
      parent `assistant` with thinking + `tool_use`, parent `user`
      `tool_result`, terminal `result`), with source-pinned nested frames
      interleaved: an `assistant` carrying `parent_tool_use_id` at the
      payload top level beside `message` (subagent text + `tool_use`) and the
      matching flagged `user` `tool_result`, so subagent output lands
      between the parent's launch `tool_use` and its closing frames. Exactly
      one terminal `result`. Verify: the file parses as JSONL; diff of the
      unflagged lines against `maki-tool.jsonl` is empty; each flagged line
      carries the field beside `message` (shape from `maki-sdk-wire-features.md`
      L1105–L1120 / L1116), and no second `result` line exists.
- [x] 1.2 No harness seam: confirm `runFixture` in
      `bridge/test/lib/projection.ts` needs no change (interleaved
      `assistant`/`user` frames mid-turn are already routed with the turn
      open). Verify: `cd bridge && bun test golden` — the five existing
      goldens are byte-identical once the fixture is added but unlisted.

## 2. Golden assertion

- [x] 2.1 Add `"maki-subagent"` to the `FIXTURES` loop in
      `bridge/test/golden.test.ts` with a comment recording the limitations
      from design decision 1: shape source-pinned from `sdk_mode.rs` v0.6.4,
      never captured from a live subagent turn; rendering is inline
      flattening, not child-session separation. Generate
      `golden/maki-subagent.json` with `UPDATE_GOLDENS=1 bun test golden`
      and review it frame by frame: flagged parts appear in arrival order
      under the turn's message with continuing ordinals, the flagged
      `tool_result` emits `session.tool.success` keyed by the subagent tool
      id, and exactly one `session.step.ended` + `session.execution.succeeded`
      follow the single terminal `result`. Verify: `cd bridge && bun test
      golden` passes, and deleting the flagged lines from the fixture yields
      a golden equal to `maki-tool.json` (nesting input changed nothing
      else).

## 3. Statuses and report

- [x] 3.1 Flip the `subagent-nesting` row in `bridge/compat/statuses.json`
      from `unverified` to `verified` with evidence
      `bridge/test/golden.test.ts`. Verify: `cd bridge && bun test
      crosscheck` passes (test path accepted for `verified`, every evidence
      key resolves).
- [x] 3.2 Regenerate `docs/compatibility.md` via `make compat`. Verify: the
      command exits 0 and the row now reads `verified` with its evidence
      link. Evidence stays under `bridge/test/`, so no archive-path note is
      needed when this change archives.

## 4. Wrap-up gate

- [x] 4.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-subagent-nesting-coverage"`. Verify: all five
      exit 0.
