# Spec Delta

## MODIFIED Requirements

### Requirement: Both transports see one fixture

The conformance suite SHALL provide each case's per-run fixtures — exec
outcomes, pending rules, create arguments, and attach or delete failures — to
the CLI stub and the fake gateway through one channel, so a case behaves the
same over either transport.

The fake gateway SHALL apply the exec fixtures to every helper-internal script
the CLI stub runs, not only to agent commands. It SHALL recognize an internal
script by the invocation shape the helper uses for its own probes — a shell
script run with `sh -c <script> <label>` — and MUST NOT depend on a fixed list
of labels, so a probe the helper adds later is covered without editing the fake
gateway.

An exec fixture a case supplied SHALL determine the probe's answer on both
transports. When a case supplies a canned answer or a failure for a probe, the
other transport MUST NOT replace it with the default exec outcome, and a probe
whose answer the case did not supply SHALL fall back to the same default on
both transports.

#### Scenario: A fixture-driven case matches across transports

- **WHEN** a case with an exec fixture runs over the client and over the CLI
- **THEN** both report `transport-changed` with identical state, exit status, and output

#### Scenario: A helper probe uses the case's answer over the fake gateway

- **WHEN** a case supplies the answer for an internal probe and the helper runs that probe through the typed client
- **THEN** the fake gateway returns that answer with its exit status, and the helper's control flow follows it instead of recording a probe failure

#### Scenario: A probe's failure fixture applies over the fake gateway

- **WHEN** a case supplies a failure for an internal probe and the helper runs that probe through the typed client
- **THEN** the probe fails with the fixture's exit status and message on both transports

#### Scenario: An agent command is not treated as an internal probe

- **WHEN** the helper runs an agent such as `maki -p …` through the typed client
- **THEN** the fake gateway handles it as an agent run, not as an internal script

#### Scenario: A probe without a case answer falls back identically

- **WHEN** an internal probe runs with no case-specific fixture on either transport
- **THEN** both transports return the same default outcome, so a golden comparison cannot fail on the transport alone
