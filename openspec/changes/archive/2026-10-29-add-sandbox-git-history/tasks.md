# Tasks

## 1. Test coverage first

- [x] 1.1 Add `test_caller_sync_in_history`, `test_caller_sync_in_history_base`, `test_caller_sync_in_history_linked_worktree`, and `test_caller_sync_in_history_no_host_metadata` to `tests/run-tests.sh`. Verify that they fail against the current helper with `RUN_ONLY='test_caller_*' tests/run-tests.sh`.
- [x] 1.2 Add `test_caller_sync_in_history_non_git_fallback`, `test_caller_sync_in_history_base_non_git`, and `test_caller_sync_in_history_missing_base`; assert the first keeps the M1 no-repository behavior and the other two exit 1 before any gateway call. Verify with `RUN_ONLY='test_caller_*' tests/run-tests.sh`.
- [x] 1.3 Add `test_caller_sync_in_history_failure_clears_baseline`, `test_caller_collect_patch_history`, `test_caller_collect_patch_agent_commit`, and `test_caller_collect_patch_helper_git_excluded`. Verify that the failure case leaves no baseline, the history round trip applies cleanly, and the patch contains no `.git` entry.
- [x] 1.4 Add coverage for commit-id/tag base naming, slash-containing branch names, unsafe/invalid ref rejection before gateway access, and staged/partially staged files becoming unstaged with identical on-disk content. Verify with `RUN_ONLY='test_caller_*' tests/run-tests.sh`.
- [x] 1.5 Update `test_caller_sync_in_dirty_tree`, `test_caller_sync_in_linked_worktree`, `test_caller_sync_in_json`, and `test_caller_collect_patch_excludes_agent_git` so a git tree expects a helper-created `.git` file with history, JSON counts exclude helper metadata, and the baseline is absent from ordinary agent repository history without claiming same-uid tamper protection. Verify with `RUN_ONLY='test_caller_*' tests/run-tests.sh`.

## 2. Helper implementation

- [x] 2.1 Add `--base REF` parsing and usage text to `sync-in`. Resolve `REF` to a commit and validate its destination ref before `require_openshell`; preserve short branch names including slashes, use `origin/base` for commit ids/tags/expressions, and safely pass refs without shell interpolation. Reject invalid refs or `--base` on a non-git tree with exit 1 and no gateway call. Verify with the 1.2 cases and `RUN_ONLY='test_caller_sync_in_history_missing_base' tests/run-tests.sh`.
- [x] 2.2 Detect whether `HOST_TREE` is a git worktree; when it is, create a mode-600 temporary bundle of `HEAD` and the optional base commit, upload it to the caller-state area outside the workdir, and remove the host temp file on every exit path. Verify with the history tests and the openshell stub's recorded upload path.
- [x] 2.3 Add `caller_repo_dir` and a sandbox history script: `git init --separate-git-dir=<repo-dir>`, fetch the bundle, set `HEAD` to the host commit, expose `refs/remotes/origin/<base-name>` when requested, `read-tree` the host tree, and mixed-`reset` so the uploaded files stay uncommitted. Verify that `git log`, `git status`, and `git diff` work in `CALLER_WORKDIR` with `RUN_ONLY='test_caller_sync_in_history*' tests/run-tests.sh`.
- [x] 2.4 Keep the existing baseline git directory separate from the agent repository and make `CALLER_CLEAR_SCRIPT` remove both. Ensure a failed bundle/upload/fetch/repository step clears the baseline; verify with `test_caller_sync_in_history_failure_clears_baseline` and `test_caller_collect_patch_no_baseline`.
- [x] 2.5 Preserve the M1 path for non-git `HOST_TREE`; verify with `test_caller_sync_in_history_non_git_fallback` and the existing dirty/tree tests.
- [x] 2.6 Ensure `collect-patch` excludes the helper-created `.git` file as well as an agent-created `.git` repository, and that an agent commit is captured through the worktree tree. Verify with `test_caller_collect_patch_helper_git_excluded`, `test_caller_collect_patch_agent_commit`, and the idempotence case.
- [x] 2.7 Run `make lint` and `make test`; fix any lint or regression failures.

## 3. Documentation

- [x] 3.1 Update the caller-owned workspace section of `docs/helper.md`: history, `--base`, the distinction between host `.git` metadata and the helper-created `.git` file, the non-git fallback, and a reviewer-style `git log`/`git diff origin/<base>` example. Verify with `make lint-docs` and by comparing the `sync-in` help text with the doc.
- [x] 3.2 Validate the change artifacts with `openspec validate add-sandbox-git-history --strict`; fix any spec-format or delta errors.

## 4. Integration and follow-up record

- [x] 4.1 On a live OpenShell gateway, run the full sequence against a dirty linked worktree with a diverged base: `sync-in --base`, reviewer-style `git log`/`git diff origin/<base>`/`git blame`, `collect-patch`, and `git apply` on the host. Record the commands, timings, and results in `openspec/changes/add-sandbox-git-history/notes.md`.
- [x] 4.2 Verify the host-git spike section in `notes.md` against `design.md`: the macOS Docker Desktop test (policy rule, 20 MB clone 0.71 s, push 0.19 s), its setup-specific routing and source-IP observations, anonymous TCP limitations versus the untested authenticated HTTPS alternative, same-uid baseline limitations, transport-commit reconciliation, and the M2b/M2c/M3/host-git/roadmap items. Extend the note if the live check adds evidence.
- [x] 4.3 Run `make test-all`; verify that the shell suite, oskhs, bridge, and dashboard suites pass.
