## MODIFIED Requirements

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
