# osa-project-layer Specification

## Purpose

The agent-neutral project layer shared by every agent front-end, and the `osa` entry point that reports on it and resolves pending sync output. It binds host project folders to sandboxes in one state root and publishes a versioned, read-only state contract that other tools such as the dashboard can rely on.

## Requirements

### Requirement: Shared state root

Every agent front-end (`maki-oss`, `opencode-oss`, `claude-oss`, `codex-oss`) SHALL keep its sync state and its project registry entries under one state root, `${XDG_STATE_HOME:-$HOME/.local/state}/osa/`. Session state SHALL live in `sessions/<sandbox-name>/` and registry entries in `projects/`. The front-ends MUST NOT read or write the former per-tool roots `${XDG_STATE_HOME:-$HOME/.local/state}/maki-oss/` and `…/opencode-oss/`, and `claude-oss` and `codex-oss` MUST NOT create a per-tool root `…/claude-oss/` or `…/codex-oss/`. Configuration files stay per front-end and do not move.

#### Scenario: Both front-ends write to one root
- **WHEN** `maki-oss up` and `opencode-oss up` run in the same project folder
- **THEN** both register under `osa/projects/`, each sandbox keeps its own `osa/sessions/<sandbox-name>/` directory, and nothing is written under `maki-oss/` or `opencode-oss/` in the state home

#### Scenario: Claude front-end writes to the same root
- **WHEN** `claude-oss up` runs in a project folder already registered for `mk`
- **THEN** a second entry with agent `cc` is written under `osa/projects/`, its session state lives in `osa/sessions/<cc-sandbox-name>/`, and nothing is written under `claude-oss/` in the state home

#### Scenario: Codex front-end writes to the same root
- **WHEN** `codex-oss up` runs in a project folder already registered for `cc`
- **THEN** a second entry with agent `cx` is written under `osa/projects/`, its session state lives in `osa/sessions/<cx-sandbox-name>/`, and nothing is written under `codex-oss/` in the state home

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

### Requirement: osa entry point

The repository SHALL provide an `osa` command that works across every agent front-end. `osa` SHALL offer `projects`, `status`, `health`, `resolve`, and `help`, and every other command SHALL be a usage error. `resolve` is the only `osa` command that changes anything; it is defined by the requirements "osa resolves retained patches" and "osa resolves parked workspaces". `projects`, `status`, `health`, and `help` MUST NOT create, start, stop, delete, upload to, or download from a sandbox, MUST NOT launch an agent, and MUST NOT write any file under the state root. No `osa` command MUST create, stop, or delete a sandbox or launch an agent, and only `osa resolve <sandbox> rescue` MAY start a stopped one. The full `osa status` and `osa health` MAY query the gateway read-only and MAY run the same read-only probes that the front-end's `status`, `mcp status`, and `doctor` run; they MUST NOT run anything else in a sandbox. `osa projects` and `osa status --quick` MUST NOT contact the gateway.

#### Scenario: osa never changes a sandbox
- **WHEN** the user runs `osa projects`, `osa status`, `osa status --quick`, and `osa health <sandbox>` while a registered sandbox is `Ready`
- **THEN** the gateway receives no create, start, stop, delete, upload, or download call and no agent launch, and no file under the state root changes

#### Scenario: Projects and quick status stay off the gateway
- **WHEN** the user runs `osa projects` and `osa status --quick`
- **THEN** the gateway receives no call at all

#### Scenario: Unknown command is a usage error
- **WHEN** the user runs `osa up`
- **THEN** the command exits as a usage error that lists `projects`, `status`, `health`, `resolve`, and `help`

### Requirement: osa projects lists every registered project

`osa projects` SHALL list every registry entry across all agents, showing the agent tag, project, host path, sandbox name, the pending kind (`retained`, `parked`, or none), and whether the entry is an orphan. With `--json` it SHALL print one JSON array on stdout and nothing else, with one object per entry that holds the registry fields plus `pending` and `orphan`. An empty registry SHALL print `[]` with `--json` and exit 0.

