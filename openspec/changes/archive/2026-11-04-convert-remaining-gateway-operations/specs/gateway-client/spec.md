## MODIFIED Requirements

### Requirement: Every covered gateway operation goes through one typed client

The core SHALL perform each covered gateway operation through a single
`Gateway` abstraction rather than by building an `openshell` command line. The
covered operations SHALL be: sandbox create, start, stop, delete, get, and
list; readiness and deletion waits; exec (buffered, streamed, and interactive);
log streaming; provider create, list, attach, and detach; and rule get, list,
approve, and reject.

For a covered operation, no code path SHALL construct gateway argv or parse
gateway command output. The only `openshell` calls that remain SHALL be file
transfer, gateway info and status, policy show and apply, settings, and provider
profile import and lint.

#### Scenario: A converted operation builds no gateway argv
- **WHEN** a converted command runs against the recording client
- **THEN** its transcript contains gateway requests and no `openshell` process invocation

#### Scenario: An uncovered operation stays explicit
- **WHEN** the core uploads or downloads a file, or asks for gateway info
- **THEN** that call is reachable from `gateway/cli.rs` and from no other module

## ADDED Requirements

### Requirement: The interactive session runs over the client

The interactive session, the timeout wrapper, and the script and probe execs
SHALL run through the `Gateway` trait. The request SHALL carry the command,
working directory, login-shell choice, and environment names; the interactive
variant SHALL carry stdin bytes, TTY mode, and terminal resize events, and SHALL
report the exit status separately from the output.

An interrupt SHALL end the stream, restore the terminal, and leave no orphaned
process. No credential value SHALL appear in the request's non-secret fields.

#### Scenario: Output appears before the process exits
- **WHEN** an interactive exec emits a line and then waits
- **THEN** the line is written to the caller before the wait ends

#### Scenario: An interrupt leaves nothing running
- **WHEN** a sessioned exec is interrupted
- **THEN** the stream ends, the terminal is restored, and the sandbox process is gone

### Requirement: Sandbox create records the spec it sends

The transport SHALL record the create spec it was given — image, policy path,
CPU, memory, providers, and environment names — before building the request, so
the conformance cases continue to pin the create argument surface.

#### Scenario: The policy path is still reviewed
- **WHEN** a create runs with a policy file
- **THEN** the recorded request names that policy path, and no credential value appears

### Requirement: Provider create covers the command surface

`ProviderSpec` SHALL carry the create command's options: `from_existing`,
`global_profile`, `runtime_credentials`, named credential fields, and config
pairs. `from_existing` SHALL select the gateway's existing-credential mode and
SHALL NOT introduce a second channel for a credential value.

#### Scenario: A credential keeps its one field
- **WHEN** a provider create runs with a sentinel credential and `from_existing`
- **THEN** the sentinel appears only in the designated request field

### Requirement: Rule listing is rendered from structured data

`list_rules` SHALL return each proposal's chunk id, rule name, binary,
endpoints, status, and prover verdict. `policy review` and the pending-proposal
note SHALL render their text from those fields, matching the CLI's wording, and
SHALL NOT depend on a text-only gateway response.

#### Scenario: The review text carries the chunk id
- **WHEN** a pending proposal is listed and rendered
- **THEN** the output contains its chunk id and prover verdict from the structured fields

### Requirement: Both transports see one fixture

The conformance suite SHALL provide each case's per-run fixtures — exec
outcomes, pending rules, create arguments, and attach or delete failures — to
the CLI stub and the fake gateway through one channel, so a case behaves the
same over either transport.

#### Scenario: A fixture-driven case matches across transports
- **WHEN** a case with an exec fixture runs over the client and over the CLI
- **THEN** both report `transport-changed` with identical state, exit status, and output
