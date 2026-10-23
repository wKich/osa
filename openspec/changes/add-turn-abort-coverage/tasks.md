# Tasks

## 1. Scripted-child knob and offline test

- [ ] 1.1 Add `FAKE_MAKI_CRASH=1` to `bridge/test/fake-maki.ts`: on the first
      prompt, emit one assistant text part and exit `1` from the stdout write
      callback, with no `result` frame. Verify: `cd bridge && bun test
      session-api` still passes with the knob unset (no frame or behavior
      changes for existing scripts).
- [ ] 1.2 Add `bridge/test/turn-abort.test.ts` spawning its own bridge with
      `startBridge({ FAKE_MAKI_CRASH: "1" })`, creating a session, and
      asserting: the partial assistant text reaches `session.text.ended`;
      exactly one `session.execution.failed` carries `error.type === "Error"`
      and the child-exit message; zero `session.execution.succeeded`; a later
      prompt answers 503 and emits no new `session.execution.started`.
      Verify: `cd bridge && bun test turn-abort` passes, and deleting the
      `abortTurn` call in `bridge/src/translator.ts` makes the same test fail
      on the missing `session.execution.failed` (restore it afterwards).

## 2. Status and report

- [ ] 2.1 Add the `turn-abort-mapping` feature row to
      `bridge/compat/statuses.json`: status `verified`, evidence
      `bridge/test/turn-abort.test.ts`, title naming the child-exit abort and
      the no-success guarantee. Verify: `cd bridge && bun test crosscheck`
      passes.
- [ ] 2.2 Regenerate `docs/compatibility.md` and confirm the new row reads
      `verified` with the test link. Verify: `bun scripts/gen-compat.ts
      --check` exits 0 after the write.
- [ ] 2.3 Confirm no row this change touches points its evidence into
      `openspec/changes/add-turn-abort-coverage/`, so archiving needs no path
      rewrite. Verify: `grep -n "add-turn-abort-coverage"
      bridge/compat/statuses.json docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [ ] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and `openspec validate
      "add-turn-abort-coverage"`. Verify: all five exit 0. The tree also
      carries the uncommitted `add-turn-failure-coverage` work, so `make
      compat`'s `git diff` half needs the regenerated report staged against a
      temporary index (`GIT_INDEX_FILE=<tmp> git add docs/compatibility.md`)
      rather than altering the real index.
