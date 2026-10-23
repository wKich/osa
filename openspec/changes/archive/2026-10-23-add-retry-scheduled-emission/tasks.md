# Tasks

## 1. Emit the pinned event

- [x] 1.1 `bridge/src/translator.ts`: add `"session.retry.scheduled": 1` to
      `DURABLE_VERSION` and a `system` branch that, while a turn is open,
      emits one event per `api_retry` frame with the frame's positive
      `attempt`, `at: Date.now()`, and `error: {type:"Error", message}`.
      Verify: `cd bridge && bun test golden` passes with the regenerated
      goldens, and a retry frame replayed with no open turn emits nothing.
- [x] 1.2 `bridge/test/lib/projection.ts`: admit the turn on an `api_retry`
      frame (live admission precedes the child write) and strip `at` with the
      other timestamps; capture the sink's `durableVersion` on each replayed
      event without changing the projected golden shape. Verify:
      `cd bridge && bun test golden` passes and the committed goldens for the
      other fixtures are byte-identical.
- [x] 1.3 `bridge/test/golden.test.ts`: add `maki-retry` to `FIXTURES` and
      seed `bridge/test/golden/maki-retry.json` with
      `UPDATE_GOLDENS=1 bun test`; review the two new frames. Keep the
      "undisturbed transcript" test as the same projection filtered of
      `session.retry.scheduled`, compared with `golden/maki-plain.json`, and
      extend it to assert both retry events' `attempt` (`1`, `2`), wrapped
      error messages, non-empty `assistantMessageID`, non-negative `at`, and
      `durableVersion` `1`. Verify: `cd bridge && bun test golden` passes;
      temporarily changing `attempt` or `at` in the translator fails it.

## 2. Status and report

- [x] 2.1 Move `retry-scheduled` `unverified` → `verified` in
      `bridge/compat/statuses.json` with evidence
      `bridge/test/golden.test.ts`; leave `api-retry-tolerance` untouched.
      Verify: `cd bridge && bun test crosscheck` passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm the row reads
      `verified` with the test link and the burndown's next list drops it.
      Verify: `make compat` exits 0 (with the tree's pre-existing
      uncommitted report staged in a temporary `GIT_INDEX_FILE`, as the
      previous change did, so the real index is untouched).
- [x] 2.3 Confirm no row this change touches points its evidence into the
      change directory, so archiving needs no path rewrite. Verify:
      `grep -n "add-retry-scheduled-emission" docs/compatibility.md
      bridge/compat/statuses.json` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-retry-scheduled-emission"`. Verify: all five
      exit 0. The suite stays offline: no Docker, gateway, network, or
      provider call.
