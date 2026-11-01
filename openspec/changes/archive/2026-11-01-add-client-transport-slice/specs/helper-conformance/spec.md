## MODIFIED Requirements

### Requirement: One case set runs against a selectable backend

The repository SHALL provide a conformance suite that runs an unmodified case
set against a helper backend selected at run time, without editing case bodies.
The backend selector SHALL accept a command path, or an argv prefix, for each
of the four agent front-ends, and SHALL default to the repository's own
`bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`, and `bin/codex-oss`.

The suite SHALL run offline: no Docker, no external gateway, no network beyond
loopback, and only the stub executables under `tests/stub/` on the front of
`PATH`. For a case whose command reaches the gateway through the typed client
rather than by spawning the CLI, the suite SHALL start its own in-process
gateway on a loopback port before that case runs and stop it afterwards, so the
case needs no gateway provisioned on the host.

#### Scenario: Default backend reproduces the current behavior
- **WHEN** a maintainer runs `make test-conformance` with no backend selected
- **THEN** every case runs against `bin/maki-oss` and the other `bin/` front-ends, and the command exits 0

#### Scenario: A second backend can be selected without touching a case
- **WHEN** the maintainer selects a backend executable for `maki-oss` and runs the suite
- **THEN** the same case bodies run against that executable, and no case file is modified

#### Scenario: The suite runs with no network and no engine
- **WHEN** the suite runs on a host without Docker and without a reachable gateway
- **THEN** every case still runs and no case reports a network or engine error

#### Scenario: A client-transport case has a gateway to talk to
- **WHEN** a case's command contacts the gateway through the typed client and the host has no gateway provisioned
- **THEN** the suite has started its own in-process gateway for that case, and the case completes

#### Scenario: The in-process gateway is not left running
- **WHEN** the suite finishes, whether every case passed or one failed
- **THEN** no gateway process the suite started is still listening
