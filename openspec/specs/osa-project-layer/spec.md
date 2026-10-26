# osa-project-layer Specification

## Purpose

The agent-neutral project layer shared by every agent front-end, and the `osa` entry point that reports on it. It binds host project folders to sandboxes in one state root and publishes a versioned, read-only state contract that other tools such as the dashboard can rely on.

## Requirements

### Requirement: Shared state root

Every agent front-end (`maki-oss`, `opencode-oss`, `claude-oss`) SHALL keep its sync state and its project registry entries under one state root, `${XDG_STATE_HOME:-$HOME/.local/state}/osa/`. Session state SHALL live in `sessions/<sandbox-name>/` and registry entries in `projects/`. The front-ends MUST NOT read or write the former per-tool roots `${XDG_STATE_HOME:-$HOME/.local/state}/maki-oss/` and `…/opencode-oss/`, and `claude-oss` MUST NOT create a per-tool root `…/claude-oss/`. Configuration files stay per front-end and do not move.

#### Scenario: Both front-ends write to one root
- **WHEN** `maki-oss up` and `opencode-oss up` run in the same project folder
- **THEN** both register under `osa/projects/`, each sandbox keeps its own `osa/sessions/<sandbox-name>/` directory, and nothing is written under `maki-oss/` or `opencode-oss/` in the state home

#### Scenario: Claude front-end writes to the same root
- **WHEN** `claude-oss up` runs in a project folder already registered for `mk`
- **THEN** a second entry with agent `cc` is written under `osa/projects/`, its session state lives in `osa/sessions/<cc-sandbox-name>/`, and nothing is written under `claude-oss/` in the state home

#### Scenario: A former per-tool root is ignored
- **WHEN** `${XDG_STATE_HOME}/maki-oss/sessions/<name>/pending` exists from an older helper and the user starts a session for that sandbox
- **THEN** the helper neither reads that marker nor modifies it

### Requirement: Project registry

The helper SHALL record one registry entry per (absolute host project path, agent) pair, in a file named `projects/<sandbox-name>.toml`. An entry SHALL record `version`, `agent` (the 2-letter tag), `host_path` (the absolute physical path), `project` (the full cleaned project name), `sandbox_name`, `sandbox_id`, `created`, `last_session`, and, for a git project, `fingerprint`. The helper SHALL write the entry when it creates the project's sandbox, SHALL update `sandbox_id`, `last_session`, and `fingerprint` on each session, and SHALL remove the entry when `rm` deletes the sandbox. The registry MUST NOT contain credential values or environment values. A registry entry whose `host_path` no longer exists SHALL be kept and reported as an orphan, never deleted automatically.

#### Scenario: Create registers the project
- **WHEN** the user runs `maki-oss up` in `/home/u/code/app` and the sandbox is created
- **THEN** `osa/projects/<sandbox-name>.toml` exists with `agent = "mk"`, `host_path = "/home/u/code/app"`, and the created sandbox's name and ID

#### Scenario: Two worktrees get two entries
- **WHEN** the user runs `maki-oss up` in two git worktrees of the same repository
- **THEN** the registry holds two entries with different `host_path` and `sandbox_name` values

#### Scenario: Rm removes the entry
- **WHEN** the user confirms `maki-oss rm` and the sandbox is deleted
- **THEN** the project's registry entry is removed together with the archived session state

#### Scenario: A moved folder becomes an orphan
- **WHEN** a registered project folder is deleted or moved and the user runs `osa projects`
- **THEN** the entry is listed and marked as an orphan, and its registry file is not removed

### Requirement: Versioned state contract

Registry entries and each session's `pending` marker SHALL be flat TOML: one `key = "value"` pair per line, with every value a double-quoted string and a `version = "1"` line. A `pending` marker SHALL record `version`, `kind` (`retained` or `parked`), `patch`, `sandbox`, `sandbox_id`, `created`, `reason`, and `result_tree`. Values containing quotes, backslashes, or spaces SHALL round-trip unchanged through the helper and through a standard TOML parser. Within one version, keys MAY be added but MUST NOT be removed, renamed, or given a different meaning; any such change SHALL increase `version`. All other files under the state root are internal and are not part of the contract.

#### Scenario: A standard parser reads the contract
- **WHEN** a registry entry and a `pending` marker are read with a standard TOML parser
- **THEN** both parse without error, and `version` is `"1"`

#### Scenario: Paths with spaces and quotes round-trip
- **WHEN** the project folder is `/home/u/my "app" dir`
- **THEN** the registry entry's `host_path` parses back to exactly `/home/u/my "app" dir`, and the helper reads the same value

