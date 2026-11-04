# osa-core Specification

## Purpose
Provides the whole documented `osa` command surface from one Rust binary built
out of `osa-core/`: registry, pending-marker, and configuration format parity
in both directions, one JSON implementation, typed state-tree and gateway
reads, credential-safe provider setup, and an offline test suite, verified by
conformance cases that record the gateway seam.

## Requirements

### Requirement: One binary provides the whole `osa` command surface

The repository SHALL provide a Rust binary `osa`, built from a Cargo workspace
under `osa-core/`, that implements every subcommand the documented `osa`
reference describes: `projects`, `status`, `health`, `providers`,
`provider setup`, `images`, `image build`, `remove`, `resolve`, and `dashboard`.

No subcommand SHALL be implemented in two languages at once. `bin/osa` SHALL be
a POSIX `sh` shim that `exec`s the built binary and SHALL NOT contain command
logic of its own.

#### Scenario: Every documented subcommand is served by the binary
- **WHEN** each subcommand and flag in the `osa` reference runs through `bin/osa`
- **THEN** each one reaches the binary and no subcommand is handled by `sh`

#### Scenario: The shim adds no behavior
- **WHEN** the same command runs through `bin/osa` and through the binary directly
- **THEN** stdout, stderr, and the exit code are identical

### Requirement: A missing binary fails with an actionable message

When the built binary is absent, `bin/osa` SHALL exit non-zero and print a
message naming the build command, and SHALL NOT fall back to a shell
implementation.

#### Scenario: Unbuilt checkout
- **WHEN** `bin/osa projects` runs in a checkout that has never been built
- **THEN** the command exits non-zero and its message names `make build`, and no registry file is written

#### Scenario: An explicit binary override is honored
- **WHEN** the launcher variable names an alternate binary path
- **THEN** `bin/osa` execs that binary, so a test or a second build can be exercised without reinstalling

### Requirement: Registry and marker writes match the published format byte for byte

The core SHALL write registry entries and pending markers as flat TOML version
`1` with the same observable form the current writer produces: one
`key = "value"` pair per line, the established key order for a fresh entry,
only `\\` and `\"` escaped inside values, mode `600`, an atomic replace through
a temporary file in the same directory, and a refusal to store a value that
contains a newline or a tab.

#### Scenario: A fresh entry matches a recorded golden
- **WHEN** the core creates a registry entry for a project
- **THEN** the file is byte-identical to the golden flat TOML for that case, and its mode is `600`

#### Scenario: A value with a newline is refused
- **WHEN** a field value contains a newline or a tab
- **THEN** the write fails, the previous file is left intact, and no partial file remains

#### Scenario: A crash during write leaves the old file
- **WHEN** the write is interrupted before the rename
- **THEN** the previous entry is still readable and no temporary file is left behind

### Requirement: Registry and marker reads accept everything the current parser accepts

The core SHALL read flat TOML entries the current `awk` parser accepts:
comments, blank lines, trailing comments after a value, unknown keys beyond the
current schema, and quoted values using the current escape set.

#### Scenario: An entry with an unknown key is readable
- **WHEN** an entry contains a key the current schema does not define
- **THEN** the core reads every known key and does not fail

#### Scenario: A comment and a trailing comment are readable
- **WHEN** an entry contains a comment line and a value followed by a comment
- **THEN** the core reads the value

#### Scenario: A malformed entry is reported, not ignored
- **WHEN** an entry line is not a `key = "value"` pair
- **THEN** every command that reads the file names the file and the line on
  stderr
- **AND** a command that needs that one entry (`health`, `resolve`, `remove`,
  `provider setup --attach`) exits non-zero instead of acting on partial data
- **AND** a listing (`projects`, `status`) skips the unreadable entry, still
  reports the readable ones, and exits 0

### Requirement: JSON output has one implementation

The core SHALL produce every JSON output from a serializer and SHALL NOT
assemble JSON by string concatenation. Its output SHALL be independent of
whether `jq` is installed, and SHALL carry the same object and array shapes,
field names, and null-versus-omitted choices as the current `osa`.

#### Scenario: Output is identical with and without jq
- **WHEN** the same JSON-emitting command runs on a host with `jq` and on one without
- **THEN** both outputs are byte-identical

#### Scenario: A newline in gateway text stays one JSON string
- **WHEN** a gateway-supplied value contains a newline or a carriage return
- **THEN** the output is valid JSON, with the newline escaped and the carriage return dropped

### Requirement: State-tree behavior matches the documented lock and marker semantics

The core SHALL create, observe, and clean locks and markers with the same names
and semantics the `osa-project-layer` requirements define, including the
per-sandbox session lock, the resolve directory, and the pending marker kinds.

#### Scenario: A resolve excludes a concurrent session
- **WHEN** a session holds the sandbox lock and `osa resolve` runs for that sandbox
- **THEN** the resolve waits or refuses as the current implementation does, and reports the same state

#### Scenario: A stale lock is not an obstacle
- **WHEN** a lock file names a process that is no longer alive
- **THEN** the core treats the lock as absent and proceeds

### Requirement: Credentials never travel outside the child environment

The core SHALL deliver a credential value only through the channel the current
transport designates: the child process environment when a gateway operation
is still performed by the OpenShell CLI, and the designated request field when
the operation goes through the typed gateway client.

In both cases the value SHALL NOT appear in argv, in a file under the state
root, in stdout or stderr, in request tracing, or in error text.

#### Scenario: Provider setup leaks nothing
- **WHEN** `osa provider setup` runs with a fixture credential against either transport
- **THEN** the conformance leak case finds no fixture value in any recorded invocation or request, state file, or output

#### Scenario: The transport is not observable in the leak surface
- **WHEN** the same provider case runs once on the CLI transport and once on the client transport
- **THEN** both report no leak, and the only transcript difference is the declared transport

### Requirement: An offline core test suite

The repository SHALL provide `make test-core`, which builds the workspace and
runs its unit and integration tests without a network, a gateway, or Docker,
using temporary state roots and stub executables.

#### Scenario: Core tests run offline
- **WHEN** `make test-core` runs on a host with no gateway and no Docker
- **THEN** the suite passes and no test attempts a network call

#### Scenario: Format goldens are part of the suite
- **WHEN** the flat TOML writer or the JSON serializer changes its output
- **THEN** the golden-comparison tests fail and name the differing line
