# Tasks

## 1. Prompt on stdin (`claude-oss run`)

- [x] 1.1 Add `test_cc_run_stdin_prompt`, `test_cc_run_stdin_large` (2 MiB prompt; the openshell stub's recorded argv must not contain it) and `test_cc_run_stdin_empty` to `tests/run-tests.sh`. Verify that they fail against the current helper.
- [x] 1.2 Make `run` without a prompt argument, or with `-`, relay the helper's stdin through the `sandbox exec` call in `lib/oss-core.sh`, and make `bin/claude-oss` (`agent_headless_argv`, `agent_exec_stdin`) omit the prompt from argv in that case. Reject empty stdin with exit 1 before any gateway call. Verify that the 1.1 tests and the existing `test_cc_run_argv` pass (`tests/run-tests.sh`).
- [x] 1.3 Check that the `--timeout` wrapper still works with a piped prompt: add `test_cc_run_stdin_timeout`, where a stub `claude` that sleeps exits 124 and the tagged processes are swept. Verify with `tests/run-tests.sh`.

## 2. Permission pass-through (`claude-oss run -- ...`)

- [x] 2.1 Add these tests:
  - `test_cc_run_passthrough_role_flags`: no `--dangerously-skip-permissions`, and the order is model, session flags, pass-through, prompt.
  - `test_cc_run_passthrough_effort_keeps_skip`
  - `test_cc_run_passthrough_rejects_unknown`: `--mcp-config` and `--output-format`.
  - `test_cc_run_passthrough_rejects_bypass`
  - `test_cc_run_passthrough_missing_value`
  - `test_cc_tui_rejects_passthrough`

  Verify that they fail first.
- [x] 2.2 Parse the `--` tail in the `run` path, check it against the allowlist (`--permission-mode`, `--allowedTools`, `--disallowedTools`, `--add-dir`, `--fork-session`, `--effort`), refuse `bypassPermissions`, and drop `--dangerously-skip-permissions` whenever a permission flag is present. The other helpers either keep rejecting a `--` tail or have it handled the same way by the shared parser. Verify that the 2.1 tests and the full `tests/run-tests.sh` pass.

## 3. `sync-in` (shared core)

- [x] 3.1 Add these tests:
  - `test_caller_sync_in_refused_managed`
  - `test_caller_sync_in_requires_target`
  - `test_caller_sync_in_dirty_tree`: modified, untracked and ignored files, and no `.git`.
  - `test_caller_sync_in_linked_worktree`: the `.git` file case.
  - `test_caller_sync_in_removes_stale`
  - `test_caller_sync_in_json`: exactly one object on stdout, with `baseline`, `files` and `bytes`.
  - `test_caller_sync_in_no_state`: nothing is written under `osa/projects` or `osa/sessions`.
  - `test_caller_sync_in_stopped_sandbox`: exit 3.

  Verify that they fail first.
- [x] 3.2 Implement `cmd_sync_in` in `lib/oss-core.sh`:
  - Reuse `cmd_upload`'s `.gitignore` filtering, with no host `.git`.
  - Clear the workdir before the upload.
  - Write the baseline commit with a sandbox-side `GIT_DIR` outside the workdir, using the same layout as the managed baseline and `SANDBOX_COLLECT_SCRIPT`'s refs.
  - Gate the command on caller mode with `require_caller_target 1`.

  Register it in the dispatch for every helper. Verify that the 3.1 tests pass.
- [x] 3.3 Make a failed upload or baseline step leave no baseline that `collect-patch` accepts: write the baseline ref last and clear it first. Add `test_caller_sync_in_failure_clears_baseline`, then verify with `tests/run-tests.sh`.

## 4. `collect-patch` (shared core)

- [x] 4.1 Add these tests:
  - `test_caller_collect_patch_round_trip`: modify, delete, add a binary file, rename, then `git apply` succeeds on the host copy.
  - `test_caller_collect_patch_empty`
  - `test_caller_collect_patch_excludes_agent_git`
  - `test_caller_collect_patch_idempotent`
  - `test_caller_collect_patch_no_baseline`
  - `test_caller_collect_patch_mode_600`
  - `test_caller_collect_patch_failure_removes_file`
  - `test_caller_collect_patch_json`: the `empty`, `baseline` and `files[].status/path` fields.

  Verify that they fail first.
- [x] 4.2 Implement `cmd_collect_patch` in `lib/oss-core.sh`:
  - Run a collect script that diffs the workdir against the `sync-in` baseline.
  - Use a temporary index or a result ref, so the baseline never moves, and exclude any `.git` directory inside the workdir.
  - Write the patch to a host temp file with umask 077, then rename it to `--out`.
  - Emit the `--json` summary from `git diff --name-status`.
  - Gate the command on caller mode.

  Verify that the 4.1 tests pass.

## 5. Docs

- [x] 5.1 Document the new commands in `docs/helper.md` under "Caller-owned workspace":
  - `sync-in` and `collect-patch` semantics and their JSON fields.
  - A full orchestrator sequence: `up`, `sync-in`, `run` with the prompt on stdin and the `--` role flags, `collect-patch`, `git apply --check` and apply on the host, then `rm`.
  - The pass-through allowlist.

  Verify with `make lint-docs`, and by reading the commands in the doc against `claude-oss help` output.
- [x] 5.2 Add `sync-in` and `collect-patch` to each helper's `help` text, in a caller-interface section, and document stdin prompts and `--` pass-through on the Claude agent page in `docs/`. Verify with `test_cc_help` (extend it to expect the new lines) and `make lint-docs`.

## 6. Integration check

- [x] 6.1 Run the full gate with `make test-all`. Verify that all suites pass, including oskhs, which must be unaffected by the caller-mode additions.
- [x] 6.2 On a live OpenShell gateway on macOS, run a sequence by hand: a caller-mode sandbox, `sync-in` of a dirty linked worktree, `claude-oss run` with a piped prompt and `-- --permission-mode acceptEdits`, `collect-patch`, then `git apply` on the host. Verify that stdout is valid stream-json ending in a `result` event, that the patch applies cleanly, and that `git status` in the worktree shows the agent's edit. Record the upload time for the repo in the change's notes, as input for the M4 roadmap item.