#### Scenario: Retained patch is visible from the files alone
- **WHEN** a session ends with a retained patch
- **THEN** that sandbox's `pending` marker has `kind = "retained"` and a `patch` path that points to an existing file

### Requirement: Host fingerprint

For a git project, the helper SHALL record a host fingerprint in the registry entry at each successful sync point: the first upload on create, each refresh, and each clean apply. The fingerprint SHALL change when the host commit changes or when tracked, staged, unstaged, or untracked non-ignored files change. A project that is not a git repository, or a host without `git`, SHALL record no fingerprint. Computing the fingerprint MUST NOT hash the whole project tree.

#### Scenario: Unstaged edit changes the fingerprint
- **WHEN** a fingerprint was recorded and the user then edits a tracked file without staging it
- **THEN** the fingerprint computed now differs from the recorded one

#### Scenario: No edits keep the fingerprint
- **WHEN** a fingerprint was recorded and nothing in the project changed
- **THEN** the fingerprint computed now equals the recorded one

#### Scenario: A plain folder has no fingerprint
- **WHEN** the project folder is not a git repository
- **THEN** its registry entry has no `fingerprint` key

### Requirement: osa entry point is read-only

The repository SHALL provide an `osa` command that works across every agent front-end. `osa` SHALL offer `projects`, `status`, and `help`, and every other command SHALL be a usage error. `osa` MUST NOT create, start, stop, delete, upload to, or download from a sandbox, MUST NOT launch an agent, and MUST NOT write any file under the state root. The full `osa status` MAY query the gateway read-only and MAY run the same read-only workspace probe that the front-end's `status` runs; it MUST NOT run anything else in a sandbox. `osa projects` and `osa status --quick` MUST NOT contact the gateway.

#### Scenario: osa never changes a sandbox
- **WHEN** the user runs `osa projects`, `osa status`, and `osa status --quick` while a registered sandbox is `Ready`
- **THEN** the gateway receives no create, start, stop, delete, upload, or download call and no agent launch, and no file under the state root changes

#### Scenario: Projects and quick status stay off the gateway
- **WHEN** the user runs `osa projects` and `osa status --quick`
- **THEN** the gateway receives no call at all

#### Scenario: Unknown command is a usage error
- **WHEN** the user runs `osa up`
- **THEN** the command exits as a usage error that lists `projects`, `status`, and `help`

### Requirement: osa projects lists every registered project

`osa projects` SHALL list every registry entry across all agents, showing the agent tag, project, host path, sandbox name, the pending kind (`retained`, `parked`, or none), and whether the entry is an orphan. With `--json` it SHALL print one JSON array on stdout and nothing else, with one object per entry that holds the registry fields plus `pending` and `orphan`. An empty registry SHALL print `[]` with `--json` and exit 0.

#### Scenario: Both agents are listed
- **WHEN** one project is registered for `mk` and another for `oc`, and the user runs `osa projects --json`
- **THEN** stdout is a JSON array with two objects whose `agent` values are `mk` and `oc`

#### Scenario: Empty registry
- **WHEN** no project is registered and the user runs `osa projects --json`
- **THEN** stdout is `[]` and the exit code is 0

### Requirement: osa status reports a project across agents

`osa status [PATH]` SHALL report every registry entry whose `host_path` is the absolute physical form of `PATH` (default: the current directory), one entry per agent. The full mode SHALL report phase, attached providers, sync state (`clean`, `behind`, `retained`, or `parked`), the retained patch path, and the next command, with the same classification the agent's front-end `status` gives for that project. With `--quick` it SHALL NOT hash the project tree: it SHALL report the pending kind from the files and the fingerprint result `changed`, `unchanged`, or `unknown`, and MUST NOT report `clean` or `behind`. With `--json` it SHALL print one JSON array on stdout and nothing else. A path with no registry entry SHALL print `[]` with `--json` and exit 0.

#### Scenario: Full status matches the front-end
- **WHEN** a Maki project is `behind` and the user runs `osa status --json` in its folder
- **THEN** the entry for agent `mk` has sync state `behind`, the same as `maki-oss status` reports there

#### Scenario: Quick status detects a host change
- **WHEN** a git project's fingerprint was recorded, the user commits a change, and then runs `osa status --quick --json`
- **THEN** the entry reports fingerprint `changed`, and no sync state of `clean` or `behind` is present

#### Scenario: Quick status without a fingerprint
- **WHEN** the project is not a git repository and the user runs `osa status --quick --json`
- **THEN** the entry reports fingerprint `unknown`

#### Scenario: Unregistered path
- **WHEN** the user runs `osa status --json /tmp/elsewhere` and no entry has that `host_path`
- **THEN** stdout is `[]` and the exit code is 0
