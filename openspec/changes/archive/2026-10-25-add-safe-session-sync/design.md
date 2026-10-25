# Design

## Context

See `proposal.md` for motivation. The current helper uploads the project only
when it creates a sandbox, then on session exit runs
`openshell sandbox download <name> <workdir> $PWD`. The OpenShell download
merges additively: matching paths win, host-only files survive, and sandbox
deletions do not propagate. The repo's download probe records that behavior in
`docs/verification-log.md`. The upload side is different: inside a git work
tree, OpenShell uploads tracked and untracked non-ignored files via
`git ls-files -co --exclude-standard`, so `.git` does not enter the sandbox.

Constraints that shape the design:

- OpenShell 0.1.5 has no host snapshot/fork command; `sandbox stop/start`
  preserves the workspace, and `upload`/`download`/`exec` are the transfer
  primitives.
- No host bind mounts, no secrets in sandbox environment, no new egress,
  non-root sandbox user. The sandbox emits a patch; the host helper decides
  whether to apply it.
- The helper is POSIX `sh`; tests are offline and use a stubbed OpenShell.
- `docs/oskhs.md` already collects autonomous work as a commit/bundle and
  avoids the merge-only download. This design brings the same shape to
  interactive sessions without requiring a bundle.

## Goals / Non-Goals

**Goals:**

- Never overwrite a host edit with an automatic workdir overlay.
- Keep the one-command clean path; make conflicts and dirty baselines
  reviewable rather than destructive.
- Cover clean git, dirty/untracked git, plain directory with git available, and
  plain directory without git.
- Keep the patch and, when used, the branch/worktree as durable recovery
  artifacts.
- Keep the security invariants unchanged and make `.git` crossing impossible.

**Non-Goals:**

- A full three-way merge mode for plain directories.
- Incremental git-bundle uploads into the sandbox.
- A new `maki-oss sync` command; `maki-oss download` remains the explicit
  full-copy escape hatch.
- Exporting gitignored files, empty directories, submodules, or LFS objects
  automatically.
- Dashboard or OpenCode bridge changes.
- Automatically refreshing a reused sandbox. A stale sandbox disables the
  automatic path; `maki-oss upload` remains the explicit refresh.

## Decisions

### 1. Patch is the transfer primitive

The sandbox keeps an external git directory at `/sandbox/.maki-oss/git` with
`GIT_DIR` pointing at it and `GIT_WORK_TREE` pointing at the project. At
upload/create, it commits the uploaded tree and records `refs/maki-oss/base`.
At session exit it runs `git add -A`, commits the result, records
`refs/maki-oss/result`, and emits
`git diff --binary --full-index base result` as the patch.

Consequences:

- The sandbox `.git` is outside the project workdir, so the downloaded patch
  never contains git metadata.
- A patch is content-based and portable; it does not need the host's commit
  history in the sandbox.
- Deletions, renames, mode changes, symlinks, and binary changes travel in the
  patch.
- Gitignored files and empty directories do not travel. This is a deliberate
  behavior change from the overlay; `maki-oss download` remains the explicit
  way to fetch them.

Alternatives considered:

- **Bundle-only.** A bundle is a pack of commits. The sandbox has no host
  `.git`, so its commits are synthetic and a bundle would carry a synthetic
  base. Applying it to host history is awkward. Patch wins for this slice.
- **Full workdir download to a staging directory.** It duplicates the tree,
  carries `.git` and build junk, and still requires a manual merge. Rejected
  as an automatic fallback.

### 2. Baseline identity is a tree, not just a commit

At session start the helper records:

- sandbox name and workspace path,
- whether the project is a git repository,
- branch, commit, and tree hash when it is a git repository,
- whether the working tree was clean, dirty, or had untracked non-ignored
  files,
- the sandbox baseline tree hash,
- the upload mode (`--no-git-ignore` or default filtered).

A clean git repository with no untracked non-ignored files uses `HEAD` as the
baseline. A dirty or untracked repository uses a synthetic baseline commit:

```text
tree = git write-tree from a temporary index containing the current worktree
parent = HEAD
baseline = git commit-tree tree -p HEAD -m "maki-oss baseline <session>"
```

The temporary index uses `git add -A`, which applies the same `.gitignore`
rules as the default OpenShell upload. The user's branch, index, and working
tree are untouched.

Before Maki runs, the helper compares the sandbox baseline tree with the host
baseline tree. If they differ, the sandbox is stale: the helper does **not**
enable the automatic fast-forward/apply path. It still collects a patch at
exit and keeps it for review, but it must not silently apply changes from a
tree the agent did not start from. `maki-oss upload` is the explicit refresh.

Alternatives considered:

- **Always upload at session start.** Simple and fresh, but it would overwrite
  unexported changes in a reused sandbox and adds a full upload to every
  session.
