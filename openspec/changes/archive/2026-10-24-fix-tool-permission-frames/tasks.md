# Tasks

## 1. Reproduce and pin

- [x] 1.1 Record `permission-asked-generic-action` and `tool-events-omit-executed`
  in `bridge/defects.json` with the journey checkpoints; link
  `permission-round-trip` and `tool-failure-mapping` as `buggy`. Verify:
  `cd bridge && bun test test/crosscheck.test.ts` passes.
- [x] 1.2 Make the scripted child's journey tool turn follow the pinned order
  and bash result text. Verify: a fake-maki script test shows assistant →
  stream tool_use → can_use_tool.

## 2. Fix

- [x] 2.1 Name the canonical permission action, the shell resource and the
  generalized save scope in `permission.asked` and the pending list. Verify:
  a session-api test asserts `shell`, `["rm -f probe.txt"]`, `["rm *"]`.
- [x] 2.2 Add `executed: false` to tool called/success/failed frames and do not
  emit a second tool part for a streamed block whose id the buffered message
  already rendered. Verify: a translator test asserts both.

## 3. Close and re-record

- [x] 3.1 Close both defects, restore the feature rows to `verified`. Verify:
  discovery prints ok, crosscheck passes.
- [x] 3.2 Re-record `allow-permission-once` offline (twice, byte-identical) and
  live; record any remaining accepted difference with its reason. Verify:
  `make test-journeys`, `make test-journeys-live`.
- [x] 3.3 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate fix-tool-permission-frames --strict`.
