## ADDED Requirements

### Requirement: osa removes a project

`osa remove SANDBOX --yes [--json]` SHALL remove one registered project. `SANDBOX` SHALL be a registered sandbox name, found by registry file name. The command SHALL run the owning front-end so that it uses that front-end's configuration and gateway: in the project folder, or, for an orphan, outside it. It SHALL act in this order:

1. It SHALL check the refusals below.
2. It SHALL list the gateway's sandboxes.
3. When the gateway lists `SANDBOX`, it SHALL delete it.
4. Only after that delete succeeds, or when the gateway does not list `SANDBOX`, it SHALL archive the sandbox's session directory to a sibling `sessions/<sandbox>.archive-<timestamp>` directory and SHALL remove the registry entry.

It MUST NOT delete the archived directory, MUST NOT change any file in the host project folder, and MUST NOT prompt.

`osa remove` SHALL refuse and change nothing (no gateway call, no file change) in each of these cases:
- `--yes` is missing.
- The name is not registered.
- The entry's agent is not one `osa` knows.
- The session's `pending` marker is `retained` or `parked`. The message SHALL name the `osa resolve` actions that clear that kind.
- A live session or resolve holds the sandbox.

When the gateway cannot be listed, or its delete fails, `osa remove` SHALL report a failure and SHALL leave the session directory and the registry entry unchanged.

Exit codes SHALL be:
- `0`: removed.
- `1`: usage error.
- `2`: refused before any change.
- `3`: failed, with the local state kept.

With `--json`, stdout SHALL be exactly one object with `sandbox`, `action` (`"remove"`), `ok`, `changed`, and `message`. `changed` SHALL list what the command changed:
- `gateway:<sandbox>` when it deleted the sandbox;
- the archive directory path;
- the removed registry file path.

#### Scenario: Remove a project whose sandbox exists
- **WHEN** a registered sandbox is listed on the gateway with nothing pending and the user runs `osa remove <sandbox> --yes --json`
- **THEN** the gateway receives one delete for that sandbox, the session directory is moved to `sessions/<sandbox>.archive-<timestamp>`, `projects/<sandbox>.toml` is gone, `osa projects` no longer lists it, the exit code is 0, and `changed` names the gateway delete, the archive path, and the registry file

#### Scenario: Remove a project whose sandbox is already gone
- **WHEN** a registry entry names a sandbox the gateway does not list and the user runs `osa remove <sandbox> --yes`
- **THEN** no delete request is sent, the session directory is archived, the registry entry is removed, and the exit code is 0

#### Scenario: Remove an orphan
- **WHEN** a registry entry's project folder no longer exists and the user runs `osa remove <sandbox> --yes`
- **THEN** the entry is removed (after deleting its sandbox when the gateway lists it) and the exit code is 0

#### Scenario: Pending work is refused
- **WHEN** the sandbox has a retained patch and the user runs `osa remove <sandbox> --yes`
- **THEN** the exit code is 2, the message names `osa resolve <sandbox> apply`, `branch`, and `drop --yes`, no gateway call is made, and no file changes

#### Scenario: Missing --yes is refused
- **WHEN** the user runs `osa remove <sandbox>` without `--yes`
- **THEN** the exit code is 2 and nothing changes

#### Scenario: Unreachable gateway keeps local state
- **WHEN** the gateway cannot be listed and the user runs `osa remove <sandbox> --yes`
- **THEN** the exit code is 3 and the registry entry and session directory are unchanged

#### Scenario: Unregistered name is refused
- **WHEN** the user runs `osa remove no-such-sandbox --yes`
- **THEN** the exit code is 2 and no gateway call is made

## MODIFIED Requirements

### Requirement: osa entry point

