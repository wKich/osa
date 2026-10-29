# Proposal

## Why

Conveyor's reviewer-like roles run `git diff`, `git log`, `git status`,
`git show`, and `git blame`, but `sync-in` currently uploads a tree with no
repository, so those commands have nothing to read. The M1 caller contract
deliberately deferred history to M2. Add the smallest history transport to the
existing caller snapshot: a host-generated bundle and a sandbox-side
repository, while keeping the uncommitted worktree and the existing patch
return path.

## What Changes

- `sync-in HOST_TREE [--base REF]` SHALL, when `HOST_TREE` is a git worktree,
  upload a git bundle of the host `HEAD` (and the optional base ref) alongside
  the filtered tree, and create a real repository in the workdir whose history
  is the host history and whose worktree holds the uploaded files as
  uncommitted changes. On-disk contents are preserved; the host index is not
  copied, so staged changes become unstaged.
- The sandbox repository SHALL use a `.git` file pointing to a git directory
  outside the workdir. The existing baseline git directory stays separate, and
  `collect-patch` keeps its current tree-diff contract. Separate directories
  prevent ordinary Git operations from changing the baseline, but are not a
  security boundary against explicit tampering by the same sandbox uid.
- `--base REF` SHALL resolve `REF` on the host before any gateway call and
  expose the commit as `refs/remotes/origin/<name>`, so reviewer commands such
  as `git diff origin/master` work. `REF` may be a branch, a remote-tracking
  ref, or a commit id. Branch refs keep their short branch name; commit ids,
  tags, and other commit expressions use `origin/base`.
- A non-git `HOST_TREE` SHALL keep today's behavior: no history, no `.git`,
  and `collect-patch` unchanged. Passing `--base` for a non-git tree SHALL be a
  usage error.
- **BREAKING** the `caller-workspace-sync` scenario that asserts the workdir is
  not a git repository changes: a git `HOST_TREE` now yields a workdir
  repository with host history. The baseline commit remains outside the
  workdir and is not on `HEAD`.
- Docs: the caller-owned workspace section of `docs/helper.md` documents
  history, `--base`, and the revised orchestrator sequence.
- Out of scope: hosting a bare repository on the host as a network remote (the
  transport was tested and is recorded in `design.md` as a follow-up option,
  not the default), `git push`, self-check inside the sandbox (M3), a warm
  sandbox reused across rework iterations (M2b), reference repositories for
  `--add-dir` (M2c), incremental sync, and submodule or Git LFS support.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `caller-workspace-sync`: `sync-in` includes host git history and an optional
  base ref; a git `HOST_TREE` produces a workdir repository while the baseline
  stays outside it; a non-git tree keeps the M1 behavior.

## Impact

- Code: `lib/oss-core.sh` (`cmd_sync_in`, caller scripts, option parsing).
- Tests: `tests/run-tests.sh` caller sync cases.
- Docs: `docs/helper.md` caller-owned workspace section.
- Consumers: Conveyor's `maki-osa` and `claude-osa` hosts pass
  `--base origin/<base>`; no Conveyor-side code is part of this change.
- Upstream behavior relied on: `openshell sandbox upload` / `sandbox exec`,
  `git bundle`, `git init --separate-git-dir`, and `git read-tree`.
  <https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md>,
  <https://git-scm.com/docs/git-bundle>,
  <https://git-scm.com/docs/git-init>.