#### Scenario: Both agents are listed
- **WHEN** one project is registered for `mk` and another for `oc`, and the user runs `osa projects --json`
- **THEN** stdout is a JSON array with two objects whose `agent` values are `mk` and `oc`

#### Scenario: Empty registry
- **WHEN** no project is registered and the user runs `osa projects --json`
- **THEN** stdout is `[]` and the exit code is 0

### Requirement: osa status reports a project across agents

`osa status [PATH]` SHALL report every registry entry whose `host_path` is the absolute physical form of `PATH` (default: the current directory), one entry per agent. The full mode SHALL report phase, attached providers, sync state (`clean`, `behind`, `retained`, or `parked`), the retained patch path, and the next command, with the same classification the agent's front-end `status` gives for that project. With `--quick` it SHALL NOT hash the project tree: it SHALL report the pending kind from the files, the fingerprint result `changed`, `unchanged`, or `unknown`, `busy` (`true` while a live session or resolve holds that sandbox's lock), and `idle` (the idle-stop state and, while counting down, the deadline, as defined by "osa health reports a sandbox's health"), and MUST NOT report `clean` or `behind`. With `--json` it SHALL print one JSON array on stdout and nothing else. A path with no registry entry SHALL print `[]` with `--json` and exit 0.

#### Scenario: Full status matches the front-end
- **WHEN** a Maki project is `behind` and the user runs `osa status --json` in its folder
- **THEN** the entry for agent `mk` has sync state `behind`, the same as `maki-oss status` reports there

#### Scenario: Quick status detects a host change
- **WHEN** a git project's fingerprint was recorded, the user commits a change, and then runs `osa status --quick --json`
- **THEN** the entry reports fingerprint `changed`, and no sync state of `clean` or `behind` is present

#### Scenario: Quick status without a fingerprint
- **WHEN** the project is not a git repository and the user runs `osa status --quick --json`
- **THEN** the entry reports fingerprint `unknown`

#### Scenario: Quick status reports a live session
- **WHEN** a `maki-oss` session is running for a project and the user runs `osa status --quick --json` in its folder
- **THEN** the entry for agent `mk` reports `busy` as `true`

#### Scenario: Quick status reports the idle deadline
- **WHEN** a session ended 10 minutes ago with an idle period of 1 hour and the user runs `osa status --quick --json`
- **THEN** the entry reports idle state `counting` and a deadline 50 minutes from now, and the gateway receives no call

#### Scenario: Unregistered path
- **WHEN** the user runs `osa status --json /tmp/elsewhere` and no entry has that `host_path`
- **THEN** stdout is `[]` and the exit code is 0

### Requirement: osa resolves retained patches

`osa resolve SANDBOX apply|branch|drop [--yes] [--json]` SHALL resolve the retained patch named by that sandbox's `pending` marker. `SANDBOX` SHALL be a registered sandbox name; an unregistered name, an orphan entry, or a sandbox whose marker is not `retained` SHALL be refused with an error that names the current pending kind, and nothing SHALL change. The action SHALL run with the owning front-end's configuration and SHALL NOT contact the gateway.

