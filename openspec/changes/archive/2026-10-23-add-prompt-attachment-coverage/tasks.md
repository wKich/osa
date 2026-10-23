# Tasks

## 1. Attachment test

- [x] 1.1 Add `bridge/test/prompt-attachments.test.ts`: one spawned bridge with
      `FAKE_MAKI_TRACE`, one session, one prompt carrying
      `files:[{uri:"file:///tmp/cat.png", name:"cat.png"}]` and
      `delivery:"steer"`. Verify: `cd bridge && bun test prompt-attachments`
      passes.
- [x] 1.2 Assert: the route answers `200`; the response's admitted user
      payload carries the text and no `files`; `session.inbox.enqueued`
      carries the same text-only payload; after
      `session.execution.succeeded`, the child's inbound trace holds exactly
      one `user` frame whose content is the text block, with no `image` block
      and no occurrence of the attachment URI; an unknown session answers
      `404` `SessionNotFoundError` and appends no inbound frame. Verify: each
      assertion fails when the matching line in `prompt()` or `beginTurn` is
      mutated (or inspect the per-case `expect`s and the passing run).
- [x] 1.3 Confirm no fixture was added, so
      `bridge/test/fixtures/provenance.json` stays untouched. Verify:
      `git status --short bridge/test/fixtures` prints nothing.

## 2. Status and report

- [x] 2.1 Edit `bridge/compat/statuses.json`: `prompt-attachments` →
      `degraded` with `bridge/test/prompt-attachments.test.ts` as evidence and
      a title naming the accepted-but-dropped limitation. Verify:
      `cd bridge && bun test crosscheck` passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm the row reads as
      expected. Verify: `make compat` exits 0.
- [x] 2.3 Confirm no row points its evidence into
      `openspec/changes/add-prompt-attachment-coverage/`. Verify:
      `grep -rn "add-prompt-attachment-coverage" bridge/compat/statuses.json
      docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-prompt-attachment-coverage"`. Verify: all five
      exit 0.
