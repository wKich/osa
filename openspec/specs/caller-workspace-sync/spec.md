# caller-workspace-sync Specification

## Purpose

Lets an orchestrator that owns the sandbox workspace (caller mode) move a host
working tree into the sandbox and receive the agent's edits back as a patch,
with machine-readable results, so it can run sandboxed agent passes over
uncommitted work without managed-mode sync.

## Requirements

### Requirement: Caller-mode only

`sync-in` and `collect-patch` SHALL be available on `maki-oss`, `opencode-oss`,
`claude-oss`, and `codex-oss`, and SHALL run only when the helper's
`*_WORKSPACE` setting is `caller`. In any other mode, each command SHALL exit 1
with a message naming the caller setting, before any gateway call. Both
commands SHALL require a literal sandbox name and workdir, exactly as caller
mode `run` does. Neither command SHALL create a project registry entry, write
a session marker, or read or change managed-mode sync state.

#### Scenario: Refused in managed mode
- **WHEN** `claude-oss sync-in .` runs without `CLAUDE_OSS_WORKSPACE=caller`
- **THEN** it exits 1 naming `CLAUDE_OSS_WORKSPACE=caller`, and the openshell stub records no call

#### Scenario: Literal target required
- **WHEN** `CLAUDE_OSS_WORKSPACE=caller claude-oss collect-patch --out p.diff` runs without a sandbox name
- **THEN** it exits 1 with the same message caller-mode `run` prints for a missing name, before any gateway call

#### Scenario: No host-side state
- **WHEN** a caller runs `sync-in` and then `collect-patch` against a sandbox
- **THEN** no file is created under `${XDG_STATE_HOME:-$HOME/.local/state}/osa/projects/` or `sessions/` for that sandbox

### Requirement: sync-in replaces the workdir with the host tree

`sync-in HOST_TREE` SHALL require that the sandbox exists and is running, and
SHALL make the sandbox workdir match HOST_TREE. The workdir SHALL hold exactly
the files the helper's default upload filtering selects: `.gitignore`-filtered
when HOST_TREE is a git working tree, including uncommitted, staged, and
untracked-but-not-ignored files, plus, for a git `HOST_TREE`, a helper-created
`.git` file. The workdir SHALL NOT contain any host `.git` metadata. For a git
`HOST_TREE`, the helper SHALL create a sandbox-side repository and a `.git`
file in the workdir; that file SHALL point to a git directory outside the
workdir and SHALL NOT be a copy of the host `.git` file or directory. Files
left in the workdir from an earlier `sync-in` or run that are absent from
HOST_TREE SHALL be removed. The copy SHALL use `openshell
sandbox upload` and SHALL NOT create a bind mount. A HOST_TREE that does not
exist or is not a directory SHALL be a usage error before any gateway call.

#### Scenario: Dirty tree arrives as it is on disk
- **WHEN** HOST_TREE is a git worktree with one modified tracked file, one untracked file, and one ignored `bin/out.dll`, and the caller runs `sync-in HOST_TREE`
- **THEN** the sandbox workdir holds the modified content and the untracked file, holds neither `bin/out.dll` nor the host `.git` file or directory, and its helper-created `.git` file points outside the workdir

#### Scenario: Stale files are removed
- **WHEN** a file created in the workdir by an earlier run does not exist in HOST_TREE, and the caller runs `sync-in HOST_TREE`
- **THEN** that file is absent from the workdir afterwards

#### Scenario: Worktree with a .git file
- **WHEN** HOST_TREE is a linked git worktree whose `.git` is a file pointing at another repository
- **THEN** `sync-in` succeeds, the host pointer is not copied into the workdir, and a helper-created `.git` file points at a sandbox-side git directory instead

#### Scenario: Non-git tree remains a plain snapshot
- **WHEN** HOST_TREE is a directory that is not a git working tree
- **THEN** the workdir holds the uploaded files, contains no `.git` entry, and `git status` reports that the workdir is not a repository

### Requirement: sync-in records a baseline outside the workdir

