# helper-conformance Specification

## Purpose
Provides a backend-neutral contract test for the helper's OpenShell seam: case selection, invocation recording, golden comparison, secret-leak assertion, state-tree assertion, and two-backend parity, so a second implementation of the helper can be run through the same cases and compared with the current one.

## Requirements

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

### Requirement: Every seam invocation is recorded

For each case, the harness SHALL record what crossed the seam in the form the
case's backend uses:

- for an operation performed by the OpenShell CLI, every stub invocation as its
  argv plus the **names** of the environment variables it was given;
- for an operation performed by the typed gateway client, a normalized gateway
  request transcript.

A case SHALL declare its expected transport, and the harness SHALL record only
that transport for that case. The recording SHALL NOT contain any environment
variable's value, any credential value, or any value read from a credential
fixture.

#### Scenario: Recording captures argv order and environment names
- **WHEN** a CLI-transport case that creates a sandbox runs
- **THEN** its recording shows the `sandbox create` argv in order and the names of the environment variables supplied to the child, and no variable values

#### Scenario: Recording captures a gateway request
- **WHEN** a client-transport case that creates a sandbox runs
- **THEN** its recording shows the normalized request (operation, target, and non-secret fields) and no process invocation

#### Scenario: Two runs of one case record identically
- **WHEN** the same case runs twice against the same backend
- **THEN** the two recordings are byte-identical, so a golden comparison cannot fail on incidental data

#### Scenario: A transport mismatch is reported
- **WHEN** a case declares the CLI transport and the backend performs the operation through the client
- **THEN** the case fails and names the expected and observed transports

### Requirement: Recorded invocations match committed goldens

A case that carries a committed golden file SHALL fail when its recording
differs from the golden, and the failure SHALL name the case and print a
line-level diff of the two recordings. The golden SHALL be stored per declared
transport, so converting an operation rewrites one file rather than invalidating
a shared one.

A case without a golden file SHALL be recorded without being compared, and the
suite SHALL report how many cases are unrecorded.

#### Scenario: An argv change fails the case
- **WHEN** a backend adds, removes, reorders, or renames an argument in a recorded CLI invocation for a golden case
- **THEN** that case fails and the failure prints the differing lines

#### Scenario: A request-field change fails the case
- **WHEN** a backend changes a non-secret field in a recorded gateway request for a golden case
- **THEN** that case fails and the failure prints the differing field

#### Scenario: An unrecorded case does not fail
- **WHEN** a case has no golden file
- **THEN** the suite passes that case, records it, and reports it in the unrecorded count

#### Scenario: Refreshing a golden is explicit
- **WHEN** the maintainer runs the suite in record mode
- **THEN** the harness rewrites the affected golden files and reports which files changed, and a normal run never writes a golden

### Requirement: No credential reaches argv, state, or output

The harness SHALL provide at least one case per front-end that exercises a
credentialed provider path with fixture values, and SHALL fail when any fixture
value appears in a recorded argv, in any file the helper writes under the state
root, or in the helper's stdout or stderr.

#### Scenario: A provider case leaks nothing
- **WHEN** a case supplies a fixture credential through the documented channel and runs the provider path
- **THEN** no fixture value appears in the recording, in the state tree, or in the captured output

#### Scenario: A leak fails the case
- **WHEN** a deliberately broken backend passes the fixture credential as an argument
- **THEN** the case fails and names the argument position that carried the value

### Requirement: Observable state is asserted per case

For each case, the harness SHALL assert the state tree the helper produced:
registry entry files and their fields, pending/synced/baseline marker presence
and kind, lock presence during a run and absence after it, and the exit code and
captured stdout/stderr of the invoked command.

#### Scenario: Registry fields are asserted field by field
- **WHEN** a case creates a project sandbox
- **THEN** the case asserts each registry field it expects by name, and fails naming the missing or wrong field

#### Scenario: A lock is observable while a run holds it
- **WHEN** a case holds a session open
- **THEN** the case observes the per-sandbox lock file, and observes it gone after the session ends

### Requirement: Parity mode compares two backends

The suite SHALL provide a parity mode that runs the same case set against two
selected backends and reports, per case, one of: identical, `transport-changed`,
divergent in recording, divergent in state, or divergent in exit status or
output.

`transport-changed` SHALL be reported, and SHALL NOT fail the run, when the two
backends declare different transports for a case and agree on state, exit
status, and output. Every other divergence SHALL fail the run.

The repository gate SHALL run parity over the converted case set, once with the
typed client and once with `OSA_GATEWAY_TRANSPORT=cli`, and SHALL fail on any
verdict other than identical or `transport-changed`.

#### Scenario: Identical backends report identical
- **WHEN** parity mode runs the case set against two copies of the same backend
- **THEN** every case reports identical and the command exits 0

#### Scenario: A declared transport change passes on state and output
- **WHEN** one backend performs a case through the CLI and the other through the gateway client, with the same resulting state, exit status, and output
- **THEN** the case reports `transport-changed` and the command exits 0

#### Scenario: A transport change with a behavioral difference fails
- **WHEN** the converted backend writes a different registry field value for a converted case
- **THEN** the case reports divergent in state, names the field, and the command exits non-zero

#### Scenario: A divergent backend is named
- **WHEN** parity mode runs against a backend that writes a different registry field value for one case
- **THEN** that case reports divergent in state, names the field, and the command exits non-zero while still running the remaining cases

#### Scenario: The gate runs parity over the converted set
- **WHEN** the repository gate runs
- **THEN** it compares the converted cases over both transports and fails on any divergence
