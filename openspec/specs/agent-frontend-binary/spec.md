# agent-frontend-binary Specification

## Purpose

Defines the four agent front-end commands — `maki-oss`, `opencode-oss`,
`claude-oss`, and `codex-oss` — as one shared binary implementation distinguished
only by an agent profile, so their behavior, streaming, settings, isolation, and
state contracts stay identical across agents.

## Requirements

### Requirement: Four command names, one implementation

The repository SHALL provide `maki-oss`, `opencode-oss`, `claude-oss`, and
`codex-oss` as binaries built from one shared implementation in `osa-core`,
differing only by an agent profile that names the environment-variable prefix,
the config file path, the agent command, the base image, and the config keys the
front-end owns.

A front-end SHALL NOT contain command logic of its own, and no front-end
behavior SHALL be implemented in a POSIX shell script. Each `bin/<name>` SHALL be
a shim that `exec`s the built binary and fails with a message naming the build
command when the binary is absent.

#### Scenario: Each command serves its own profile
- **WHEN** `maki-oss` and `opencode-oss` each resolve their config file and environment prefix
- **THEN** each uses the values its profile names, and neither reads the other's config file

#### Scenario: A missing binary fails with an actionable message
- **WHEN** a front-end shim runs in a checkout that has never been built
- **THEN** it exits non-zero with a message naming the build command and performs no gateway call and no state write

#### Scenario: No command logic remains in the shell
- **WHEN** `bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`, and `bin/codex-oss` are inspected
- **THEN** each resolves and execs a binary without implementing a subcommand

### Requirement: The front-end suite passes unchanged

The existing front-end test suite SHALL pass against the built binaries with no
change to a case body beyond selecting the backend. A case SHALL NOT be deleted,
weakened, or excluded to accommodate the port; an exclusion SHALL carry a
written reason and is only permitted for a case that asserts the shell
implementation itself.

#### Scenario: The suite is green against the binaries
- **WHEN** the suite runs with the backend set to the four built binaries
- **THEN** every case passes and the failure count is zero

#### Scenario: An exclusion is justified and visible
- **WHEN** a case cannot apply to any non-shell implementation
- **THEN** it is listed with its reason, and the suite reports the exclusion count

### Requirement: The detached idle watcher keeps its shape

The helper SHALL re-invoke itself as a detached child with the argument sequence
`__idle-watch NAME PID SECS`, with no controlling terminal, standard streams
closed, and a lifetime independent of the launching session. The command line
SHALL contain the helper's own name followed by `__idle-watch`, so a cleanup that
matches on that pattern still finds it.

The watcher SHALL stop the sandbox only when the session is idle for the
configured period and no session lock is live, and SHALL exit without changing
state when the configured period is zero or the session already ended.

#### Scenario: The watcher outlives the session
- **WHEN** a session ends and the idle period has not elapsed
- **THEN** the watcher process still exists and its command line contains the helper name and `__idle-watch`

#### Scenario: Cleanup by pattern still works
- **WHEN** a cleanup runs a pattern match on the helper name and `__idle-watch`
- **THEN** the watcher processes are found and terminated

#### Scenario: A busy sandbox is not stopped
- **WHEN** another session holds the lock when the idle period elapses
- **THEN** the sandbox is left running and the watcher exits without a state change

### Requirement: Streaming output and exit status are unchanged

For a headless run, the helper SHALL write the agent's standard output to its
own standard output unchanged and as it arrives, keep the agent's standard error
on standard error, add no bytes to standard output, and exit with the agent's
exit code.

#### Scenario: Output is not buffered or decorated
- **WHEN** a headless run's agent emits a line and waits
- **THEN** the line is on the helper's standard output before the agent finishes, and no additional text is written there

#### Scenario: The agent's exit code is the helper's
- **WHEN** the agent exits with a non-zero code
- **THEN** the helper exits with that code

### Requirement: Prompts behave the same on and off a terminal

