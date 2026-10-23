# Tasks

## 1. Egress test

- [x] 1.1 Add `bridge/test/permission-egress.test.ts`: one spawned bridge with
      `FAKE_MAKI_TRACE`, a prompt per decision (`once`, `always`, `reject`,
      invalid `yes`), and a trace read after each reply. Verify:
      `cd bridge && bun test permission-egress` passes.
- [x] 1.2 Assert per reply: exactly one new `control_response` on the child's
      stdin; `response.request_id` equals the turn's `control_request`
      request_id; `response.behavior` is `allow` for `once`/`always` and
      `deny` for `reject`/invalid; the response object's keys are exactly
      `request_id` and `behavior`; `permission.replied` is emitted for the
      three accepted decisions and not for the invalid one. Verify: each
      assertion fails when the matching line in `replyPermission` or
      `MakiSession.answer` is mutated (or inspect the test's per-case
      `expect`s and the passing run).
- [x] 1.3 Confirm no fixture was added, so
      `bridge/test/fixtures/provenance.json` stays untouched. Verify:
      `git status --short bridge/test/fixtures` prints nothing.

## 2. Status and report

- [x] 2.1 Edit `bridge/compat/statuses.json`:
      `control-response-emission` → `verified`, evidence
      `bridge/test/permission-egress.test.ts`, title corrected to name the
      bridge's outbound answer; `permission-reply-vocabulary` → `degraded`,
      same evidence, title naming the bare-answer limitation. Verify:
      `cd bridge && bun test crosscheck` passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm both rows read as
      expected. Verify: `make compat` exits 0 with the regenerated report staged
      (temporary `GIT_INDEX_FILE`, not the real index).
- [x] 2.3 Confirm no row points its evidence into
      `openspec/changes/add-permission-egress-coverage/`. Verify:
      `grep -rn "add-permission-egress-coverage" bridge/compat/statuses.json
      docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-permission-egress-coverage"`. Verify: all five
      exit 0.
