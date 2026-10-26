# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: osa entry point is read-only`
- TO: `### Requirement: osa entry point`

## MODIFIED Requirements

### Requirement: osa entry point

The repository SHALL provide an `osa` command that works across every agent front-end. `osa` SHALL offer `projects`, `status`, `resolve`, and `help`, and every other command SHALL be a usage error. `resolve` is the only `osa` command that changes anything; it is defined by the requirements "osa resolves retained patches" and "osa resolves parked workspaces". `projects`, `status`, and `help` MUST NOT create, start, stop, delete, upload to, or download from a sandbox, MUST NOT launch an agent, and MUST NOT write any file under the state root. No `osa` command MUST create, stop, or delete a sandbox or launch an agent, and only `osa resolve <sandbox> rescue` MAY start a stopped one. The full `osa status` MAY query the gateway read-only and MAY run the same read-only workspace probe that the front-end's `status` runs; it MUST NOT run anything else in a sandbox. `osa projects` and `osa status --quick` MUST NOT contact the gateway.

#### Scenario: osa never changes a sandbox
- **WHEN** the user runs `osa projects`, `osa status`, and `osa status --quick` while a registered sandbox is `Ready`
- **THEN** the gateway receives no create, start, stop, delete, upload, or download call and no agent launch, and no file under the state root changes

#### Scenario: Projects and quick status stay off the gateway
- **WHEN** the user runs `osa projects` and `osa status --quick`
- **THEN** the gateway receives no call at all

#### Scenario: Unknown command is a usage error
- **WHEN** the user runs `osa up`
- **THEN** the command exits as a usage error that lists `projects`, `status`, `resolve`, and `help`

### Requirement: osa status reports a project across agents

`osa status [PATH]` SHALL report every registry entry whose `host_path` is the absolute physical form of `PATH` (default: the current directory), one entry per agent. The full mode SHALL report phase, attached providers, sync state (`clean`, `behind`, `retained`, or `parked`), the retained patch path, and the next command, with the same classification the agent's front-end `status` gives for that project. With `--quick` it SHALL NOT hash the project tree: it SHALL report the pending kind from the files, the fingerprint result `changed`, `unchanged`, or `unknown`, and `busy` (`true` while a live session or resolve holds that sandbox's lock), and MUST NOT report `clean` or `behind`. With `--json` it SHALL print one JSON array on stdout and nothing else. A path with no registry entry SHALL print `[]` with `--json` and exit 0.

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

#### Scenario: Unregistered path
- **WHEN** the user runs `osa status --json /tmp/elsewhere` and no entry has that `host_path`
- **THEN** stdout is `[]` and the exit code is 0

## ADDED Requirements

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
