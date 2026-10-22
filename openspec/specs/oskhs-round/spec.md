# oskhs-round Specification

## Purpose
Runs one headless Maki round for one task inside a long-lived per-project
OpenShell sandbox: seed the sandbox's repository once with full history, run
each round in its own git worktree, and return a typed result, with the time
limit enforced inside the sandbox and no credentials or bind mounts crossing
into it.

## Requirements

### Requirement: Warm repo sandbox seeding
oskhs SHALL keep one sandbox per project named `repo-<project>`, where
`<project>` is the repo directory's basename lowercased with every character
outside `[a-z0-9-]` replaced by `-`. When the sandbox is missing, oskhs SHALL
create it through `maki-oss up` with the configured providers and SHALL NOT
upload a project directory. When the sandbox holds no repository at
`/sandbox/repo`, oskhs SHALL create a bare repository there whose
`origin` remote has the standard fetch refspec and a URL that names no
network endpoint. Seeding MUST NOT pass any `--env` value and MUST NOT use a
bind mount; history reaches the sandbox only through the incremental sync.

#### Scenario: First round seeds the sandbox
- **WHEN** `run-round <repo> "<prompt>"` runs and no `repo-<project>` sandbox exists
- **THEN** the recorded calls create the sandbox with `maki-oss up`, initialize the bare repository, and sync the round's refs with no prerequisites, before any worktree is added

#### Scenario: Seeded sandbox is reused
- **WHEN** `repo-<project>` exists and `/sandbox/repo` is a git repository
- **THEN** the repository is not re-initialized and only the incremental sync runs

#### Scenario: Failed seed leaves nothing behind
- **WHEN** initializing the bare repository or its first fetch fails
- **THEN** the result is `failed` with stage `sync` or `seed`, and the next round starts the sync again from the tips the sandbox actually has

#### Scenario: Network git fails in the sandbox
- **WHEN** an agent runs `git fetch` in a task worktree
- **THEN** the command fails without contacting any host

### Requirement: Round in a fresh task worktree
For every round oskhs SHALL add a detached worktree at
`/sandbox/tasks/<task-id>` from the round's base (default: the local repo's
current branch, as `origin/<branch>`), run Maki through
`maki-oss run --no-sync --timeout <secs>` with `MAKI_OSS_SANDBOX_NAME` set to
the sandbox and `MAKI_OSS_WORKDIR` set to the worktree, and remove the
worktree afterwards, including when the round failed.

#### Scenario: Round runs in its own worktree
- **WHEN** a round runs
- **THEN** the `maki-oss run` call carries `--no-sync`, `--timeout`, `MAKI_OSS_WORKDIR=/sandbox/tasks/<task-id>`, and `MAKI_OSS_SANDBOX_NAME=repo-<project>`, and a `git worktree remove` for that path follows it

#### Scenario: Live round answers from the repo
- **WHEN** `run-round` runs on a small repo against the local gateway with a prompt that asks about a file's contents
- **THEN** it prints the answer Maki produced from the worktree and exits 0, and the worktree no longer exists afterwards

### Requirement: Typed round results
oskhs SHALL parse Maki's JSON result line into exactly one of: `answer`
(text, session id, duration, turns, usage) when `is_error` is false;
`agent-error` (message, session id) when `is_error` is true, regardless of
the exit code; `timeout` when the round exceeded its time limit;
`failed` (stage, exit code, stderr tail) for any seed, worktree, helper, or
parse failure. The CLI SHALL print the result as one JSON object on stdout
and exit 0 only for `answer`.

#### Scenario: Agent error with exit 0
- **WHEN** Maki exits 0 and prints a result with `is_error: true`
- **THEN** the result kind is `agent-error` carrying Maki's message

#### Scenario: Unparseable output
- **WHEN** the helper exits 0 but stdout holds no result line
- **THEN** the result kind is `failed` with stage `parse`

#### Scenario: Timeout
- **WHEN** the helper exits 124
- **THEN** the result kind is `timeout` with the configured seconds

### Requirement: Incremental ref sync
Before every round oskhs SHALL read the sandbox's tip for each ref under
`refs/remotes/origin/*` and `refs/tags/*`, determine the wanted refs (the
base branch plus every `--branch`, or every host branch and tag with
`--all-branches`), and transfer only what the sandbox lacks: one bundle of
the wanted refs whose tip differs, with every sandbox tip the host also has
as a `--not` prerequisite, fetched with force refspecs mapping
`refs/heads/<b>` to `refs/remotes/origin/<b>` and tags to themselves. When
the fetch fails with prerequisites, oskhs SHALL retry once without them. When
no wanted ref differs, no bundle SHALL be created. A wanted branch missing on
the host SHALL fail the round with stage `sync`. Uploaded bundles SHALL be
deleted in the sandbox after the fetch.

#### Scenario: Second round sends only the delta
- **WHEN** a round ran, one commit was added to the base branch on the host, and another round runs
- **THEN** the bundle carries the base ref with the sandbox's previous tip as a prerequisite, and its size is a small fraction of the first round's bundle

#### Scenario: Nothing new, nothing sent
- **WHEN** every wanted ref in the sandbox already matches the host
- **THEN** no bundle is created or uploaded and the round proceeds

#### Scenario: Untrusted tips only grow the bundle
- **WHEN** a sandbox tip names a commit the host does not have
- **THEN** that tip is not used as a prerequisite and the sync still succeeds

#### Scenario: Missing objects fall back to a full bundle
- **WHEN** the fetch of an incremental bundle fails
- **THEN** oskhs retries with a bundle without prerequisites and reports `full: true`

#### Scenario: Agent checks out a delivered branch
- **WHEN** a round delivers a non-base branch with `--branch` and the agent runs `git checkout <branch>` in its worktree
- **THEN** the checkout succeeds from local history

### Requirement: Upstream deletions are pruned
oskhs SHALL delete, with `git update-ref -d` in the sandbox, every
`refs/remotes/origin/<b>` whose branch no longer exists on the host, and in
`--all-branches` mode every sandbox tag the host lacks. Branches that exist
on the host but are not wanted in this round SHALL be left unchanged.

#### Scenario: Deleted branch disappears
- **WHEN** a branch delivered by an earlier round is deleted on the host and another round runs
- **THEN** its `refs/remotes/origin/<b>` no longer exists in the sandbox

#### Scenario: Unwanted branch is kept
- **WHEN** a branch delivered earlier still exists on the host but this round does not want it
- **THEN** its sandbox ref is unchanged

### Requirement: Local branches end with their worktree
When oskhs removes a task worktree it SHALL also delete every local branch
(`refs/heads/*`) in the sandbox repository that no remaining worktree has
checked out, so a later task's `git checkout <branch>` resolves to the
freshly synced remote-tracking ref rather than a copy an earlier task left.

#### Scenario: Checked-out branch is cleaned up
- **WHEN** an agent ran `git checkout feature` in its worktree and the round ends
- **THEN** `refs/heads/feature` no longer exists, while a branch checked out in another live worktree is unchanged

### Requirement: Sync statistics in round output
Every round's output SHALL report the sync: bundle bytes (0 when none was
sent), refs updated, refs pruned, prerequisite count, and whether a full
bundle was sent.

#### Scenario: Statistics are printed
- **WHEN** `run-round` finishes
- **THEN** its JSON output contains a `sync` object with `bundleBytes`, `updated`, `pruned`, `prerequisites`, and `full`
