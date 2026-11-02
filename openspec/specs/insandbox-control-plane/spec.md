# insandbox-control-plane Specification

## Purpose

Provides a dev-only, loopback, plaintext OpenShell-compatible service that lets
osa's own front-ends run their sandbox lifecycle inside an osa sandbox, where
sandboxes are directories and exec is a local child process, without ever being
mistaken for an isolation boundary.

## Requirements

### Requirement: The plane speaks the gateway surface the client uses

The plane SHALL serve the OpenShell RPC surface the typed client calls: sandbox
create, get, list, start, stop, delete, exec, log streaming, provider list,
attach, and detach, rule reads, and health. A request outside that surface
SHALL fail with an error naming the unimplemented operation, and MUST NOT
return a success with an empty result.

The plane SHALL pass the same SDK contract case set that `stub-gateway` passes,
so both are held to the generated surface
(<https://docs.nvidia.com/openshell/sdk/rust.md>).

#### Scenario: A covered operation answers

- **WHEN** the client creates a sandbox and then lists sandboxes
- **THEN** the created sandbox appears with a phase, and the list reply parses as the client expects

#### Scenario: An uncovered operation names itself

- **WHEN** the client requests an operation the plane does not serve
- **THEN** the call fails with an error naming that operation and no partial state is written

### Requirement: A sandbox is a directory with a phase

Each sandbox SHALL be materialized as a directory under the plane's state root
with a phase record, and create, start, stop, and delete SHALL be transitions
on that record. Deleting a sandbox SHALL remove its directory and its recorded
provider attachments. The state root SHALL be the only place the plane writes,
and each sandbox's files SHALL stay inside its own directory.

#### Scenario: Create then delete leaves nothing behind

- **WHEN** a sandbox is created and then deleted
- **THEN** its phase record and its directory are both gone

#### Scenario: A stopped sandbox refuses work

- **WHEN** exec runs against a sandbox whose phase is stopped
- **THEN** the call fails with a stopped-sandbox error and no process is started

### Requirement: Exec runs a real local process

`exec` SHALL spawn a child process in the sandbox's workdir on the same host,
stream its stdout and stderr in order, and report its exit code. The child
SHALL run as the invoking uid with the invoking environment plus the variables
the request names. A sandbox-side command failure SHALL be reported as a
non-zero exit code, distinct from a plane failure.

#### Scenario: A failing command reports its own exit code

- **WHEN** exec runs a command that exits 7
- **THEN** the client observes exit code 7 and the command's stderr, and not a transport error

#### Scenario: Output streams without buffering the process

- **WHEN** exec runs a command that prints, waits, and prints again
- **THEN** the client observes the first output before the process exits

### Requirement: File transfer stays inside the state root

Upload SHALL copy host files into the sandbox directory and download SHALL copy
sandbox files out. Neither SHALL create a bind mount. A path that would resolve
outside the sandbox directory, including through a symlink, SHALL be refused
before any file is written, and the refusal SHALL name the offending path.

#### Scenario: Upload then download round-trips content

- **WHEN** a file is uploaded into a sandbox and downloaded from it
- **THEN** the two copies are byte-identical

#### Scenario: An escaping path is refused

- **WHEN** a download names a path that resolves outside the sandbox directory
- **THEN** the call fails naming the path and no file is written outside the sandbox

### Requirement: The plane refuses to run outside a sandbox

The plane SHALL refuse to start unless it detects that it is running inside an
osa sandbox, and the refusal SHALL name the detection it failed. It SHALL bind
a loopback address only, SHALL accept plaintext clients only, and SHALL refuse
a bearer or mutual-TLS configuration rather than silently downgrading. It MUST
NOT add an egress rule, read a credential, or enrol itself as a gateway in any
host-side configuration.

#### Scenario: A host run is refused

- **WHEN** the plane is started on a host that is not a sandbox
- **THEN** it exits non-zero with a message naming the missing sandbox detection and opens no listener

#### Scenario: A non-loopback bind is refused

- **WHEN** the plane is started with a non-loopback bind address
- **THEN** it exits non-zero and opens no listener

### Requirement: The CLI shim is scoped, not installed

The plane SHALL provide an `openshell` shim covering only the surface the typed
client does not serve: gateway information and sandbox upload and download. The
shim SHALL be usable only through a private directory that the plane prepends
to `PATH` for its own child process tree, and MUST NOT be installed system-wide
under the `openshell` name.

#### Scenario: The shim resolves only inside the plane's tree

- **WHEN** a command runs under the plane and then a shell runs outside it
- **THEN** the first resolves the shim and the second does not

#### Scenario: The shim covers nothing else

- **WHEN** the shim is asked for a subcommand outside gateway information and file transfer
- **THEN** it fails naming the unsupported subcommand instead of reporting success

### Requirement: The plane never claims to be a boundary

The plane's documentation and its own startup output SHALL state that it
provides no isolation, no policy enforcement, and no credential brokering, and
that its safety comes only from running inside a real sandbox. It MUST NOT
report a policy result, an egress decision, or a credential value as if it had
verified them.

#### Scenario: Startup states the non-guarantee

- **WHEN** the plane starts successfully
- **THEN** its output states that it enforces no isolation or policy

#### Scenario: A policy request is recorded, not proved

- **WHEN** a client reads a policy through the plane
- **THEN** the reply is the recorded sandbox policy and carries no enforcement claim
