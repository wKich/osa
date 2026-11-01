## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Parity with the shell implementation before removal

**Reason**: The transitional requirement existed only while both implementations
existed. The shell `osa` command is removed when that change completes, so the
requirement no longer has an observable subject.

**Migration**: The durable parity guarantee moves to `gateway-client`'s
operation mapping and to `helper-conformance`'s semantic-equivalence verdict, so
a later transport change is still checked against recorded behavior instead of
against a second implementation of the same command.
