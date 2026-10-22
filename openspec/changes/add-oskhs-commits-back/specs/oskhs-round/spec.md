# Spec Delta

## MODIFIED Requirements

### Requirement: Round in a fresh task worktree
For every round oskhs SHALL add a worktree at `/sandbox/tasks/<task-id>` on
a branch `task-<task-id>` created (or reset) from the round's base (default:
the local repo's current branch, as `origin/<branch>`), run Maki through
`maki-oss run --no-sync --timeout <secs>` with `MAKI_OSS_SANDBOX_NAME` set to
the sandbox and `MAKI_OSS_WORKDIR` set to the worktree, and remove the
worktree afterwards, including when the round failed. The sandbox repository
SHALL carry a fixed commit identity so commits made in a worktree succeed.

#### Scenario: Round runs in its own worktree
- **WHEN** a round runs
- **THEN** the `maki-oss run` call carries `--no-sync`, `--timeout`, `MAKI_OSS_WORKDIR=/sandbox/tasks/<task-id>`, and `MAKI_OSS_SANDBOX_NAME=repo-<project>`, and a `git worktree remove` for that path follows it

#### Scenario: Live round answers from the repo
- **WHEN** `run-round` runs on a small repo against the local gateway with a prompt that asks about a file's contents
- **THEN** it prints the answer Maki produced from the worktree and exits 0, and the worktree no longer exists afterwards

#### Scenario: Agent commits succeed
- **WHEN** the agent runs `git commit` in its worktree
- **THEN** the commit succeeds with the oskhs identity

## ADDED Requirements

### Requirement: Changes return as a git bundle
After a round whose result is `answer`, unless collection is disabled,
oskhs SHALL commit every uncommitted, non-ignored change in the task worktree
on its current HEAD, point `task-<task-id>` at that HEAD, and — when it
differs from the base — create in the sandbox a bundle of
`refs/heads/task-<task-id>` whose prerequisites are only object ids the host
supplied for this round's sync, download it, and fetch it into the host
repository as `refs/heads/oskhs/<task-id>`, all before the worktree is
removed. The host side SHALL verify the bundle, accept only the one expected
ref, and fetch with object checking enabled; any failure SHALL leave the
host repository's refs unchanged and fail the round with stage `collect`.
Rounds whose result is not `answer` SHALL collect nothing.

#### Scenario: Edits, deletions, and renames arrive intact
- **WHEN** the agent edits one file, deletes another, and renames a third in its worktree, without committing
- **THEN** the host branch `oskhs/<task-id>` has exactly the worktree's final tree, and `git diff --name-status -M` against the base shows the modification, the deletion, and the rename

#### Scenario: Agent's own commits are kept
- **WHEN** the agent made two commits itself and left nothing uncommitted
- **THEN** the host branch carries those two commits and no oskhs commit

#### Scenario: No changes, no branch
- **WHEN** the round changed nothing
- **THEN** `changes` is `null`, no bundle is created, and no host ref is written

#### Scenario: Unexpected bundle refs are refused
- **WHEN** the downloaded bundle advertises any ref other than `refs/heads/task-<task-id>`
- **THEN** the round fails with stage `collect` and the host repository has no new ref

#### Scenario: Read-only rounds skip collection
- **WHEN** a round runs with collection disabled and the agent edited a file
- **THEN** no commit, bundle, or host ref is created

### Requirement: Change summary in round output
Every round's output SHALL include `changes`: `null` when nothing was
collected, else the host branch, head and base object ids, commit count,
bundle bytes, and the added, modified, deleted, and renamed paths.

#### Scenario: Summary is printed
- **WHEN** a round that renamed `calc.py` to `calculator.py` finishes
- **THEN** `changes.files.renamed` lists that rename and `changes.branch` is `oskhs/<task-id>`
