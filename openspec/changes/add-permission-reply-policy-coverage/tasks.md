# Tasks

## 1. Offline tests

- [x] 1.1 Add a case to `bridge/test/session-api.test.ts` that answers a pending
      permission request with `decision: "always"`, observes the gated command
      run once, then prompts a second gated command and asserts a fresh
      `permission.asked` (nothing cached), answering that one too. Verify:
      `cd bridge && bun test session-api` passes, and temporarily caching the
      `always` decision in `replyPermission` makes the new case fail while the
      existing allow/deny cases still pass.
- [x] 1.2 Add a case answering a pending request with a decision outside
      `once`/`always`/`reject` (e.g. `"yes"`), asserting the route answers 400
      with `_tag: "InvalidRequestError"`, the child received
      `behavior: deny` (the turn ends in `session.tool.failed` matching
      /permission denied/i), and the probe target the command would have
      deleted still exists. Verify: `cd bridge && bun test session-api`
      passes, and the case fails if the fail-closed branch is replaced by an
      allow.

## 2. Statuses and report

- [x] 2.1 In `bridge/compat/statuses.json`, change the `permission-reask`
      row's `evidence` from
      `openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log`
      to `bridge/test/session-api.test.ts`; leave `status` at `degraded`.
      Verify: `cd bridge && bun test crosscheck` passes and the row still
      reads `degraded`.
- [ ] 2.2 Regenerate `docs/compatibility.md` with `make compat`. Verify: the
      command exits 0 and the `always` reply row now links the session-api
      test instead of the archived log.

## 3. Wrap-up gate

- [ ] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-permission-reply-policy-coverage"`. Verify:
      all five exit 0.
