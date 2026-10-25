# Tasks

## 1. Baseline capture and state

- [x] 1.1 Add host baseline capture for git projects: record the repository
  root, branch, `HEAD`, `HEAD^{tree}`, and `git status --porcelain`. For a
  clean tree use `HEAD`; for a dirty or untracked tree create a synthetic
  baseline commit from a temporary index (`git add -A`, `git write-tree`,
  `git commit-tree -p HEAD`) without touching the user's index or worktree.
  Verify with a new `tests/run-tests.sh` case that asserts the recorded commit,
  tree, branch, clean/dirty state, and that `git status` and the branch are
  unchanged after capture.

- [x] 1.2 Create the sandbox-side baseline after a create-time or explicit
  upload: initialize `GIT_DIR=<sandbox>/.maki-oss/git`,
  `GIT_WORK_TREE=<workdir>`, commit the uploaded tree, and record
  `refs/maki-oss/base`. Verify with a stub `sandbox exec` test that the
  initialization runs after upload and that no command writes into the project
  workdir.

- [x] 1.3 Record the sandbox baseline tree and compare it with the host baseline
  tree before Maki attaches. When they differ, disable the automatic
  fast-forward/apply path while still allowing patch collection. Verify with a
  stub whose sandbox tree differs: the test asserts no automatic apply is
  attempted and the stale-sandbox message is printed.

- [x] 1.4 Add the host session state directory under
  `${XDG_STATE_HOME:-$HOME/.local/state}/maki-oss/sessions/<sandbox>/` with
  `baseline`, patch files, review/worktree paths, and a `pending` marker.
  Create it with owner-only permissions. Verify with a test that asserts the
  directory and files are created with mode `700`/`600` and that a second
  session sees the previous baseline.

- [x] 1.5 Handle an existing sandbox with no baseline ref: create one from the
  current sandbox workdir before Maki runs and warn that pre-existing sandbox
  changes are the baseline and are not exported. Verify with a stub sandbox
  that has no baseline ref and a test asserting the warning plus one baseline
  initialization.

## 2. Patch collection

- [x] 2.1 On session exit, run inside the sandbox: `git add -A`, commit the
  result, update `refs/maki-oss/result`, and write
  `git diff --binary --full-index base result` to a host patch file. Verify
  with a test that asserts the patch is written before any host apply attempt
  and that an interrupt still runs the same collection.

- [x] 2.2 Ensure the patch carries additions, modifications, deletions,
  renames, mode changes, symlinks, and binary changes, and never carries
  `.git`. Verify with a fixture that edits, deletes, renames, and adds a binary
  file, plus a `.git` directory in the sandbox workdir; assert every expected
  path appears and no `.git` path appears in the patch.

