# Tasks

## 1. Record fixture provenance

- [x] 1.1 Create `bridge/test/fixtures/provenance.json` with entries for all
      nine fixtures, `maki-subagent.jsonl` and `maki-stream.jsonl` at `authored`,
      `maki-retry.jsonl` at `mixed` with its spliced `api_retry` frame spelled
      out, and the rest `captured`, verified by
      `python3 -c "import json;print(sorted(json.load(open('bridge/test/fixtures/provenance.json'))))"`
      matching `ls bridge/test/fixtures/*.jsonl`

## 2. Enforce the record

- [x] 2.1 Add the bidirectional provenance assertion to
      `bridge/test/crosscheck.test.ts`, and verify `cd bridge && bun test` is
      green
- [x] 2.2 Verify the assertion actually bites by temporarily adding an
      unlisted fixture and confirming the suite fails and names it, then
      removing it and confirming the suite is green again

## 3. Report the provenance

- [x] 3.1 Read `provenance.json` in `scripts/gen-compat.ts` and render the
      note on feature rows whose evidence consumes an authored or mixed
      fixture, and verify the `subagent-nesting` row in the generated
      `docs/compatibility.md` carries the source-derived note
- [ ] 3.2 Add `caveat: "contract-only"` to the `subagent-nesting` row in
      `bridge/compat/statuses.json`, render it in `gen-compat.ts`, and verify
      `make compat` exits 0 with the caveat visible on that row

## 4. Carry it through the loop

- [x] 4.1 Add the two-line provenance rule to
      `.opencode/skills/running-feature-discovery/SKILL.md` under "Record
      findings", and verify `git diff` shows only that skill changed
- [x] 4.2 Add the two-line fixture-kind rule to
      `.opencode/skills/proposing-coverage-change/SKILL.md` under its task
      list, and verify `git diff` shows only that skill changed

## 5. Verify

- [ ] 5.1 Run `make test`, `make test-bridge`, `make compat`, `make lint`,
      and `openspec validate "add-evidence-strength-tier"` in one pass, and
      verify all exit 0 with `git diff --stat bridge/src` empty
- [ ] 5.2 Confirm no status changed by diffing
      `bridge/compat/statuses.json` against HEAD, and verify the only edit is
      the added `caveat` field on `subagent-nesting`
