# Spec Delta

## MODIFIED Requirements

### Requirement: osa entry point

The repository SHALL provide an `osa` command that works across every agent front-end. `osa` SHALL offer `projects`, `status`, `health`, `providers`, `images`, `resolve`, `provider setup`, `image build`, `dashboard`, and `help`, and every other command SHALL be a usage error. `resolve`, `provider setup`, and `image build` are the only `osa` commands that change anything; they are defined by the requirements "osa resolves retained patches", "osa resolves parked workspaces", "osa sets up a provider from stdin", and "osa reports and builds base images". `image build` MUST change nothing but the agent's local base image tag. `dashboard` starts the web UI defined by the `dashboard` capability: it MUST NOT itself contact the gateway, write under the state root, or run any other `osa` command, and every change the running dashboard makes MUST go through the `osa` commands and gateway actions that capability allows. `projects`, `status`, `health`, `providers`, `images`, and `help` MUST NOT create, start, stop, delete, upload to, or download from a sandbox, MUST NOT launch an agent, MUST NOT create, update, or attach a provider, MUST NOT build, tag, or remove an image, and MUST NOT write any file under the state root. No `osa` command MUST create, stop, or delete a sandbox or launch an agent, only `osa resolve <sandbox> rescue` MAY start a stopped one, and only `osa provider setup` MAY attach a provider to one. The full `osa status`, `osa health`, and `osa providers` MAY query the gateway read-only and MAY run the same read-only probes that the front-end's `status`, `mcp status`, and `doctor` run; they MUST NOT run anything else in a sandbox. `osa projects`, `osa status --quick`, and `osa images` MUST NOT contact the gateway.

#### Scenario: osa never changes a sandbox
- **WHEN** the user runs `osa projects`, `osa status`, `osa status --quick`, `osa health <sandbox>`, `osa providers --json`, and `osa images --json` while a registered sandbox is `Ready`
- **THEN** the gateway receives no create, start, stop, delete, upload, download, provider create, provider update, or attach call and no agent launch, the container engine receives no build, tag, or remove call, and no file under the state root changes

#### Scenario: Projects and quick status stay off the gateway
- **WHEN** the user runs `osa projects`, `osa status --quick`, and `osa images`
- **THEN** the gateway receives no call at all

#### Scenario: Unknown command is a usage error
- **WHEN** the user runs `osa up`
- **THEN** the command exits as a usage error that lists `projects`, `status`, `health`, `providers`, `images`, `resolve`, `provider setup`, `image build`, `dashboard`, and `help`

## ADDED Requirements

### Requirement: osa dashboard starts the web UI

`osa dashboard [--port N] [--host ADDR] [--token T] [--read-only] [--open]` SHALL run the repository's dashboard in the foreground, from any working directory, until it is interrupted. It SHALL replace its own process with the dashboard's process, so that the exit status and signals belong to the dashboard. It SHALL pass the given flags to the dashboard unchanged and in order, and SHALL pass no flag the user did not give. Any other argument SHALL be a usage error before anything starts. The dashboard SHALL be started with `DASHBOARD_OSA_BIN` set to the absolute path of the `osa` that was run, overriding any inherited value. Every other environment variable, including the `DASHBOARD_*` settings, SHALL pass through. When Bun is not on `PATH`, or its version is below the minimum the dashboard supports, the command SHALL exit non-zero before starting anything, with a message that names the found version (if any), the minimum, and where to install Bun. When the dashboard files are missing next to `osa`, it SHALL exit non-zero and name the expected path. `osa dashboard` MUST NOT start a background process, write a PID file, or write under the state root.

#### Scenario: Start from any folder
- **WHEN** the user runs `osa dashboard` in their home directory
- **THEN** Bun runs `<repo>/dashboard/src/main.ts` with no extra flags, `DASHBOARD_OSA_BIN` is `<repo>/bin/osa`, and the dashboard prints its loopback URL

#### Scenario: Flags pass through
- **WHEN** the user runs `osa dashboard --port 9000 --read-only --open`
- **THEN** the dashboard receives exactly `--port 9000 --read-only --open`

#### Scenario: Unknown flag is a usage error
- **WHEN** the user runs `osa dashboard --daemon`
- **THEN** the command exits as a usage error, and Bun is not started

#### Scenario: Missing Bun
- **WHEN** no `bun` is on `PATH` and the user runs `osa dashboard`
- **THEN** the command exits non-zero with a message naming Bun, the minimum version, and the install link, and nothing is started

#### Scenario: Old Bun
- **WHEN** `bun --version` reports `1.1.30`
- **THEN** the command exits non-zero, naming `1.1.30` and the minimum version

#### Scenario: Interrupt stops the server
- **WHEN** the user presses Ctrl-C while `osa dashboard` runs
- **THEN** the dashboard process exits and no dashboard process is left running
