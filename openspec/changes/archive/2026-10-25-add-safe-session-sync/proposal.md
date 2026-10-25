# Proposal

## Why

A `maki-oss` session currently ends by downloading the sandbox workdir over the
host project. OpenShell's download merges additively: matching paths are
overwritten, host-only files survive, and sandbox-side deletions are not
propagated. That is an overlay, not a merge. Any host edit to a file that also
exists in the sandbox is lost — even when Maki never touched that file — and a
reused sandbox may already be older than the host. If Maki creates a `.git`
directory in the workdir, the same overlay can merge it into the host
repository.

The repository already avoids this shape for autonomous rounds: oskhs collects
the task worktree as a git commit, returns a bundle, and fetches a host branch
instead of downloading a tree (`docs/oskhs.md`). The interactive helper is the
remaining merge-only path. This change brings the same safety property to
`maki-oss` sessions without adding host bind mounts or moving changes through
any path other than an explicit patch the host chooses to apply.

Upstream behavior this relies on:
https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview
("Transfer Files" describes the additive upload/download semantics), and the
download merge probe in `docs/verification-log.md`.

## What Changes

- Replace the session exit overlay with **collect a patch, then apply it only
  when it is safe**. The sandbox emits a diff against the baseline it started
  from; the host applies that diff, or keeps it for review.
- Record a **baseline identity** at upload/session start: host commit, tree
  hash, branch, and clean/dirty status; and inside the sandbox, a baseline
  commit of the uploaded tree. Compare the two trees and refuse the automatic
  path when the sandbox is stale.
- **Clean git repository:** create a temporary worktree at the recorded
  baseline, apply the sandbox patch, commit the result on a temporary branch,
  and fast-forward the host branch only when it is still at the same baseline
  with no tracked changes. Remove the worktree and branch after a successful
  fast-forward.
- **Dirty or untracked git repository:** create a synthetic baseline commit
  whose tree is the current working tree and whose parent is `HEAD`, create the
  temporary worktree at that commit, apply the patch, and commit the result.
  Do **not** fast-forward, because that would commit the user's uncommitted
  work. Keep the branch/worktree and tell the user to cherry-pick the result
  commit (or apply the patch directly).
- **Plain directory with git available:** apply the patch directly with
  `git apply --check` followed by `git apply`. `git apply` works outside a
  repository, so no `.git` or worktree is required. On conflict, keep the patch
  and leave the project untouched; optionally create a review copy.
- **Plain directory without git:** use `patch`/`diff3` for text changes, a
  hash-manifest selective export for binary changes, or fail closed if neither
  is available.
- **Fail closed:** if patch collection, application, or baseline verification
  fails, write nothing to the project. Keep the patch, leave the changes in the
  sandbox, and print recovery commands (`openshell sandbox connect`,
  `maki-oss download <path> <dest>`).
- **BREAKING:** the exit sync no longer downloads the whole sandbox workdir by
  default. Gitignored files, empty directories, and sandbox-only artifacts no
  longer travel unless they are part of the patch or the user runs
  `maki-oss download` explicitly. `--no-sync` keeps its current meaning.
- `maki-oss download` remains the explicit full-copy escape hatch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `helper-cli`: replace the merge-only "Session sync-back" requirement with
  patch-based safe application, baseline freshness, clean/dirty git paths, the
  no-git path, fail-closed recovery, and the guarantee that host files are
  never overwritten by an automatic overlay.

## Impact

- Affected code: `bin/maki-oss` (session ensure, upload, exit sync, doctor
  diagnostics), `tests/run-tests.sh`.
- Affected docs: `docs/helper.md`, `docs/verification.md`,
  `docs/verification-log.md`, `README.md`, and the carried-risk note in
  `docs/roadmap.md`.
- Affected specs: `helper-cli` delta only.
- Security: unchanged. No host bind mounts, no secrets in sandbox
  environment, no new egress, non-root sandbox user. The sandbox produces a
  patch; the host helper validates and applies it. `.git` never crosses the
  boundary.
- User impact: the one-command session still applies changes when the patch
  fits. Conflicts leave the project untouched and keep a branch/worktree or
  patch for manual resolution. Ignored artifacts and empty directories no
  longer round-trip automatically; `maki-oss download` remains available.
- Non-goals: a full three-way merge mode, incremental git-bundle uploads into
  the sandbox, a new `maki-oss sync` command, and dashboard changes.