- `apply` SHALL change the host working tree only when a dry run of the whole patch succeeds against the current tree (`git apply --check` with git, `patch --dry-run` without it), and then SHALL apply it all at once. It MUST NOT commit, stage, switch branches, or move `HEAD`. When the patch is already present in the host tree (its reverse applies cleanly), `apply` SHALL change no project file and SHALL clear the marker. A failed dry run SHALL change nothing, keep the marker, and suggest `branch`.
- `branch` SHALL require a git project and the base commit recorded for the session. It SHALL apply the patch in a temporary worktree at that commit, falling back to a three-way apply, commit the result on a new branch named `osa/<sandbox>-<timestamp>`, and remove the temporary worktree. It MUST NOT change the host working tree, the index, the current branch, or `HEAD`. A patch that does not apply SHALL leave no branch behind, keep the marker, and report the conflict.
- `drop` SHALL require `--yes`. It SHALL remove the marker and move the patch file into `dropped/` inside the session directory. It MUST NOT delete the patch file or change any project file.
- After a successful `apply`, `branch`, or `drop`, the sandbox's `pending` marker SHALL be removed and the patch file SHALL remain on disk (moved, for `drop`). With `--json`, `osa resolve` SHALL print one JSON object with `sandbox`, `action`, `ok`, `changed` (the paths or ref it wrote), and `message`, and nothing else on stdout.

#### Scenario: Apply on a clean tree
- **WHEN** a project has a retained patch whose dry run succeeds and the user runs `osa resolve <sandbox> apply`
- **THEN** the patch's changes appear in the host working tree, `HEAD` and the index are unchanged, the marker is removed, and the patch file still exists

#### Scenario: Apply refuses a conflicting patch
- **WHEN** the host edited the same lines the retained patch changes and the user runs `osa resolve <sandbox> apply`
- **THEN** no project file changes, the marker stays `retained`, and the error suggests `osa resolve <sandbox> branch`

#### Scenario: Apply of an already-applied patch
- **WHEN** the retained patch's changes are already in the host tree and the user runs `osa resolve <sandbox> apply`
- **THEN** no project file changes and the marker is removed

#### Scenario: Branch leaves the working tree alone
- **WHEN** the host has uncommitted edits and the user runs `osa resolve <sandbox> branch`
- **THEN** a branch `osa/<sandbox>-<timestamp>` exists whose commit holds the patch on the recorded base, `git status` output and `HEAD` are unchanged, no temporary worktree remains, and the marker is removed

#### Scenario: Branch in a plain folder
- **WHEN** the project is not a git repository and the user runs `osa resolve <sandbox> branch`
- **THEN** the command is refused, nothing changes, and the error suggests `apply`

#### Scenario: Drop needs confirmation
- **WHEN** the user runs `osa resolve <sandbox> drop` without `--yes`
- **THEN** nothing changes and the error names `--yes`

#### Scenario: Drop keeps the file
- **WHEN** the user runs `osa resolve <sandbox> drop --yes`
- **THEN** the marker is removed and the patch file is in the session's `dropped/` directory

#### Scenario: Wrong pending kind
- **WHEN** a sandbox's workspace is parked and the user runs `osa resolve <sandbox> apply`
- **THEN** nothing changes and the error says the workspace is parked and names `rescue` and `discard`

#### Scenario: Orphan is refused
- **WHEN** the registry entry's host folder no longer exists and the user runs `osa resolve <sandbox> drop --yes`
- **THEN** nothing changes and the error says the project folder is missing

### Requirement: osa resolves parked workspaces

`osa resolve SANDBOX rescue|discard [--yes] [--json]` SHALL resolve a parked workspace. A sandbox whose marker is not `parked`, an unregistered name, or an orphan entry SHALL be refused, and nothing SHALL change.

- `rescue` SHALL download the sandbox workspace into a new directory `rescue-<timestamp>/` inside that sandbox's session directory and SHALL print its path. It MUST NOT write anywhere else on the host and MUST NOT change the marker; the workspace stays parked. It MAY start a stopped sandbox to download and SHALL report that it did.
- `discard` SHALL require `--yes` and SHALL behave as the front-end's `upload --discard`: replace the sandbox workspace with the host project, record a new baseline, and remove the marker. Existing patch files SHALL be kept.
- With `--json`, the output SHALL follow the shape defined for retained actions.

#### Scenario: Rescue writes only under the session directory
- **WHEN** a workspace is parked and the user runs `osa resolve <sandbox> rescue`
- **THEN** the workspace files are in a new `rescue-<timestamp>/` directory in that sandbox's session directory, no project file changes, and the marker is still `parked`

