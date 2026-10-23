# Tasks

## 1. Offline isolation test

- [x] 1.1 Add `bridge/test/session-isolation.test.ts` spawning its own bridge:
      create two sessions, map each to its `pgrep -P` child pid, fire both
      prompts with `Promise.all`, and assert per-session filters — one
      `session.inbox.enqueued` with that session's prompt id, one
      `session.text.ended` carrying `PONG`, one
      `session.execution.succeeded`, and no frame scoped to an unknown
      session. Verify: `cd bridge && bun test session-isolation` passes; it
      fails on the cross-talk assertions if `onMakiFrame` is patched to route
      every child's frames to all sessions (restore afterwards).
- [x] 1.2 Add the teardown half to the same file: delete the first session,
      assert its child pid dies within 10s while the second stays alive, the
      deleted session reads back 404 `SessionNotFoundError`, and the
      surviving session still runs a turn. Verify: same command passes; the
      assertion fails if `DELETE` kills every child.

## 2. Status and report

- [x] 2.1 Add the `session-isolation` feature row to
      `bridge/compat/statuses.json` after `session-crud`: status `verified`,
      evidence `bridge/test/session-isolation.test.ts`, title naming the
      concurrent-transcript and child-lifecycle isolation. Verify: `cd bridge
      && bun test crosscheck` passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm the new row reads
      `verified` with the test link. Verify: `bun scripts/gen-compat.ts` then
      `git diff docs/compatibility.md` shows only the added row.
- [x] 2.3 Confirm no row this change touches points its evidence into
      `openspec/changes/add-session-isolation-coverage/`, so archiving needs
      no path rewrite. Verify: `grep -n "add-session-isolation-coverage"
      bridge/compat/statuses.json docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and `openspec validate
      "add-session-isolation-coverage"`. Verify: all five exit 0.
