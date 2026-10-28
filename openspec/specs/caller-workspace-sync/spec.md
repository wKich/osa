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
untracked-but-not-ignored files. The workdir SHALL NOT contain any host `.git`
metadata. Files left in the workdir from an earlier `sync-in` or run that are
absent from HOST_TREE SHALL be removed. The copy SHALL use `openshell sandbox
upload` and SHALL NOT create a bind mount. A HOST_TREE that does not exist or
is not a directory SHALL be a usage error before any gateway call.

#### Scenario: Dirty tree arrives as it is on disk
- **WHEN** HOST_TREE is a git worktree with one modified tracked file, one untracked file, and one ignored `bin/out.dll`, and the caller runs `sync-in HOST_TREE`
- **THEN** the sandbox workdir holds the modified content and the untracked file, and holds neither `bin/out.dll` nor a `.git` entry

#### Scenario: Stale files are removed
- **WHEN** a file created in the workdir by an earlier run does not exist in HOST_TREE, and the caller runs `sync-in HOST_TREE`
- **THEN** that file is absent from the workdir afterwards

#### Scenario: Worktree with a .git file
- **WHEN** HOST_TREE is a linked git worktree whose `.git` is a file pointing at another repository
- **THEN** `sync-in` succeeds, and the workdir contains no `.git` file or directory

### Requirement: sync-in records a baseline outside the workdir

After the copy, `sync-in` SHALL record the workdir contents as a baseline
commit in a git directory inside the sandbox that is outside the workdir and
outside any path the agent's workdir commands address. Each `sync-in` SHALL
replace the previous baseline. With `--json`, `sync-in` SHALL print exactly one
JSON object on stdout with the fields `baseline` (the baseline commit id),
`files` (the number of files in the workdir), and `bytes` (their total size).
All other output SHALL go to stderr.

#### Scenario: JSON result
- **WHEN** a caller runs `sync-in HOST_TREE --json` for a tree of 3 files
- **THEN** stdout is one JSON object whose `files` is 3 and whose `baseline` is a 40-hex commit id, and nothing else is on stdout

#### Scenario: Baseline is invisible to the agent
- **WHEN** after `sync-in`, a command runs `git status` in the sandbox workdir
- **THEN** git reports that the workdir is not a repository

### Requirement: collect-patch returns the agent's edits as a patch

`collect-patch --out FILE` SHALL write to the host file FILE a binary git
patch of the sandbox workdir relative to the last `sync-in` baseline. The
patch SHALL carry additions, modifications, deletions, renames, mode changes,
and binary changes. It SHALL NOT carry the baseline git directory or any
`.git` directory the agent created inside the workdir. The file SHALL be
created with mode 600. An unchanged workdir SHALL produce an empty FILE.
`collect-patch` SHALL NOT modify the host tree, the sandbox workdir, or the
baseline, so running it twice gives the same patch. With `--json`, it SHALL
print exactly one JSON object on stdout with the fields `empty` (boolean),
`baseline` (the commit id the patch is relative to), and `files`: an array of
`{"status", "path"}` entries, where `status` is the git name-status letter.
Without a prior `sync-in` in that sandbox, it SHALL exit 1 with a message
naming `sync-in`, and SHALL write no FILE.

#### Scenario: Round trip onto the host tree
- **WHEN** after `sync-in HOST_TREE`, the agent modifies one file, deletes one, adds a binary file, and the caller runs `collect-patch --out p.diff` and then `git apply p.diff` in HOST_TREE
- **THEN** `git apply` succeeds, and HOST_TREE then matches the sandbox workdir for those three paths

#### Scenario: Empty patch for an untouched workdir
- **WHEN** a caller runs `sync-in` and then `collect-patch --out p.diff --json` with no run in between
- **THEN** `p.diff` is empty and the JSON has `"empty": true` and `"files": []`

#### Scenario: Agent-created repository is excluded
- **WHEN** the agent runs `git init` in the workdir and commits there
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