#### Scenario: Discard clears the parked state
- **WHEN** a workspace is parked and the user runs `osa resolve <sandbox> discard --yes`
- **THEN** the sandbox workspace matches the host project, the marker is removed, and a later `osa status --json` reports `clean`

#### Scenario: Discard needs confirmation
- **WHEN** the user runs `osa resolve <sandbox> discard` without `--yes`
- **THEN** no upload is sent and the error names `--yes`

### Requirement: Session and resolve exclusion

Every front-end session and every `osa resolve` SHALL hold a per-sandbox lock in that sandbox's session directory for as long as it runs, including the session's exit sync. `osa resolve` SHALL refuse with an error naming the holder when a live process holds the lock, and a session SHALL refuse to start while a live `osa resolve` holds it. A lock whose holder process no longer exists SHALL be treated as free and replaced. The lock file is internal state and is not part of the published contract.

#### Scenario: Resolve during a session is refused
- **WHEN** a `maki-oss` session is running for a sandbox and the user runs `osa resolve <sandbox> drop --yes`
- **THEN** nothing changes and the error says a session is running for that sandbox

#### Scenario: Stale lock is replaced
- **WHEN** a session crashed and left a lock whose process no longer exists, and the user runs `osa resolve <sandbox> apply`
- **THEN** the resolve runs normally

### Requirement: osa health reports a sandbox's health

`osa health SANDBOX [--json]` SHALL report, for a registered sandbox, its idle stop, its MCP readiness, and the doctor checks of its owning front-end. An unregistered sandbox SHALL be a usage error and an orphan entry SHALL report only idle stop. With `--json` it SHALL print one JSON object on stdout and nothing else.

- **Idle stop** SHALL report the effective idle period in seconds (0 when disabled) and one state: `off` (disabled), `none` (no session has run), `running` (a session is live), `counting` (the last session ended and the stop is pending, with the deadline as an ISO 8601 UTC time), `stopped`, `skipped` (the watcher found a later session or a running agent), or `failed` (the stop call failed), plus the last idle event and its time. It SHALL derive these from the session's own idle records, never from the gateway.
- **MCP readiness** SHALL report, per server, its transport and each gate with a pass or fail result and the fix text, with the same results the front-end's `mcp status` reports. A front-end without `mcp status` SHALL report MCP as `unsupported`.
- **Doctor** SHALL report each check with a status of `ok`, `fail`, `skip`, or `warn` and its detail, with the same results the front-end's `doctor` reports.
- A section whose source fails (for example, the gateway is unreachable) SHALL carry an error message while the other sections are still reported. The output MUST NOT contain credential values.

#### Scenario: MCP gates match the front-end
- **WHEN** an HTTP MCP server's endpoint is missing from the effective policy and the user runs `osa health <sandbox> --json`
- **THEN** that server's endpoint gate is reported as failed with the same fix text `maki-oss mcp status` prints

#### Scenario: Doctor matches the front-end
- **WHEN** the configured image is missing and the user runs `osa health <sandbox> --json`
- **THEN** the doctor section has an `image` check with status `fail` and the build command in its detail

#### Scenario: Idle counting down
- **WHEN** the last session ended 10 minutes ago with an idle period of 1 hour
- **THEN** idle state is `counting` and the deadline is 50 minutes from now

#### Scenario: Idle disabled
- **WHEN** the front-end's `idle_stop` setting is `0`
- **THEN** idle state is `off` and the period is 0

#### Scenario: Unsupported MCP
- **WHEN** the owning front-end has no `mcp status` command
- **THEN** the MCP section is `unsupported` and the other sections are reported

#### Scenario: Gateway down
- **WHEN** the gateway is unreachable
- **THEN** the MCP section carries an error, the doctor section reports the gateway check as `fail`, and idle stop is still reported
