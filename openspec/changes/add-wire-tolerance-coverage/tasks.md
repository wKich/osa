# Tasks

## 1. Fixture and golden assertion

- [x] 1.1 Add `bridge/test/fixtures/maki-retry.jsonl`: the three
      `maki-plain.jsonl` lines verbatim with two
      `{"type":"system","subtype":"api_retry","attempt":…,"retry_delay_ms":…,"error":…}`
      frames interleaved (one after `system.init`, one between the
      `assistant` and `result` frames). Verify: the file parses as JSONL,
      `diff <(grep -v api_retry …) bridge/test/fixtures/maki-plain.jsonl` is
      empty.
- [x] 1.2 Add a golden test in `bridge/test/golden.test.ts` asserting
      `project(runFixture("maki-retry"))` deep-equals
      `readGolden("golden/maki-plain.json")` (do **not** add the fixture to
      the `FIXTURES` loop). Verify: `cd bridge && bun test golden` passes,
      and temporarily deleting one `api_retry` line makes no difference
      while perturbing the assistant line makes it fail.

## 2. Statuses and report

- [x] 2.1 Flip the `api-retry-tolerance` row in
      `bridge/compat/statuses.json` from `unverified` to `verified` with
      evidence `bridge/test/golden.test.ts`. Verify:
      `cd bridge && bun test crosscheck` passes (a `verified` row must name
      an existing test or fixture).
- [x] 2.2 Regenerate `docs/compatibility.md` via `make compat`. Verify:
      the command exits 0 and the row now reads `verified` with its evidence
      link.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-wire-tolerance-coverage"`. Verify: all five
      exit 0.