- **Reuse and rely on `git apply --check`.** Safe for the host but produces
  manual conflicts on a stale baseline; this design makes the mismatch
  explicit instead of pretending the automatic path works.
- **Incremental bundle upload.** The efficient long-term answer, but a
  separate change.

### 3. Clean git repository: temp worktree, patch, fast-forward

For a clean baseline:

1. Create a temporary branch and worktree at the recorded commit:
   `git worktree add -b maki-oss/<session> <state>/worktrees/<session> <head>`.
2. Apply the patch in the worktree with `git apply --check`, then `git apply`.
3. Commit the result on the temporary branch.
4. Fast-forward the host only when it is still on the recorded branch at the
   recorded commit and `git status --porcelain` is empty.
5. On success, remove the worktree and delete the temporary branch.

The worktree gives the host a real child commit with the real parent, which is
what makes fast-forward meaningful. The host working tree is untouched until
the fast-forward, and the worktree is a review/test surface before that.

If the patch conflicts, attempt `git apply --3way` in the disposable worktree
and keep the worktree and patch. If the host moved or is dirty, do not merge;
keep the branch and print review/merge commands. The patch is always saved.

Alternatives considered:

- **Apply the patch directly to the live worktree.** Safe with `git apply
  --check`, but gives no branch or review surface. Kept as the plain-directory
  behavior, not the git-repository default.
- **Merge the temporary branch instead of fast-forwarding.** Only valid when
  the worktree is based on the real recorded commit; merge is a no-op
  difference for the clean case. Fast-forward is stricter and easier to reason
  about.

### 4. Dirty or untracked git repository: synthetic baseline, keep branch, cherry-pick

A worktree at `HEAD` would not contain the user's uncommitted or untracked
files, so the sandbox patch might not apply. A fast-forward from `HEAD` through
a result branch that includes them would commit the user's work without
consent.

The design therefore:

1. Creates the synthetic baseline commit described in decision 2.
2. Creates the temporary worktree at that synthetic commit.
3. Applies the patch and commits the result on `maki-oss/<session>`.
4. Never fast-forwards, because the branch contains the synthetic baseline.
5. Keeps the branch and worktree and tells the user to cherry-pick the result
   commit (or apply the patch directly).

The commit graph is:

```text
main:  B
temp:  B -- B' -- R
            ^     ^
            |     agent changes
            synthetic snapshot of B + local work
```

