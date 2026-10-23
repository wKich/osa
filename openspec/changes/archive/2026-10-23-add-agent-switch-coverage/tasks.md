# Tasks

## 1. Scripted-child trace seam

- [x] 1.1 Add an opt-in `FAKE_MAKI_TRACE=<path>` to `bridge/test/fake-maki.ts`:
      when set, append every parsed inbound frame as one JSON line. Default
      off, so no existing test's frames or output change. Verify: `cd bridge
      && bun test` passes unchanged, and a run with the env var set shows the
      prompt and `control_response` lines.

## 2. Offline agent-selection test

- [x] 2.1 Add `bridge/test/agent-switch.test.ts` with its own bridge and one
      session: `POST /api/session/{id}/agent` with `{agent: "plan"}` answers
      `204`, `GET /api/session/{id}` and `GET /api/session` report `plan`, and
      a following prompt's first `session.step.started` carries
      `data.agent === "plan"`. Verify: `cd bridge && bun test agent-switch`
      passes; temporarily dropping the `s.agent` assignment in
      `bridge/src/bridge.ts` makes it fail.

- [x] 2.2 Add the negative half to the same file: the route for an unknown
      `ses_` id answers `404` with `_tag: "SessionNotFoundError"`, a read of
      that id still answers `404`, and the trace file shows no
      `control_request` frame (the child is not re-tasked). Verify: same
      command passes; adding a fabricated set-agent frame to the route makes
      the trace assertion fail.

## 3. Status and report

- [x] 3.1 Add the `agent-switch-state` feature row to
      `bridge/compat/statuses.json`: status `degraded`, evidence
      `bridge/test/agent-switch.test.ts`, title naming the recorded-and-
      reported half plus the child-not-retasked limitation. Move the
      `POST /api/session/{sessionID}/agent` route row's evidence from
      `bridge/src/bridge.ts` to the same test, keeping `served-live`. Verify:
      `cd bridge && bun test crosscheck` passes.

- [x] 3.2 Regenerate `docs/compatibility.md` and confirm the new row reads
      `degraded` with the test link and the route row links the test. Verify:
      `bun scripts/gen-compat.ts` then `git diff docs/compatibility.md` shows
      only the new row and the route evidence change.

- [x] 3.3 Confirm no row this change touches points its evidence into
      `openspec/changes/add-agent-switch-coverage/`, so archiving needs no
      path rewrite. Verify: `grep -n "add-agent-switch-coverage"
      bridge/compat/statuses.json docs/compatibility.md` prints nothing.

## 4. Wrap-up gate

- [x] 4.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and `openspec validate
      "add-agent-switch-coverage" --strict`. Verify: all five exit 0.
      `make compat`'s `git diff` half needs the regenerated report staged, so
      run it against a temporary index containing `docs/compatibility.md`
      (`GIT_INDEX_FILE=<tmp> git add docs/compatibility.md`) rather than
      altering the real index.
