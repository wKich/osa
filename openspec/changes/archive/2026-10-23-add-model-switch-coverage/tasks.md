# Tasks

## 1. Model-switch test

- [x] 1.1 Add `bridge/test/model-switch.test.ts`: one spawned bridge with
      `FAKE_MAKI_TRACE`, one session, wait for the session-scoped
      `model.updated` frame, then `POST /api/session/{id}/model`. Verify:
      `cd bridge && bun test model-switch` passes.
- [x] 1.2 Assert: the route answers `204`; the session read, session list, and
      the next turn's `session.step.started` still report the announced
      `synthetic/fake`; an unknown session answers `404`
      `SessionNotFoundError`; the child's inbound trace holds no model-control
      frame. Verify: each assertion fails when the matching line in
      `sessionRoute` or `sessionObject` is mutated (or inspect the per-case
      `expect`s and the passing run).
- [x] 1.3 Confirm no fixture was added, so
      `bridge/test/fixtures/provenance.json` stays untouched. Verify:
      `git status --short bridge/test/fixtures` prints nothing.

## 2. Status and report

- [x] 2.1 Edit `bridge/compat/statuses.json`:
      `mid-session-model-switch` → `degraded` with
      `bridge/test/model-switch.test.ts` as evidence and a title naming the
      accepted-but-not-forwarded limitation; move the
      `POST /api/session/{sessionID}/model` route evidence to the same test
      (status stays `served-live`). Verify: `cd bridge && bun test crosscheck`
      passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm both rows read as
      expected. Verify: `make compat` exits 0 with the regenerated report
      staged (temporary `GIT_INDEX_FILE`, not the real index).
- [x] 2.3 Confirm no row points its evidence into
      `openspec/changes/add-model-switch-coverage/`. Verify:
      `grep -rn "add-model-switch-coverage" bridge/compat/statuses.json
      docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-model-switch-coverage"`. Verify: all five exit
      0.