`R`'s diff from `B'` is exactly the agent's changes. `git cherry-pick R`
applies only that diff to the user's branch; the user's local changes stay in
the working tree, subject to the normal dirty-tree/cherry-pick rules.

Alternatives considered:

- **Worktree at `HEAD` plus copied dirty files.** The patch may apply, but the
  result commit either excludes the copied files or accidentally commits them;
  the synthetic baseline makes the boundary explicit.
- **Commit the user's dirty work automatically.** Rejected: no consent and it
  mixes the user's incomplete work with the agent's.
- **Direct patch apply on the dirty worktree.** Safe with `git apply --check`
  and is the recommended fallback when the user does not want the worktree.
  Kept as an option in the recovery message.

### 5. Plain directory: patch check directly, no worktree

When the project is not a git repository, the helper does not require a
repository and does not create a worktree. It applies the patch with
`git apply --check` and then `git apply`. `git apply` works outside a
repository and is atomic across the whole patch: if any hunk conflicts, it
leaves the project unchanged.

The patch check is more precise than a global "host unchanged" scan: it only
requires the context of the agent's own changes. Unrelated host edits are
preserved; overlapping edits cause a safe refusal.

On conflict the helper keeps the patch and prints review instructions. It does
not create a full review copy automatically; the user can copy the project and
apply the patch there if they want a no-git worktree.

When `git` is unavailable, the helper uses `patch` or `diff3` for text changes.
For binary changes it uses a path/hash manifest to export only the affected
files into a review directory, or fails closed when neither tool is available.

Alternatives considered:

- **Sidecar git repository outside the project.** It would provide a worktree
  and branch without adding `.git` to the project, but adds hidden state and
  disk cost. Deferred; the patch check is sufficient for safety.
- **Host-side session copy.** It is a no-git worktree, but it duplicates the
  project at session start. Deferred to an explicit review copy on conflict.

### 6. Fail closed; never auto-stage the full tree

If patch collection, baseline verification, or application fails, the helper:

- writes nothing to the project,
- keeps the patch in
  `${XDG_STATE_HOME:-$HOME/.local/state}/maki-oss/sessions/<sandbox>/`,
- leaves the changes in the sandbox,
- prints the sandbox name, workspace path, `openshell sandbox connect`
  command, and a `maki-oss download <path> <dest>` example,
- exits with Maki's code, not the sync failure's.

A full workspace download happens only when the user explicitly runs
`maki-oss download`. A pending marker is written in the session state
directory; a later session must not automatically upload over the sandbox
while that marker is present. The recovery message names the marker path and
says to remove it after the pending patch has been applied or explicitly
discarded.

This is the smallest safe fallback and preserves the "host is the source of
truth" property without copying the whole tree.

### 7. Git metadata never crosses the boundary

The sandbox baseline git directory is outside the workdir and is never
downloaded. The host `.git` is never uploaded: OpenShell's git-aware upload
uses `git ls-files -co --exclude-standard`, which does not include `.git`.
If Maki creates a `.git` inside the workspace, it stays in the sandbox; the
patch does not include it. The host helper applies the patch with `git apply`,
which does not run hooks.

### 8. State layout and cleanup

Host state lives under
`${XDG_STATE_HOME:-$HOME/.local/state}/maki-oss/sessions/<sandbox>/`:

- `baseline` (mode, branch, commit, tree, status, upload mode),
- `patch-<timestamp>.patch` (mode 600),
- `review/` or `worktrees/` when a review surface is kept,
- `pending` marker when changes remain unsynced.

Patches are retained until the user removes them. Worktrees are removed only
after a successful fast-forward; a kept worktree is the user's review surface.
`git worktree prune` runs before creating a new worktree.

### 9. `--no-git-ignore` and special files

The default upload filters with `.gitignore`; the synthetic baseline uses the
same rules. With `--no-git-ignore`, the sandbox includes ignored files while a
plain `git add -A` baseline would not. This slice disables the automatic
worktree/fast-forward path for `--no-git-ignore` uploads and uses the patch
apply-check path instead, so the trees cannot silently diverge.

Sockets, FIFOs, and other special files are not representable in a git patch.
If they prevent patch collection, the helper fails closed and reports the
sandbox path. They are not a reason to fall back to an overlay.

## Risks / Trade-offs

- **[Stale sandbox]** The automatic path is disabled and the patch is kept. →
  The user can run `maki-oss upload` explicitly; a later incremental bundle
  upload can restore the fast path.
- **[Dirty/untracked cherry-pick friction]** Cherry-pick may refuse when the
  worktree is dirty or an agent-changed path is untracked. → The branch and
  worktree remain, the patch is kept, and the message names `git add -N`, a
  stash/commit, or direct patch application.
- **[Line endings and attributes]** `git add` in the sandbox can normalize
  content according to `.gitattributes`; a patch generated there may not match
  a CRLF host worktree. → The failure is a safe conflict; tests must cover a
  CRLF/attribute fixture, and the fallback is a kept patch or review worktree.
- **[Large binary diffs]** `git diff --binary` can produce a large patch. →
  Keep the patch on disk, not in shell memory; if collection/transfer fails,
  fail closed or use the selective export path. A bundle-based binary path is
  out of scope.
- **[Ignored files and empty directories]** They no longer travel
  automatically. → Documented as a breaking change; `maki-oss download` is the
  explicit escape hatch.
- **[Submodules and LFS]** A patch may not apply or may not include the
  expected content. → Fail closed/manual review; no silent overlay.
- **[Temp worktree disk]** A worktree is a full checkout. → Store it in the
  state directory, remove it after fast-forward, and prune stale entries.
- **[Host git missing]** The sandbox can still collect a patch, but the host
  cannot apply it with `git apply`. → Use `patch`/`diff3` for text, selective
  export/fail closed for binary, and keep the patch.
- **[Sandbox git missing]** The sandbox cannot create a baseline or patch. →
  Fail closed; add git to the environment image or use an explicit download.
- **[Untrusted patch]** The patch comes from the sandbox. → Apply only after
  `git apply --check`; no hooks; paths are constrained to the project; `.git`
  is excluded.
- **[Pending unapplied work]** A new session could overwrite sandbox changes if
  it uploads over them. → The pending marker blocks automatic upload/apply and
  points at the saved patch.

## Migration Plan

- Existing sandboxes have no baseline ref. On the first session after this
  change, the helper creates one from the current sandbox workdir and warns
  that pre-existing sandbox changes are the baseline and are not exported.
  Users who need those changes run `maki-oss download` before starting the new
  session.
- Users who relied on the exit overlay for ignored files, empty directories, or
  sandbox-only build artifacts use `maki-oss download` explicitly. The README
  and `docs/helper.md` describe the change.
- Rollback is a helper-version rollback; no on-disk host project migration is
  required. Saved patches and kept worktrees remain usable with plain git.
- The change ships with tests for clean git, dirty/untracked git, plain
  directory with git, plain directory without git, conflict, stale sandbox,
  fail-closed recovery, deletions/renames, and `.git` isolation.
