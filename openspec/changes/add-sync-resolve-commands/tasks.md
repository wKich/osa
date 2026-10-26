# Tasks

## 1. Test harness

- [x] 1.1 Add fixtures to `tests/run-tests.sh` that leave a sandbox `retained` (git project, clean host), `retained` with a host edit on the same lines, `retained` with a dirty host on other files, `retained` in a plain folder, and `parked` (`--no-sync`), for `maki-oss` and `opencode-oss`. Verify with a self-check that `osa projects --json` reports the expected pending kind for each, under `make test`.

## 2. osa resolve dispatch

- [x] 2.1 In `bin/osa`, add `resolve SANDBOX ACTION [--yes] [--json]`: accept only `apply`, `branch`, `drop`, `rescue`, `discard`; find the entry by matching registry file names (design D1); refuse unregistered and orphan entries with exit 2; run the front-end's `__resolve` in `host_path` with `--name`. Update `usage()`, the unknown-command error, and `fish/completions/osa.fish`. Verify with tests for each refusal (stub log shows no gateway call) and for `osa up` listing `resolve`.
- [x] 2.2 Route `__resolve` in `bin/maki-oss`, `bin/opencode-oss`, and `bin/claude-oss` (and `bin/codex-oss` if `add-codex-oss` has landed) to a new `cmd_resolve` in `lib/oss-core.sh` that loads the marker and refuses a wrong pending kind with the spec's messages and exit 2. Verify with tests: `apply` on a parked sandbox and `rescue` on a retained one change nothing and name the right actions.
- [x] 2.3 Implement the `--json` result object and exit codes 0/1/2/3 (design D8), with notes on stderr only. Verify with tests that parse stdout as JSON for a success, a refusal, and a failure, and assert stdout has nothing else.

## 3. Retained actions

- [x] 3.1 Split `plain_apply`'s check-and-apply into a side-effect-free helper used by both exit sync and `cmd_resolve` (design D2). Verify with the existing exit-sync tests passing unchanged.
- [x] 3.2 Implement `apply`: reverse check, dry run, apply; no commit, no index change; marker removed on success; refusal suggests `branch`; binary patch without git refused. Verify with tests for the clean case (file content changed, `git rev-parse HEAD` and `git diff --cached` unchanged, patch file still present), the conflicting case (byte-identical project tree before and after), the already-applied case, and a plain folder with and without `git` on `PATH`.
- [x] 3.3 Implement `branch` (design D3): base from `baseline`, `cat-file -e` guard, temporary worktree under the session's `worktrees/`, three-way fallback, `osa/<sandbox>-<stamp>` branch, worktree removal, full cleanup on failure. Verify with tests that the branch commit's parent is the recorded base and its diff equals the patch, that `git status --porcelain=v1 -z` and `HEAD` are unchanged with a dirty host, that `git worktree list` shows no leftover, that a conflict leaves no branch, and that a plain folder is refused.
- [x] 3.4 Implement `drop --yes` moving the patch to `dropped/` and removing the marker; without `--yes`, exit 2. Verify with tests for both.

## 4. Parked actions

- [x] 4.1 Implement `rescue` (design D5): download the workdir into `rescue-<stamp>/` in the session directory, start a stopped sandbox first and say so, keep the marker. Verify with tests that the stub log shows a `sandbox download` into that directory only, that no project file changed, and that the marker is still `parked`.
- [x] 4.2 Implement `discard --yes` through `cmd_upload` with `opt_discard=1` (design D6). Verify with tests that the marker is removed, existing patch files remain, and a following `maki-oss status` reports `clean`; without `--yes`, no upload in the stub log.

## 5. Session and resolve exclusion

- [x] 5.1 Add lock helpers to `lib/osa-state.sh` (`locks/session.<pid>`, `locks/resolve.d/pid`, liveness via `kill -0`, stale cleanup) and take them in the session path and in `cmd_resolve` (design D7). Verify with tests: a resolve while a fake live session file exists is refused naming the PID; a session start while a live `resolve.d` exists is refused; a stale file of a dead PID is cleaned and ignored; two sessions still start together.
- [x] 5.2 Report `busy` in `osa status --quick --json`. Verify with a test that it is `true` with a live session file and `false` after the holder exits.

## 6. Recovery text and docs

- [x] 6.1 Update `recovery_block` to print the `osa resolve` commands with the real sandbox name for each kind. Verify with the updated "Recovery names the osa resolve commands" test and the existing recovery tests.
- [x] 6.2 Document `osa resolve` in `docs/helper.md` (actions, safety rules, exit codes, `--json`, the lock and its manual override, the dirty-baseline branch note) and add `rescue copy` and `dropped patch` to `docs/glossary.md`. Verify with `make lint-docs` passing.
- [x] 6.3 Run `make test`, `make lint`, and `openspec validate add-sync-resolve-commands --strict`, then resolve one real retained patch on this host with `osa resolve … branch` and record the result in `docs/verification-log.md`. Verify all pass and the log entry exists.