- [x] 2.3 Skip collection on `--no-sync`, keep the existing hint, and preserve
  Maki's exit code when collection fails. Verify with tests for `--no-sync`
  (no `git diff`/patch write) and for a failing collection (warning to stderr,
  Maki's exit code preserved).

- [x] 2.4 Stream or redirect large patch output to a file rather than a shell
  variable, and fail closed when the patch cannot be written. Verify with a
  test that stubs a large diff and asserts the patch file is used and no
  command substitution receives the full content.

## 3. Git repository apply path

- [x] 3.1 For a clean baseline, create a temporary branch/worktree at the
  recorded commit, apply the patch with `git apply --check` then `git apply`,
  and commit the result. Verify with a test that asserts the worktree path,
  branch name, apply-check ordering, and result commit.

- [x] 3.2 Fast-forward the host branch only when the branch and `HEAD` match the
  baseline and `git status --porcelain` is empty; then remove the worktree and
  delete the temporary branch. Verify with a clean-host test that asserts
  `git merge --ff-only`, worktree removal, and branch deletion happen in that
  order.

- [x] 3.3 When the host moved or is dirty, do not fast-forward; keep the branch
  and worktree and print review/merge commands. Verify with tests for a new
  host commit, a changed branch, and a dirty working tree; assert no merge is
  attempted and the guidance names the branch, worktree, and patch.

- [x] 3.4 For a dirty or untracked baseline, create the temporary worktree at
  the synthetic baseline, apply the patch, and commit the result on the
  temporary branch. Do not fast-forward; print the `git cherry-pick <result>`
  command. Verify with a dirty/untracked fixture that asserts the synthetic
  baseline parent, the result commit, no fast-forward, and the cherry-pick
  hint.

- [x] 3.5 On a patch conflict in the worktree, attempt `git apply --3way` only
  in the disposable worktree; keep the worktree and patch if conflicts remain.
  Verify with a conflicting fixture that asserts the host worktree is
  unchanged, the review worktree exists, and the patch path is printed.

- [x] 3.6 Disable the automatic worktree/fast-forward path for
  `--no-git-ignore` uploads and use the patch apply-check path instead. Verify
  with a `--no-git-ignore` test that asserts no worktree is created and the
  patch check runs in the project.

- [x] 3.7 Run `git worktree prune` before creating a worktree and clean up
  state when a worktree or branch is removed. Verify with a stale-worktree
  fixture and a clean-fast-forward test that asserts no stale entry remains.

## 4. Plain directory apply path

- [x] 4.1 When the project is a plain directory and `git` is available, apply
  the patch with `git apply --check` then `git apply`, without creating a
  worktree or requiring `.git`. Verify with a temp directory, a text patch, and
  an assertion that the patch check precedes the apply.

- [x] 4.2 When `git apply --check` fails in a plain directory, leave every file
  unchanged and keep the patch. Verify with a conflicting fixture that asserts
  the file bytes are unchanged and the patch path is printed.

- [x] 4.3 When `git` is unavailable, apply text changes with `patch` or
  `diff3` and report conflicts without touching unrelated files. Verify with a
  text fixture and a stubbed missing-`git` command path.

- [x] 4.4 When `git` is unavailable and the patch contains binary changes,
  write a path/hash manifest of the changed files in the sandbox, export only
  those files to a review directory, and print the review path. Verify with a
  binary fixture and an assertion that the main project is unchanged.

- [x] 4.5 When neither `git` nor a text/binary export tool is available, fail
  closed with the recovery block and no host write. Verify with a missing-tool
  fixture.

## 5. Fail-closed recovery and exit behavior

- [x] 5.1 Print a recovery block on any collection or apply failure that names
  the sandbox, workspace path, `openshell sandbox connect` command, and a
  `maki-oss download <path> <dest>` example. Verify with a failing-collection
  test that asserts every element is present on stderr.

- [x] 5.2 Write the `pending` marker when changes remain unsynced; block a later
  session from automatically uploading over the sandbox or automatically
  applying a new patch until the marker is resolved. Verify with a two-session
  fixture that asserts no second upload or auto-apply and that the pending
  patch is reported.

- [x] 5.3 Do not run a full workspace download automatically on failure; make
  full copy possible only through `maki-oss download`. Verify with a failing
  sync test that asserts no `sandbox download` invocation is recorded.

- [x] 5.4 Preserve Maki's exit code and keep helper output on stderr for
  `maki-oss run`. Verify with a non-zero Maki exit plus a failing sync, and
  with a successful run whose stdout is exactly Maki's output.

## 6. Documentation and migration

- [x] 6.1 Update `docs/helper.md` to describe baseline capture, clean and
  dirty git behavior, the plain-directory path, fail-closed recovery, and the
  `maki-oss download` escape hatch. Verify with `scripts/check-links.sh` and a
  grep for the new section names.

- [x] 6.2 Update `README.md` and `docs/setup-guide.md` so the quick start and
  the project sync description no longer promise an automatic workdir overlay.
  Verify with a grep that no remaining text claims the exit sync overwrites
  matching host files.

- [x] 6.3 Update `docs/verification.md` §7 with checks for a clean git sync, a
  conflicting host edit, a dirty/untracked baseline, a plain directory, and a
  fail-closed recovery. Verify the commands and expected output by running the
  clean and conflict cases against a local gateway.

- [x] 6.4 Record the real run in `docs/verification-log.md`, including the
  sandbox name, OpenShell/Maki versions, the baseline mode, and the exact
  recovery output. Verify the entry names the commands and observed results.

- [x] 6.5 Update the carried-risk note in `docs/roadmap.md` so merge-only
  download is no longer described as the interactive default. Verify with a
  grep that the note points at the new behavior.

- [x] 6.6 Update `docs/ai/agent-playbook.md` and `docs/ai/host-playbook.md`
  where the helper shortcut or host prerequisites mention sync. Verify with
  `scripts/check-links.sh` and a grep for stale-overlay wording.

## 7. Verification

- [x] 7.1 Run `make test` and confirm the new clean, dirty, no-git, conflict,
  stale-baseline, pending-marker, and `.git` isolation cases pass offline.

- [x] 7.2 Run `make lint` (shellcheck for `bin/maki-oss` and the test suite,
  `fish -n` for the plugin) and confirm it passes.

- [x] 7.3 Run a real-gateway dry run with a clean git project: create a file in
  the sandbox, exit, confirm the fast-forward, and confirm the worktree and
  temporary branch are gone.

- [x] 7.4 Run a real-gateway dirty/untracked case: start with a local edit and
  an untracked file, change both in the sandbox, exit, confirm no fast-forward
  and the branch/worktree plus cherry-pick hint. Follow the printed guidance
  (commit or stash as needed), cherry-pick the result, and verify the local
  edits are restored rather than silently committed.

- [x] 7.5 Run a real-gateway conflict case: edit the same file on the host and
  in the sandbox, exit, confirm the host file is unchanged and the patch or
  review worktree is retained.

- [x] 7.6 Run a real-gateway plain-directory case and simulate a no-`git` host
  with a restricted `PATH`; confirm the plain apply-check path and the
  fail-closed recovery output.

- [x] 7.7 Re-run the isolation checks: no host bind mount, no sandbox `.git`
  in the host project, no host `.git` in the sandbox, no credential-like
  values in the patch or helper output.
