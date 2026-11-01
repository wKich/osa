## MODIFIED Requirements

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

### Requirement: Parity mode compares two backends

The suite SHALL provide a parity mode that runs the same case set against two
selected backends and reports, per case, one of: identical, `transport-changed`,
divergent in recording, divergent in state, or divergent in exit status or
output.

`transport-changed` SHALL be reported, and SHALL NOT fail the run, when the two
backends declare different transports for a case and agree on state, exit
status, and output. Every other divergence SHALL fail the run.

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
