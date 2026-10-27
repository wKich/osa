# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