After the copy, `sync-in` SHALL record the workdir contents as a baseline
commit in a git directory inside the sandbox that is outside the workdir and
outside any path the agent's workdir commands address. The baseline git
directory SHALL be separate from the agent repository created for history, so
the baseline commit is not reachable from the agent's `HEAD` or ordinary
`git log`. Each `sync-in` SHALL replace the previous baseline. With `--json`,
`sync-in` SHALL print exactly one JSON object on stdout with the fields
`baseline` (the baseline commit id), `files` (the number of files in the
workdir), and `bytes` (their total size). These counts SHALL exclude the
helper-created `.git` file and helper repository metadata. All other output
SHALL go to stderr. Separate git directories SHALL NOT be described as an
access-control boundary against an agent sharing their writable paths and uid.

#### Scenario: JSON result
- **WHEN** a caller runs `sync-in HOST_TREE --json` for a tree of 3 files
- **THEN** stdout is one JSON object whose `files` is 3 and whose `baseline` is a 40-hex commit id, and nothing else is on stdout

#### Scenario: Baseline is invisible to the agent
- **WHEN** after `sync-in` of a git HOST_TREE, a command runs `git log --all` in the workdir
- **THEN** the baseline commit is absent, and the agent's repository shows only the host history and any refs the agent created

### Requirement: collect-patch returns the agent's edits as a patch

`collect-patch --out FILE` SHALL write to the host file FILE a binary git
patch of the sandbox workdir relative to the last `sync-in` baseline. The
patch SHALL carry additions, modifications, deletions, renames, mode changes,
and binary changes. It SHALL NOT carry the baseline git directory, the sandbox
repository git directory, or any `.git` file or directory inside the workdir.
The file SHALL be created with mode 600. An unchanged workdir SHALL produce an
empty FILE. `collect-patch` SHALL NOT modify the host tree, the sandbox
workdir, the baseline, or the sandbox repository, so running it twice gives the
same patch. With `--json`, it SHALL print exactly one JSON object on stdout
with the fields `empty` (boolean), `baseline` (the commit id the patch is
relative to), and `files`: an array of `{"status", "path"}` entries, where
`status` is the git name-status letter. Without a prior `sync-in` in that
sandbox, it SHALL exit 1 with a message naming `sync-in`, and SHALL write no
FILE.

#### Scenario: Round trip onto the host tree
- **WHEN** after `sync-in HOST_TREE`, the agent modifies one file, deletes one, adds a binary file, and the caller runs `collect-patch --out p.diff` and then `git apply p.diff` in HOST_TREE
- **THEN** `git apply` succeeds, and HOST_TREE then matches the sandbox workdir for those three paths

#### Scenario: Empty patch for an untouched workdir
- **WHEN** a caller runs `sync-in` and then `collect-patch --out p.diff --json` with no run in between
- **THEN** `p.diff` is empty and the JSON has `"empty": true` and `"files": []`

#### Scenario: Helper-created git file is excluded
- **WHEN** `sync-in` created a `.git` file in the workdir and the caller runs `collect-patch`
- **THEN** the patch contains no `.git` entry

#### Scenario: Agent-created repository is excluded
- **WHEN** the agent removes the helper-created `.git` file, runs `git init` in the workdir, and commits there
- **THEN** the patch contains no path under `.git/`

#### Scenario: Idempotent
- **WHEN** a caller runs `collect-patch` twice without a run in between
- **THEN** both patch files are byte-identical

#### Scenario: Missing baseline
- **WHEN** a caller runs `collect-patch --out p.diff` on a sandbox that never had `sync-in`
- **THEN** it exits 1 naming `sync-in`, and `p.diff` is not created

### Requirement: Exit codes and failures

`sync-in` and `collect-patch` SHALL use the helper's exit codes: 0 for
success, 1 for a usage error, 2 for a missing dependency, and 3 for a gateway
failure, which includes a missing or stopped sandbox. A failed `sync-in` SHALL
leave no baseline that `collect-patch` would accept as current. A failed
`collect-patch` SHALL remove any partial FILE.

#### Scenario: Stopped sandbox
- **WHEN** `sync-in HOST_TREE` runs against a sandbox the openshell stub reports as stopped
- **THEN** it exits 3 and names the sandbox

#### Scenario: Failed collection leaves no file
- **WHEN** the in-sandbox collection fails
- **THEN** `collect-patch` exits non-zero and FILE does not exist

#### Scenario: Missing base is a usage error
- **WHEN** `sync-in HOST_TREE --base origin/missing` runs on a host repository without that ref
- **THEN** it exits 1, names the ref, and contacts no gateway

