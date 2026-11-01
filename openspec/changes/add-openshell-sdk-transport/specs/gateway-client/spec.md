## ADDED Requirements

### Requirement: Every covered gateway operation goes through one typed client

The core SHALL perform each covered gateway operation through a single
`Gateway` abstraction rather than by building an `openshell` command line. The
covered operations SHALL be: sandbox create, start, stop, delete, get, and
list; readiness and deletion waits; exec; log streaming; provider create,
list, attach, and detach; and rule get, list, and approve.

For a covered operation, no code path SHALL construct gateway argv or parse
gateway command output.

#### Scenario: A converted operation builds no gateway argv
- **WHEN** a converted command runs against the recording client
- **THEN** its transcript contains gateway requests and no `openshell` process invocation

#### Scenario: An uncovered operation stays explicit
- **WHEN** the core uploads or downloads a file, or asks for gateway info
- **THEN** that call is the only kind that spawns `openshell`, and it is reachable from one module

### Requirement: Endpoint discovery happens in one place

The core SHALL resolve the gateway endpoint from, in order: an explicit
selection (flag, environment, or the project's `gateway` config key), then a
single `openshell gateway info --output json` call cached for the process
lifetime. The core SHALL NOT read OpenShell's gateway registry file directly.

When discovery fails, the command SHALL exit non-zero with a message naming the
gateway, the attempted sources, and the fix, before performing any state
mutation.

#### Scenario: Explicit selection wins
- **WHEN** a gateway is named explicitly and `openshell gateway info` reports a different one
- **THEN** the explicit gateway is used and no other gateway is contacted

#### Scenario: Discovery runs once per process
- **WHEN** a command performs several gateway operations
- **THEN** `openshell gateway info` is invoked at most once

#### Scenario: Discovery failure precedes mutation
- **WHEN** the gateway is unreachable and `osa remove` runs
- **THEN** the command exits non-zero with the discovery message and no registry entry is changed

#### Scenario: The private registry file is never read
- **WHEN** the core source is searched for the gateway registry path
- **THEN** there is no match

### Requirement: Streaming output is streamed, not buffered

An operation whose output is passed through to the user (exec output during a
run, log tailing) SHALL emit each chunk as it arrives and SHALL NOT buffer the
whole stream before writing.

#### Scenario: Output appears before the command finishes
- **WHEN** a streamed exec emits a line and then waits
- **THEN** that line is written to the caller before the wait ends

#### Scenario: A probe may buffer
- **WHEN** a health probe runs a short command whose whole output is needed
- **THEN** the core may buffer it and still reports the exit code separately from the output

### Requirement: Wait semantics are preserved

The core SHALL preserve the current readiness and deletion behavior: the same
timeouts, the same treatment of a sandbox that enters an error phase, and a
timeout message that names the sandbox and the last observed phase.

#### Scenario: A ready sandbox stops the wait
- **WHEN** a sandbox becomes ready inside the timeout
- **THEN** the wait returns without further polling

#### Scenario: A timeout names the phase
- **WHEN** the timeout elapses while the sandbox is still starting
- **THEN** the command fails with a message naming the sandbox and that phase

### Requirement: Provider and rule semantics are unchanged

The client SHALL NOT add, widen, or bulk-apply a network rule beyond what the
existing commands do. Approving a proposal SHALL target exactly one chunk
identifier. A rule listing SHALL carry each proposal's chunk id, rule name,
binary, endpoints, and prover verdict, and SHALL NOT depend on a text-only
gateway response.

#### Scenario: Approval targets one chunk
- **WHEN** an approval request names a chunk id
- **THEN** exactly that chunk is approved and no other rule changes

#### Scenario: A listing carries the prover verdict
- **WHEN** a pending proposal is listed
- **THEN** its chunk id, rule name, binary, endpoints, and prover verdict are all present

#### Scenario: No operation widens egress on its own
- **WHEN** a command other than an explicit approval runs
- **THEN** the transcript contains no rule write

### Requirement: Credentials are sent only in the designated payload field

A credential value SHALL be placed only in the gateway request field defined to
carry it. The value SHALL NOT appear in request tracing, log output, error
text, debug formatting, or a file under the state root, and types that carry it
SHALL NOT implement display or serialization.

#### Scenario: A sentinel credential leaves no trace
- **WHEN** a provider create runs with a sentinel credential value against the recording client
- **THEN** the sentinel appears in the captured request only in the field designated for it, and appears nowhere in tracing, state files, or output

#### Scenario: An error keeps the value out
- **WHEN** the gateway rejects a request carrying a credential
- **THEN** the error text names the field and the gateway status and does not contain the value

### Requirement: Gateway errors are typed and mapped

The client SHALL return a typed error distinguishing at least: gateway
unreachable, unauthenticated, not found, already exists, policy denied, and
operation failed. Each SHALL map to the command's documented message and exit
code, and a command SHALL NOT branch on a gateway message string.

#### Scenario: Already-exists keeps the create-race behavior
- **WHEN** a create reports that the sandbox name already exists
- **THEN** the core re-reads the sandbox and continues by reusing it

#### Scenario: Policy denied is distinguishable
- **WHEN** the gateway denies an operation by policy
- **THEN** the command reports the policy denial rather than a generic failure

### Requirement: Tests record requests, production never does

Test builds SHALL substitute a recording client implementation that captures
normalized gateway requests. The production client SHALL have no way to write a
transcript, and no environment variable SHALL enable recording in a shipped
binary.

#### Scenario: Recording is test-only
- **WHEN** a production binary runs with any environment variable that names a transcript directory
- **THEN** no transcript is produced, because the recording client is not compiled into it and reads no environment variable

#### Scenario: Transcripts are stable
- **WHEN** the same case runs twice with the recording client
- **THEN** the two normalized transcripts are byte-identical

### Requirement: The client is verified against a gateway-shaped peer

The client SHALL be exercised in tests against an in-process service that
implements OpenShell's gateway RPC surface over temporary state, so that request
encoding, waits, streams, and error paths are verified without a gateway,
Docker, or network access.

That service SHALL be able to provoke, deterministically, at least: a create
that reports the name already exists, a delete the gateway refuses, and a policy
chunk carrying a prover verdict.

#### Scenario: The suite runs with no gateway
- **WHEN** the core test suite runs on a host with no gateway, no Docker, and no network
- **THEN** every covered client operation is still exercised and the suite passes

#### Scenario: The create race is deterministic
- **WHEN** a create targets a name the service already holds
- **THEN** the client reports it as already existing and the core re-reads and reuses the sandbox rather than failing

#### Scenario: A refused delete is reported and keeps the sandbox
- **WHEN** the service refuses a delete for a sandbox that exists
- **THEN** the client reports the failure and the sandbox is still listed afterwards

#### Scenario: Structured fields come from the payload
- **WHEN** a policy chunk carries a chunk id, rule name, binary, endpoints, and prover verdict
- **THEN** the listing carries all five from the response payload and parses no command output

### Requirement: The client version tracks the pinned gateway

The SDK dependency SHALL be pinned to the same release tag as the OpenShell
gateway version the host playbook pins, and a repository check SHALL fail when
the two diverge.

#### Scenario: A version drift fails the check
- **WHEN** the gateway version in the host playbook and the SDK tag in the manifest differ
- **THEN** the version check fails and names both values
