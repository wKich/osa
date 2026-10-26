## MODIFIED Requirements

### Requirement: Warm repo sandbox seeding
oskhs SHALL keep one sandbox per project named `repo-<project>`, where
`<project>` is the project name lowercased with every character outside
`[a-z0-9-]` replaced by `-`, repeated hyphens collapsed, and leading and
trailing hyphens trimmed (for `run-round`, the repo directory's basename;
for kiss tasks, the project title). The name SHALL be at most 19
characters, OpenShell's limit: when `<project>` is longer than 14
characters, oskhs SHALL keep its first 9 characters with trailing hyphens
dropped, followed by `-` and a stable four-character lowercase hex hash of
the full cleaned project name. When the sandbox is missing, oskhs SHALL
create it through `maki-oss up` in caller-owned workspace mode
(`MAKI_OSS_WORKSPACE=caller`) with the configured providers and idle stop
off (`MAKI_OSS_IDLE_STOP=0`), and SHALL NOT upload a project directory. For
each repository of a round, when the sandbox holds no repository at
`/sandbox/repos/<subdir>`, oskhs SHALL create a bare repository there whose
`origin` remote has the standard fetch refspec and a URL that names no
network endpoint. Seeding MUST NOT pass any `--env` value and MUST NOT use a
bind mount; history reaches the sandbox only through the incremental sync.

#### Scenario: First round seeds the sandbox
- **WHEN** `run-round <repo> "<prompt>"` runs and no `repo-<project>` sandbox exists
- **THEN** the recorded calls create the sandbox with `maki-oss up` carrying `MAKI_OSS_WORKSPACE=caller` and `MAKI_OSS_IDLE_STOP=0`, initialize the bare repository, and sync the round's refs with no prerequisites, before any worktree is added

#### Scenario: Seeded sandbox is reused
- **WHEN** `repo-<project>` exists and `/sandbox/repos/<subdir>` is a git repository
- **THEN** the repository is not re-initialized and only the incremental sync runs

#### Scenario: Failed seed leaves nothing behind
- **WHEN** initializing the bare repository or its first fetch fails
- **THEN** the result is `failed` with stage `sync` or `seed`, and the next round starts the sync again from the tips the sandbox actually has

#### Scenario: Network git fails in the sandbox
- **WHEN** an agent runs `git fetch` in a task worktree
- **THEN** the command fails without contacting any host

#### Scenario: A 15-character project name is fitted
- **WHEN** the project is `ascii-minecraft`
- **THEN** the sandbox is `repo-ascii-min-` followed by four lowercase hex characters, 19 characters in all

#### Scenario: Names up to 14 characters keep their form
- **WHEN** the project is `kiss-agent`
- **THEN** the sandbox is `repo-kiss-agent`

#### Scenario: Long project titles get distinct fitted names
- **WHEN** two kiss projects are titled `Kontur Conveyor Backend` and `Kontur Conveyor Frontend`
- **THEN** both sandbox names are at most 19 lowercase letters, digits, or hyphens, start with `repo-kontur-co`, and differ

### Requirement: Round in a fresh task worktree
For every round oskhs SHALL create a workspace `/sandbox/tasks/<task-id>/`
holding, for each repository of the round, a worktree at `<subdir>/` on a
branch `task-<task-id>` created (or reset) from that repository's base, and
an `AGENTS.md` index of the repositories at the workspace root; it SHALL run
Maki through `maki-oss run --timeout <secs>` with
`MAKI_OSS_WORKSPACE=caller`, `MAKI_OSS_IDLE_STOP=0`,
`MAKI_OSS_SANDBOX_NAME` set to the sandbox, and `MAKI_OSS_WORKDIR` set to
the workspace, and remove the worktrees and the workspace afterwards,
including when the round failed. A workspace left at the same path by a
lost round SHALL be removed before the new one is created. Every sandbox
repository SHALL carry a fixed commit identity so commits made in a
worktree succeed. Any number of consecutive rounds on one sandbox SHALL run
without host-side session state from an earlier round blocking a later one.

#### Scenario: Round runs in its own worktree
- **WHEN** a round runs
- **THEN** the `maki-oss run` call carries `--timeout`, `MAKI_OSS_WORKSPACE=caller`, `MAKI_OSS_IDLE_STOP=0`, `MAKI_OSS_WORKDIR=/sandbox/tasks/<task-id>`, and `MAKI_OSS_SANDBOX_NAME=repo-<project>`, and a `git worktree remove` for every repository's worktree follows it

#### Scenario: Two repositories in one workspace
- **WHEN** a round has repositories `g/a` and `g/b`
- **THEN** the workspace holds `g_a/` and `g_b/` worktrees and an `AGENTS.md` listing both

#### Scenario: Live round answers from the repo
- **WHEN** `run-round` runs on a small repo against the local gateway with a prompt that asks about a file's contents
- **THEN** it prints the answer Maki produced from the workspace and exits 0, and the workspace no longer exists afterwards

#### Scenario: Agent commits succeed
- **WHEN** the agent runs `git commit` in a worktree
- **THEN** the commit succeeds with the oskhs identity

#### Scenario: Consecutive live rounds on one project
- **WHEN** `run-round` runs twice in a row on the same repo against the local gateway
- **THEN** both rounds answer and exit 0, and the osa state root holds no sync marker and no registry entry for the sandbox
