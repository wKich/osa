# Tasks

## 1. Interrupt test

- [x] 1.1 Add `bridge/test/interrupt.test.ts`: one spawned bridge with
      `FAKE_MAKI_TRACE`, one session, a prompt that keeps the turn open
      (`run exactly: sleep 2 .`), wait for `session.execution.started`, then
      `POST /api/session/{id}/interrupt`. Verify:
      `cd bridge && bun test interrupt` passes.
- [x] 1.2 Assert: the route answers `200` with exactly `{interrupted:false}`;
      no `session.execution.succeeded` exists before the interrupt; the turn
      reaches `session.execution.succeeded` afterwards; no
      `session.execution.interrupted` frame is emitted; the child's inbound
      trace holds no `control_request`/`interrupt` or other cancellation
      frame; an unknown session answers `404` `SessionNotFoundError`. Verify:
      each assertion fails when the matching route arm or translator line is
      mutated (or inspect the per-case `expect`s and the passing run).
- [x] 1.3 Confirm no fixture was added, so
      `bridge/test/fixtures/provenance.json` stays untouched. Verify:
      `git status --short bridge/test/fixtures` prints nothing.

## 2. Status and report

- [x] 2.1 Edit `bridge/compat/statuses.json`: `interrupt-round-trip` →
      `degraded` with `bridge/test/interrupt.test.ts` as evidence and a title
      naming the accepted-but-not-cancelled limitation; move the
      `POST /api/session/{sessionID}/interrupt` route row's evidence to the same test
      (status stays `served-faked`). Verify: `cd bridge && bun test crosscheck`
      passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm both rows read as
      expected. Verify: `make compat` exits 0 with the regenerated report
      staged (temporary `GIT_INDEX_FILE`, not the real index).
- [x] 2.3 Confirm no row points its evidence into
      `openspec/changes/add-interrupt-coverage/`. Verify:
      `grep -rn "add-interrupt-coverage" bridge/compat/statuses.json
      docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-interrupt-coverage"`. Verify: all five exit 0.
