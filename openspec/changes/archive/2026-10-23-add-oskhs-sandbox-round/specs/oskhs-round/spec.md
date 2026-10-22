# Spec Delta

## MODIFIED Requirements

### Requirement: Warm repo sandbox seeding
oskhs SHALL keep one sandbox per project named `repo-<project>`, where
`<project>` is the project name lowercased with every character outside
`[a-z0-9-]` replaced by `-` (for `run-round`, the repo directory's basename;
for kiss tasks, the project title). When the sandbox is missing, oskhs SHALL
create it through `maki-oss up` with the configured providers and SHALL NOT
upload a project directory. For each repository of a round, when the sandbox
holds no repository at `/sandbox/repos/<subdir>`, oskhs SHALL create a bare
repository there whose `origin` remote has the standard fetch refspec and a
URL that names no network endpoint. Seeding MUST NOT pass any `--env` value
and MUST NOT use a bind mount; history reaches the sandbox only through the
incremental sync.

#### Scenario: First round seeds the sandbox
- **WHEN** `run-round <repo> "<prompt>"` runs and no `repo-<project>` sandbox exists
- **THEN** the recorded calls create the sandbox with `maki-oss up`, initialize the bare repository, and sync the round's refs with no prerequisites, before any worktree is added

#### Scenario: Seeded sandbox is reused
- **WHEN** `repo-<project>` exists and `/sandbox/repos/<subdir>` is a git repository
- **THEN** the repository is not re-initialized and only the incremental sync runs

#### Scenario: Failed seed leaves nothing behind
- **WHEN** initializing the bare repository or its first fetch fails
- **THEN** the result is `failed` with stage `sync` or `seed`, and the next round starts the sync again from the tips the sandbox actually has

#### Scenario: Network git fails in the sandbox
- **WHEN** an agent runs `git fetch` in a task worktree
- **THEN** the command fails without contacting any host

### Requirement: Round in a fresh task worktree
For every round oskhs SHALL create a workspace `/sandbox/tasks/<task-id>/`
holding, for each repository of the round, a worktree at `<subdir>/` on a
branch `task-<task-id>` created (or reset) from that repository's base, and
an `AGENTS.md` index of the repositories at the workspace root; it SHALL run
Maki through `maki-oss run --no-sync --timeout <secs>` with
`MAKI_OSS_SANDBOX_NAME` set to the sandbox and `MAKI_OSS_WORKDIR` set to the
workspace, and remove the worktrees and the workspace afterwards, including
when the round failed. A workspace left at the same path by a lost round
SHALL be removed before the new one is created. Every sandbox repository
SHALL carry a fixed commit identity so commits made in a worktree succeed.

#### Scenario: Round runs in its own worktree
- **WHEN** a round runs
- **THEN** the `maki-oss run` call carries `--no-sync`, `--timeout`, `MAKI_OSS_WORKDIR=/sandbox/tasks/<task-id>`, and `MAKI_OSS_SANDBOX_NAME=repo-<project>`, and a `git worktree remove` for every repository's worktree follows it

#### Scenario: Two repositories in one workspace
- **WHEN** a round has repositories `g/a` and `g/b`
- **THEN** the workspace holds `g_a/` and `g_b/` worktrees and an `AGENTS.md` listing both

#### Scenario: Live round answers from the repo
- **WHEN** `run-round` runs on a small repo against the local gateway with a prompt that asks about a file's contents
- **THEN** it prints the answer Maki produced from the workspace and exits 0, and the workspace no longer exists afterwards

#### Scenario: Agent commits succeed
- **WHEN** the agent runs `git commit` in a worktree
- **THEN** the commit succeeds with the oskhs identity

### Requirement: Sync statistics in round output
Every round's output SHALL report, per repository, the sync: bundle bytes
(0 when none was sent), refs updated, refs pruned, prerequisite count, and
whether a full bundle was sent.

#### Scenario: Statistics are printed
- **WHEN** `run-round` finishes
- **THEN** its JSON output lists each repository with a `sync` object holding `bundleBytes`, `updated`, `pruned`, `prerequisites`, and `full`

### Requirement: Changes return as a git bundle
After a round whose result is `answer`, unless collection is disabled,
oskhs SHALL, for each repository of the round, commit every uncommitted,
non-ignored change in its worktree on the worktree's current HEAD, point
`task-<task-id>` at that HEAD, and — when it differs from the base — create
in the sandbox a bundle of `refs/heads/task-<task-id>` whose prerequisites
are only object ids the host supplied for this round's sync, download it,
and fetch it into that repository's host side as `refs/heads/oskhs/<task-id>`,
all before the worktrees are removed. The host side SHALL verify the bundle,
accept only the one expected ref, and fetch with object checking enabled;
any failure SHALL leave the host repository's refs unchanged and fail the
round with stage `collect`. Rounds whose result is not `answer` SHALL
collect nothing.

#### Scenario: Edits, deletions, and renames arrive intact
- **WHEN** the agent edits one file, deletes another, and renames a third in a worktree, without committing
- **THEN** that repository's host branch `oskhs/<task-id>` has exactly the worktree's final tree, and `git diff --name-status -M` against the base shows the modification, the deletion, and the rename

#### Scenario: Agent's own commits are kept
- **WHEN** the agent made two commits itself and left nothing uncommitted
- **THEN** the host branch carries those two commits and no oskhs commit

#### Scenario: No changes, no branch
- **WHEN** the round changed nothing in a repository
- **THEN** its `changes` is `null`, no bundle is created, and no host ref is written

#### Scenario: Unexpected bundle refs are refused
- **WHEN** the downloaded bundle advertises any ref other than `refs/heads/task-<task-id>`
- **THEN** the round fails with stage `collect` and the host repository has no new ref

#### Scenario: Read-only rounds skip collection
- **WHEN** a round runs with collection disabled and the agent edited a file
- **THEN** no commit, bundle, or host ref is created

### Requirement: Change summary in round output
Every round's output SHALL list each repository with its `changes`: `null`
when nothing was collected, else the host branch, head and base object ids,
commit count, bundle bytes, and the added, modified, deleted, and renamed
paths.

#### Scenario: Summary is printed
- **WHEN** a round that renamed `calc.py` to `calculator.py` finishes
- **THEN** that repository's `changes.files.renamed` lists the rename and `changes.branch` is `oskhs/<task-id>`
