# Spec Delta

## MODIFIED Requirements

### Requirement: osa entry point

The repository SHALL provide an `osa` command that works across every agent front-end. `osa` SHALL offer `projects`, `status`, `health`, `providers`, `images`, `resolve`, `provider setup`, `image build`, and `help`, and every other command SHALL be a usage error. `resolve`, `provider setup`, and `image build` are the only `osa` commands that change anything; they are defined by the requirements "osa resolves retained patches", "osa resolves parked workspaces", "osa sets up a provider from stdin", and "osa reports and builds base images". `image build` MUST change nothing but the agent's local base image tag. `projects`, `status`, `health`, `providers`, `images`, and `help` MUST NOT create, start, stop, delete, upload to, or download from a sandbox, MUST NOT launch an agent, MUST NOT create, update, or attach a provider, MUST NOT build, tag, or remove an image, and MUST NOT write any file under the state root. No `osa` command MUST create, stop, or delete a sandbox or launch an agent, only `osa resolve <sandbox> rescue` MAY start a stopped one, and only `osa provider setup` MAY attach a provider to one. The full `osa status`, `osa health`, and `osa providers` MAY query the gateway read-only and MAY run the same read-only probes that the front-end's `status`, `mcp status`, and `doctor` run; they MUST NOT run anything else in a sandbox. `osa projects`, `osa status --quick`, and `osa images` MUST NOT contact the gateway.

#### Scenario: osa never changes a sandbox
- **WHEN** the user runs `osa projects`, `osa status`, `osa status --quick`, `osa health <sandbox>`, `osa providers --json`, and `osa images --json` while a registered sandbox is `Ready`
- **THEN** the gateway receives no create, start, stop, delete, upload, download, provider create, provider update, or attach call and no agent launch, the container engine receives no build, tag, or remove call, and no file under the state root changes

#### Scenario: Projects and quick status stay off the gateway
- **WHEN** the user runs `osa projects`, `osa status --quick`, and `osa images`
- **THEN** the gateway receives no call at all

#### Scenario: Unknown command is a usage error
- **WHEN** the user runs `osa up`
- **THEN** the command exits as a usage error that lists `projects`, `status`, `health`, `providers`, `images`, `resolve`, `provider setup`, `image build`, and `help`

## ADDED Requirements

### Requirement: osa reports and builds base images

`osa images [--json]` SHALL report, for each known agent, the agent tag, the base image tag its front-end's `image build` produces, the resolved container engine, whether that tag exists in the engine's local store (with the image id and creation time when it does), and the image the agent's sessions are configured to use when it differs from the base tag. With `--json` it SHALL print one JSON array and nothing else. When the engine is missing or the image inspection fails for another reason, that agent's entry SHALL carry an `error` instead of failing the command.

`osa image build TAG` SHALL run the agent's `image build` with its default tag and default version, and with no other argument. Both its output and the engine's SHALL go to stdout and stderr as produced. It SHALL exit 0 when the image was built, 1 for a usage error (unknown or missing tag, any extra argument), and the front-end's non-zero exit status otherwise. It MUST NOT read standard input. When the process receives SIGTERM or SIGINT during a build, it SHALL stop the engine's build and exit non-zero without leaving the engine process running.

#### Scenario: Missing base image is reported
- **WHEN** the engine has no `maki-agent:local` and the user runs `osa images --json`
- **THEN** the `mk` entry reports the tag `maki-agent:local`, the engine, and `present` `false`

#### Scenario: Derived environment is shown
- **WHEN** `maki-oss`'s config sets `image = "maki-env:me"`
- **THEN** the `mk` entry reports base tag `maki-agent:local` and configured image `maki-env:me`

#### Scenario: Build streams and succeeds
- **WHEN** the user runs `osa image build oc` with a working engine
- **THEN** the engine receives `build -t opencode-agent:local <repo>/opencode-oss/image`, its output appears on stdout as it is produced, and the command exits 0

#### Scenario: Extra arguments are refused
- **WHEN** the user runs `osa image build mk --maki-version 1.2.3`
- **THEN** the command exits 1, and the engine receives no call

#### Scenario: Cancel stops the engine
- **WHEN** `osa image build mk` receives SIGTERM while the engine is building
- **THEN** the engine process receives SIGTERM, the command exits non-zero, and no engine process from the build remains
