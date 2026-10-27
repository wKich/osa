# Tasks

## 1. Reproduce and confirm the target

- [x] 1.1 Confirm the log is ignored and untracked: `git check-ignore -v openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log` prints `.gitignore:3:*.log`, and `git ls-files --error-unmatch openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log` exits non-zero. Verify both commands behave as stated.
- [x] 1.2 Reproduce the clean-checkout failure at the current HEAD:
      `tmp=$(mktemp -d) && git worktree add --detach "$tmp/clean" HEAD && (cd "$tmp/clean" && scripts/check-links.sh docs/compatibility.md); status=$?; git worktree remove --force "$tmp/clean"; exit $status`
      Verify it exits non-zero and prints `FAIL docs/compatibility.md: relative link .../evidence/api-check.log`.
- [x] 1.3 Confirm the replacement is tracked and proves the row: `git ls-files --error-unmatch bridge/test/model-switch.test.ts` exits 0, and `grep -n 'fetch(.*bridge.base.*/api/session' bridge/test/model-switch.test.ts` shows the list fetch whose next assertion checks the created session's live model. Verify both commands succeed.

## 2. Update the source and regenerate

- [x] 2.1 In `bridge/compat/statuses.json`, change only the `GET /api/session` row's `evidence` from the archive `api-check.log` path to `bridge/test/model-switch.test.ts`. Verify with `grep -F '"route": "GET /api/session",' bridge/compat/statuses.json | grep -F 'bridge/test/model-switch.test.ts'` (exits 0) and `grep -c 'api-check.log' bridge/compat/statuses.json` (prints 0).
- [x] 2.2 Regenerate the report with `bun scripts/gen-compat.ts`; verify `git diff -- docs/compatibility.md` changes only the `GET /api/session` Evidence cell to `../bridge/test/model-switch.test.ts` and leaves the status and decision cells alone.
- [x] 2.3 Verify the generator agrees with the committed file: `bun scripts/gen-compat.ts --check` exits 0. Verify no hand edit was made and no other tracked file changed: `git status --short --untracked-files=no` lists only `bridge/compat/statuses.json` and `docs/compatibility.md`, and `git diff --name-only` names no other tracked path.

## 3. Verify the fix

- [x] 3.1 Stage the source and the report, then run `git add bridge/compat/statuses.json docs/compatibility.md && make compat`; verify it exits 0 (the regeneration is a no-op and `git diff --exit-code docs/compatibility.md` is clean). Note: `make compat` fails while the regenerated report is unstaged.
- [x] 3.2 Run `cd bridge && bun test crosscheck.test.ts`; verify it exits 0, so every evidence path exists and every verified feature's report label still matches the journey oracle. Optionally run the full offline suite with `make test-bridge`.
- [x] 3.3 Commit the two files, then prove the clean checkout:
      `tmp=$(mktemp -d) && git worktree add --detach "$tmp/clean" HEAD && (cd "$tmp/clean" && scripts/check-links.sh docs/compatibility.md); status=$?; git worktree remove --force "$tmp/clean"; exit $status`
      Verify it exits 0 and prints `0 failure(s)`; the worktree contains no ignored log, so the link must resolve against tracked files only.
- [x] 3.4 Run `make compat-drift`; verify it either reports no contract drift or skips with its bun/opencode message (a clean skip is acceptable and does not fail this change).
- [x] 3.5 Run `make test` and `make lint-docs`; verify both exit 0 (the shell suite and the docs contract are unaffected, but they are the repository gates).
- [x] 3.6 Run `openspec validate fix-compatibility-evidence-link --strict`; verify it exits 0 with the `skip_specs: true` marker and no spec deltas.

## 4. Rollback

- [x] 4.1 If the chosen evidence is rejected, roll back with `git revert --no-edit <fix-commit>` (it restores both `bridge/compat/statuses.json` and `docs/compatibility.md`); verify `git status --short` is clean afterwards. This is only for a rejected evidence choice, since it restores the broken clean-checkout link; no runtime state or data is involved.
