# Tasks

## 1. Offline deferred-surface test

- [x] 1.1 Add `bridge/test/deferred-session-surfaces.test.ts` with its own
      bridge and one session: read `GET /api/session/{id}/message`, `/inbox`,
      and `/form`, and assert each answers `200`, `data` is `[]`, the body
      passes `validateBody` against the vendored OpenAPI 2.0.32, and the
      emitted frame count is unchanged by the reads — snapshotted after the
      scripted child's model announcement so the async `model.updated` cannot
      land mid-read. Verify:
      `cd bridge && bun test deferred-session-surfaces` passes, and a
      synthesized sample row (remove the empty-list forcing in
      `bridge/src/spec-answers.ts`) makes it fail.
- [x] 1.2 Add the unknown-session half to the same file: each of the three
      routes for a `ses_` id the bridge never created answers `404` with
      `_tag: "SessionNotFoundError"` and no `200` body. Verify: same command
      passes.

## 2. Status and report

- [x] 2.1 Add the `deferred-session-surface-contract` feature row to
      `bridge/compat/statuses.json` as `verified` with
      `bridge/test/deferred-session-surfaces.test.ts` as evidence, and point
      the `GET /api/session/{sessionID}/message`, `/inbox`, and `/form` route
      rows' evidence at the same test while keeping their status `deferred`.
      Verify: `cd bridge && bun test crosscheck` passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm the new feature row
      reads `verified` with the test link and the three routes still read
      `deferred`. Verify: `bun scripts/gen-compat.ts --check` exits 0 after
      the write, and `git diff docs/compatibility.md` shows only the new row
      and the three evidence links.
- [x] 2.3 Confirm no row this change touches points its evidence into
      `openspec/changes/add-deferred-session-surface-coverage/`, so archiving
      needs no path rewrite. Verify: `grep -n
      "add-deferred-session-surface-coverage" bridge/compat/statuses.json
      docs/compatibility.md` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and `openspec validate
      "add-deferred-session-surface-coverage" --strict`. Verify: all five exit
      0. `make compat`'s `git diff` half needs the regenerated report staged,
      so run it against a temporary index containing `docs/compatibility.md`
      (`GIT_INDEX_FILE=<tmp> git add docs/compatibility.md`) rather than
      altering the real index.
