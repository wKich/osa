# Tasks

## 1. Fixture and harness seam

- [x] 1.1 Add `bridge/test/fixtures/maki-stream.jsonl`: turn 1 = the
      `maki-plain.jsonl` `system.init`, `stream_event` frames
      (`message_start`, `content_block_start{thinking}`, two
      `thinking_delta`, `content_block_stop`, `content_block_start{text}`,
      two `text_delta`, `content_block_stop`, `message_stop`), then the
      verbatim buffered `assistant` + `result` lines; turn 2 = streamed
      `tool_use` input (`content_block_start{tool_use id/name}`, two
      `input_json_delta` whose concatenation equals the buffered
      `JSON.stringify(input)` exactly, `content_block_stop`), then the
      verbatim buffered `assistant` (thinking + tool_use), `tool_result`
      `user`, and `result` lines from `maki-tool.jsonl`. Verify: the file
      parses as JSONL, and `diff` of its non-stream/buffered lines against
      the two source fixtures is empty.
- [x] 1.2 In `bridge/test/lib/projection.ts` `runFixture`, admit a turn at
      the first `stream_event` as well as the first `assistant` frame (live
      admission happens at prompt push, before any child frame). Verify:
      `cd bridge && bun test golden` — the four existing goldens are
      unchanged (no existing fixture starts with `stream_event`).

## 2. Golden assertion

- [x] 2.1 Add `"maki-stream"` to the `FIXTURES` loop in
      `bridge/test/golden.test.ts` with a comment recording the limitation:
      the envelope spelling is sdk_mode-derived, never captured from a live
      streaming provider. Generate `golden/maki-stream.json` with
      `UPDATE_GOLDENS=1 bun test golden` and review it frame by frame
      (incremental deltas, full-text ends, `message_*` silent, no duplicate
      part frames from the buffered messages). Verify: `cd bridge && bun
      test golden` passes, and splitting a delta line in the fixture
      changes the golden while deleting the buffered assistant line leaves
      the part frames identical.

## 3. Statuses and report

- [x] 3.1 Flip the `stream-deltas` row in `bridge/compat/statuses.json`
      from `unverified` to `degraded` with evidence
      `bridge/test/golden.test.ts`. Verify: `cd bridge && bun test
      crosscheck` passes.
- [x] 3.2 Regenerate `docs/compatibility.md` via `make compat`. Verify: the
      command exits 0 and the row now reads `degraded` with its evidence
      link.

## 4. Wrap-up gate

- [x] 4.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-stream-delta-coverage"`. Verify: all five
      exit 0.