The repository SHALL provide an `osa` command that works across every agent front-end. `osa` SHALL offer `projects`, `status`, `health`, `providers`, `images`, `resolve`, `remove`, `provider setup`, `image build`, `dashboard`, and `help`, and every other command SHALL be a usage error. `resolve`, `remove`, `provider setup`, and `image build` are the only `osa` commands that change anything; they are defined by the requirements "osa resolves retained patches", "osa resolves parked workspaces", "osa removes a project", "osa sets up a provider from stdin", and "osa reports and builds base images". `image build` MUST change nothing but the agent's local base image tag. `dashboard` starts the web UI defined by the `dashboard` capability: it MUST NOT itself contact the gateway, write under the state root, or run any other `osa` command, and every change the running dashboard makes MUST go through the `osa` commands and gateway actions that capability allows. `projects`, `status`, `health`, `providers`, `images`, and `help` MUST NOT create, start, stop, delete, upload to, or download from a sandbox, MUST NOT launch an agent, MUST NOT create, update, or attach a provider, MUST NOT build, tag, or remove an image, and MUST NOT write any file under the state root. No `osa` command MUST create or stop a sandbox or launch an agent; only `osa remove` MAY delete a sandbox, only `osa resolve <sandbox> rescue` MAY start a stopped one, and only `osa provider setup` MAY attach a provider to one. The full `osa status`, `osa health`, and `osa providers` MAY query the gateway read-only and MAY run the same read-only probes that the front-end's `status`, `mcp status`, and `doctor` run; they MUST NOT run anything else in a sandbox. `osa projects`, `osa status --quick`, and `osa images` MUST NOT contact the gateway.

#### Scenario: osa never changes a sandbox
- **WHEN** the user runs `osa projects`, `osa status`, `osa status --quick`, `osa health <sandbox>`, `osa providers --json`, and `osa images --json` while a registered sandbox is `Ready`
- **THEN** the gateway receives no create, start, stop, delete, upload, download, provider create, provider update, or attach call and no agent launch, the container engine receives no build, tag, or remove call, and no file under the state root changes

#### Scenario: Projects and quick status stay off the gateway
- **WHEN** the user runs `osa projects`, `osa status --quick`, and `osa images`
- **THEN** the gateway receives no call at all

#### Scenario: Unknown command is a usage error
- **WHEN** the user runs `osa up`
- **THEN** the command exits as a usage error that lists `projects`, `status`, `health`, `providers`, `images`, `resolve`, `remove`, `provider setup`, `image build`, `dashboard`, and `help`

### Requirement: Project registry

The helper SHALL record one registry entry per (absolute host project path, agent) pair, in a file named `projects/<sandbox-name>.toml`. An entry SHALL record `version`, `agent` (the 2-letter tag), `host_path` (the absolute physical path), `project` (the full cleaned project name), `sandbox_name`, `sandbox_id`, `created`, `last_session`, and, for a git project, `fingerprint`. The helper SHALL write the entry when it creates the project's sandbox, SHALL update `sandbox_id`, `last_session`, and `fingerprint` on each session, and SHALL remove the entry when `rm` deletes the sandbox or when `osa remove` removes the project. The registry MUST NOT contain credential values or environment values. A registry entry whose `host_path` no longer exists SHALL be kept and reported as an orphan, never deleted automatically; only an explicit `osa remove` SHALL delete it.

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

#### Scenario: osa remove deletes an orphan's entry
- **WHEN** an orphan entry has nothing pending and the user runs `osa remove <sandbox> --yes`
- **THEN** its registry file is removed and `osa projects` no longer lists it

### Requirement: Session and resolve exclusion

Every front-end session, every `osa resolve`, and every `osa remove` SHALL hold a per-sandbox lock in that sandbox's session directory for as long as it runs, including the session's exit sync. `osa resolve` and `osa remove` SHALL refuse with an error naming the holder when a live process holds the lock, and a session SHALL refuse to start while a live `osa resolve` or `osa remove` holds it. A lock whose holder process no longer exists SHALL be treated as free and replaced. The lock file is internal state and is not part of the published contract.

#### Scenario: Resolve during a session is refused
- **WHEN** a `maki-oss` session is running for a sandbox and the user runs `osa resolve <sandbox> drop --yes`
- **THEN** nothing changes and the error says a session is running for that sandbox

#### Scenario: Remove during a session is refused
- **WHEN** a `claude-oss` session is running for a sandbox and the user runs `osa remove <sandbox> --yes`
- **THEN** no gateway call is made, nothing changes, the exit code is 2, and the error says a session is running for that sandbox

#### Scenario: Stale lock is replaced
- **WHEN** a session crashed and left a lock whose process no longer exists, and the user runs `osa resolve <sandbox> apply`
- **THEN** the resolve runs normally