#### Scenario: Base on a non-git tree is a usage error
- **WHEN** `sync-in HOST_TREE --base origin/master` runs on a directory that is not a git worktree
- **THEN** it exits 1 before any gateway call

### Requirement: sync-in includes host git history

When `HOST_TREE` is a git working tree, `sync-in` SHALL make the workdir a git
working tree whose `HEAD` is the host `HEAD`, whose history is the host history
reachable from `HEAD`, and whose worktree holds the uploaded files as
uncommitted changes. The sandbox repository SHALL use a git directory outside
the workdir and a `.git` file in the workdir. The helper SHALL NOT copy host
remotes, hooks, reflogs, stash entries, credential helpers, or other host git
configuration into the sandbox repository. The sandbox index SHALL be seeded
from host `HEAD`, not the host index; staged changes SHALL appear unstaged,
and partially staged files SHALL retain their on-disk content without
preserving the host staging split.

`sync-in` SHALL accept an optional `--base REF`. The helper SHALL resolve `REF`
to a commit on the host before any gateway call, SHALL include that commit's
history in the uploaded bundle, and SHALL expose it in the sandbox repository
as `refs/remotes/origin/<name>`. For local branch and remote-tracking refs,
`<name>` SHALL be the short branch name, preserving slashes and removing the
`refs/heads/` or `refs/remotes/<remote>/` prefix after symbolic resolution.
For commit ids, tags, and other commit expressions, `<name>` SHALL be `base`.
The helper SHALL validate the destination ref on the host and SHALL NOT
interpolate unchecked refs into sandbox shell commands. A `REF` that cannot
be resolved, an invalid destination ref, or `--base` on a non-git `HOST_TREE`
SHALL be a usage error with exit 1 before any gateway call.

A failed bundle creation, upload, fetch, or repository setup SHALL leave no
baseline that `collect-patch` accepts as current.

#### Scenario: History is visible with the dirty worktree
- **WHEN** HOST_TREE has two commits and one modified tracked file, and the caller runs `sync-in HOST_TREE`
- **THEN** `git log --oneline` in the workdir shows both commits, `git status` shows the modified file, and `git diff` shows the host's uncommitted change

#### Scenario: Base ref is available to a reviewer
- **WHEN** the task branch has diverged from `origin/master` and the caller runs `sync-in HOST_TREE --base origin/master`
- **THEN** `git rev-parse refs/remotes/origin/master` succeeds and `git diff origin/master` compares the sandbox worktree with the base commit

#### Scenario: Commit expression uses a stable base name
- **WHEN** the caller runs `sync-in HOST_TREE --base <commit-id>` or passes a tag resolving to that commit
- **THEN** `git rev-parse refs/remotes/origin/base` resolves to that commit

#### Scenario: Branch names preserve slashes
- **WHEN** the caller passes `--base refs/remotes/origin/release/next`
- **THEN** the sandbox exposes the resolved commit as `refs/remotes/origin/release/next`

#### Scenario: Staging is flattened without losing file contents
- **WHEN** HOST_TREE contains a staged change and a partially staged file
- **THEN** the sandbox files match the host on-disk files, `git diff --cached` is empty, and `git diff` shows their changes relative to host `HEAD`

#### Scenario: Linked worktree history
- **WHEN** HOST_TREE is a linked git worktree and the caller runs `sync-in HOST_TREE`
- **THEN** `git log` in the workdir shows the host commits and `git status` shows the worktree's uncommitted changes

#### Scenario: Agent commits are still returned as a patch
- **WHEN** the agent commits changes in the sandbox workdir and the caller then runs `collect-patch`
- **THEN** the patch contains the committed changes relative to the `sync-in` baseline

#### Scenario: No host git metadata
- **WHEN** the host repository has remotes, hooks, a stash, and a credential helper, and the caller runs `sync-in HOST_TREE`
- **THEN** the sandbox repository exposes none of that configuration and its `.git` file names a sandbox path, not a host path

#### Scenario: History failure clears the baseline
- **WHEN** bundle creation or the sandbox repository setup fails during `sync-in`
- **THEN** `sync-in` exits non-zero and a following `collect-patch` reports that no baseline exists
