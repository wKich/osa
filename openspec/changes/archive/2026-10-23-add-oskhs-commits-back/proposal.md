# Proposal

## Why

Roadmap slice B1.2. A round can now read any delivered branch, but whatever
Maki changes in its task worktree is thrown away when the worktree is
removed. Code requests (B1.4) need those changes on the host as a branch.
The existing transfer, `maki-oss download`, merges files into the host tree:
it never propagates deletions and loses renames, so a deleted file would come
back. Git bundles carry deletions and renames by construction.

## What Changes

- Task worktrees start on a branch `task-<id>` (from `origin/<base>`), and
  the sandbox repository gets a fixed commit identity so Maki's own
  `git commit` works.
- After a round that answered, oskhs commits anything left uncommitted in
  the worktree (`git add -A`, respecting `.gitignore`), points `task-<id>` at
  the worktree's final `HEAD`, and — when it differs from the base — bundles
  `task-<id> --not <tips just synced>` in the sandbox, downloads it, verifies
  it, and fetches only that ref into the host repository as
  `refs/heads/oskhs/<task-id>` with object checking on. Then the worktree is
  removed.
- The round output gains `changes`: `null` when the round changed nothing,
  else `{ branch, head, base, commits, files }`.
- `--no-changes` (read-only rounds) skips collection entirely.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `oskhs-round`: rounds return their commits to the host as a branch.

## Impact

- New: `oskhs/src/collect.ts`, tests. Changed: `oskhs/src/{sync,round,cli,
  openshell}.ts`, `docs/oskhs.md`, `docs/roadmap.md`.
- Upstream behavior relied on: `openshell sandbox download` of a single file
  into a directory
  (https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md),
  `git bundle verify` and `fetch.fsckObjects`
  (https://git-scm.com/docs/git-bundle, https://git-scm.com/docs/git-config).