An interactive prompt SHALL read from the terminal. A hidden-value prompt SHALL
disable terminal echo while reading and restore it before continuing, including
when the read is interrupted. When standard input is not a terminal and an
explicit confirmation flag is absent, the command SHALL exit non-zero without
performing the destructive action or the gateway mutation.

#### Scenario: Hidden input does not echo
- **WHEN** a credential prompt reads from a terminal
- **THEN** the typed characters are not echoed and the terminal echo state is restored afterwards

#### Scenario: Interrupted hidden input restores the terminal
- **WHEN** the hidden read is interrupted
- **THEN** echo is restored and the command exits non-zero

#### Scenario: Non-interactive confirmation refuses
- **WHEN** a destructive command runs with standard input redirected and no confirmation flag
- **THEN** it exits non-zero, deletes nothing, and mutates no gateway state

### Requirement: Signals run cleanup before exit

On interrupt or termination, the helper SHALL run the same cleanup the current
implementation runs — removing its temporary files and directories, releasing
its lock, and leaving the sandbox and workspace in the documented state — and
SHALL exit with a non-zero status. No temporary file, lock file, or watcher
process SHALL be left behind.

#### Scenario: Interrupt leaves no debris
- **WHEN** a session or resolve is interrupted
- **THEN** no temporary file or directory remains, the lock is gone, and the exit status is non-zero

#### Scenario: An interrupted patch collection parks the workspace
- **WHEN** patch collection is interrupted before a durable patch exists
- **THEN** the workspace is parked, nothing is written to the project, and the sandbox-side changes remain

### Requirement: Settings precedence and per-agent prefixes are unchanged

Every setting SHALL resolve with the documented order — command-line flag, then
the front-end's environment variable, then the config file, then the default —
and each front-end SHALL keep its documented environment prefix, config path,
and owned config keys.

#### Scenario: Flag beats environment beats config
- **WHEN** a setting is provided by a flag, an environment variable, and the config file at once
- **THEN** the flag value is used, and with the flag absent the environment value is used, and with both absent the config value is used

#### Scenario: An unknown config key is refused
- **WHEN** the config file carries a key the front-end does not own
- **THEN** the command exits non-zero naming the key

### Requirement: The isolation invariants gain no new channel

The front-end binaries SHALL NOT introduce a host bind mount, a host directory
mounted into the sandbox, a credential passed outside the child process
environment, an in-sandbox agent login, or a widened egress rule. Files SHALL
continue to move through the gateway's upload and download operations.

#### Scenario: No mount is created
- **WHEN** any front-end command runs
- **THEN** its recorded gateway requests and invocations contain no mount of a host path

#### Scenario: No credential is written or logged
- **WHEN** a credentialed command runs with a fixture credential
- **THEN** the conformance leak case finds no fixture value in any invocation, request, state file, or output

### Requirement: Patch collection preserves fidelity

A collected patch SHALL carry additions, modifications, deletions, renames, and
binary changes made inside the sandbox workspace, and SHALL NOT carry files that
were only changed on the host or that the upload excluded.

#### Scenario: A rename is collected as a rename
- **WHEN** a session renames a file inside the sandbox and the session ends cleanly
- **THEN** the collected patch records a rename rather than a delete plus an add

#### Scenario: A host-only change is not carried
- **WHEN** the host changes a file that the upload excluded
- **THEN** the collected patch does not contain that change

### Requirement: One implementation of the state contract

After this change the registry, pending markers, and locks SHALL be written by
the shared core implementation only. No second implementation SHALL remain in
the repository.

#### Scenario: The shell state layer is gone
- **WHEN** the repository is searched for the shell state and helper libraries
- **THEN** neither file exists, and every reference to them is removed

#### Scenario: On-disk state is unchanged
- **WHEN** a front-end binary creates a registry entry after the port
- **THEN** the entry is byte-identical to the golden recorded for that case
