# Spec Delta

## MODIFIED Requirements

### Requirement: Sandbox names fit the gateway

The helper SHALL derive `{project}` from the name of the project's git `origin` remote (the last path segment of its URL, without a trailing `.git`), and SHALL fall back to the current directory name when the folder is not a git repository, has no `origin` remote, or the host has no `git`. It SHALL clean the name by lowercasing it, replacing every character outside `[a-z0-9-]` with a hyphen, collapsing repeated hyphens, and trimming leading and trailing hyphens. `{hash}` SHALL be a stable four-character lowercase hex hash of the project folder's absolute physical path. The default sandbox name SHALL be `mk-{project}-{hash}`. When the expanded name would exceed OpenShell's 19-character limit, the helper SHALL shorten the `{project}` part and drop any trailing hyphen. A pattern without `{hash}` that still has to be shortened SHALL keep today's fitting: the shortened project part is suffixed with a four-character hash of the full project name. When the current folder already has a registry entry for this agent, the helper SHALL use that entry's recorded sandbox name instead of the default. Creating a sandbox whose name is registered to a different host path SHALL fail before any gateway call, and the error SHALL suggest `--name`. A name supplied with `--name`, `MAKI_OSS_SANDBOX_NAME`, or `sandbox_name` SHALL take precedence over the registry and the default, and SHALL be validated against the same lowercase, hyphen, and length rules before any gateway call; an invalid name SHALL exit as a usage error.

#### Scenario: Default name uses the remote name and a path hash
- **WHEN** the user runs `maki-oss up` in a git repository whose `origin` is `git@github.com:acme/app.git`
- **THEN** the sandbox name is `mk-app-` followed by four lowercase hex characters

#### Scenario: A folder without git uses its directory name
- **WHEN** the user runs `maki-oss up` in a folder named `My App` that is not a git repository
- **THEN** the sandbox name starts with `mk-my-app-`

#### Scenario: Two worktrees get different sandboxes
- **WHEN** the user runs `maki-oss up` in two git worktrees of the same repository
- **THEN** the two sandbox names differ only in the hash part

#### Scenario: A long project name is fitted
- **WHEN** the user runs `maki-oss up` in a project whose cleaned name is longer than 11 characters
- **THEN** the sandbox name is at most 19 lowercase letters, digits, or hyphens, and two projects that share a prefix receive different names

#### Scenario: A registered project keeps its sandbox name
- **WHEN** the registry records sandbox `maki-myproject` for the current folder and agent, and the user runs `maki-oss up`
- **THEN** the helper uses `maki-myproject`, not the default name

#### Scenario: A name bound to another folder is refused
- **WHEN** the registry records sandbox `mk-app-1a2b` for `/home/u/a`, and the user runs `maki-oss up --name mk-app-1a2b` in `/home/u/b`
- **THEN** the command exits non-zero without contacting the gateway, and the error suggests `--name`

#### Scenario: An invalid explicit name fails before the gateway
- **WHEN** the user runs `maki-oss up --name My_Project`
- **THEN** the command exits non-zero without contacting the gateway, and the error names the lowercase and hyphen rule

### Requirement: Idempotent sandbox lifecycle

`maki-oss up` SHALL start the project's sandbox when it exists and is stopped, and SHALL create it when absent, never creating a second sandbox with the same name. `maki-oss up` SHALL remain create/start-only and SHALL NOT upload the project. `maki-oss status` SHALL report existence, phase, image, attached providers, sync state (`clean`, `behind`, `retained`, or `parked`), any retained patch path, and the next command for that state. `maki-oss rm` SHALL refuse to delete a parked workspace unless the user passes `--discard`, and SHALL archive instance-scoped sync state when it deletes a sandbox. Sandbox phase and provider lookups MUST give the same result whatever the gateway's JSON layout is (pretty-printed, compact, or a single line listing several sandboxes), with or without `jq` installed.

#### Scenario: First run creates the sandbox
- **WHEN** no sandbox exists for `~/code/myproject` and the user runs `maki-oss up` there
- **THEN** a sandbox with the default name `mk-myproject-` plus four hex characters is created from the configured image, policy, and providers

#### Scenario: Second run starts the same sandbox
- **WHEN** the sandbox exists in `Stopped` phase and the user runs `maki-oss up` again
- **THEN** the existing sandbox is started and no new sandbox is created

#### Scenario: Status reports sync state
- **WHEN** the user runs `maki-oss status` for a project sandbox
- **THEN** the output names one of `clean`, `behind`, `retained`, or `parked` and the next command for that state

#### Scenario: Rm refuses a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss rm --yes`
- **THEN** no delete request is sent and the error names the `--discard` command

#### Scenario: Rm archives state for a disposable sandbox
- **WHEN** the workspace is not parked and the user confirms `maki-oss rm`
- **THEN** the sandbox is deleted and its instance-scoped sync state is archived

#### Scenario: Compact JSON without jq still resolves the phase
- **WHEN** `jq` is not installed and `openshell sandbox list --output json` returns compact JSON such as `{"sandboxes":[{"name":"maki-a","phase":"Stopped"}]}`
- **THEN** `maki-oss status` reports phase `Stopped` for `maki-a` and `maki-oss up` does not attempt a second create

#### Scenario: Single-line JSON never yields another sandbox's phase
- **WHEN** `jq` is not installed and the sandbox list is one line containing several sandboxes, where `maki-a` is `Stopped` and a later sandbox is `Ready`
- **THEN** the reported phase for `maki-a` is `Stopped`, not `Ready`

#### Scenario: Concurrent create race resolves to reuse
- **WHEN** two `maki-oss` runs race to create the same project sandbox and the second create reports that the name already exists
- **THEN** the second run re-checks the sandbox and continues by reusing it instead of exiting with a gateway error
