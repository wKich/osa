## ADDED Requirements

### Requirement: `list` reports sandboxes the helper renders itself

`maki-oss list`, and the equivalent command on the other three front-ends, SHALL
report every sandbox the gateway reports, naming each sandbox and its phase. The
helper SHALL produce that output from the gateway's typed listing and SHALL NOT
delegate rendering to the OpenShell CLI, so the command performs no
`openshell sandbox list` invocation.

For a gateway state the CLI could display, the output SHALL match what the
OpenShell CLI printed for the same state.

The command SHALL remain free of any other behavior change: it SHALL still exit
0 when the gateway reports nothing, and SHALL not list, filter, or reorder
sandboxes beyond what the CLI did.

#### Scenario: Every sandbox is listed with its phase
- **WHEN** the gateway reports two sandboxes, one ready and one stopped
- **THEN** the command exits 0 and its output names both, each with its phase

#### Scenario: No sandbox-listing CLI invocation
- **WHEN** `list` runs against a gateway reachable through the typed client
- **THEN** no `openshell sandbox list` process is started

#### Scenario: Output matches what the CLI printed
- **WHEN** the same gateway state is listed once through the OpenShell CLI and once through the helper
- **THEN** the two outputs are identical

#### Scenario: An empty gateway lists nothing
- **WHEN** the gateway reports no sandboxes
- **THEN** the command exits 0 and prints no sandbox row

#### Scenario: Every front-end profile lists identically
- **WHEN** the same gateway state is listed through `maki-oss`, `opencode-oss`, `claude-oss`, and `codex-oss`
- **THEN** all four outputs are identical

### Requirement: A gateway that requires a client certificate is reachable

When the gateway requires mutual TLS, the helper SHALL connect through the typed
client using the client certificate, its key, and the certificate authority read
from the directory named by `--tls-dir`, `MAKI_OSS_TLS_DIR`, or the config key
`tls_dir`. The three files SHALL be `ca.crt`, `tls.crt`, and `tls.key`.

The helper SHALL fail before contacting the gateway when a required file cannot
be read, and the message SHALL name the file and the directory.

When no certificate is supplied and the gateway rejects the anonymous
connection, the failure SHALL name `--tls-dir` as one of the fixes, because the
gateway's own discovery output does not report its authentication mode.

The helper SHALL NOT disable certificate verification on any path, and the key
material SHALL NOT appear in output, in an argument, or in any recorded
invocation.

#### Scenario: A client certificate makes the gateway reachable
- **WHEN** the gateway requires a client certificate and `--tls-dir` names a directory holding all three files
- **THEN** the command completes against that gateway and lists the same state the OpenShell CLI lists

#### Scenario: A missing file is named before anything is contacted
- **WHEN** `--tls-dir` names a directory without `tls.key`
- **THEN** the command exits non-zero without contacting the gateway, naming `tls.key` and the directory

#### Scenario: The failure names the flag that fixes it
- **WHEN** no certificate is supplied and the gateway rejects the anonymous connection
- **THEN** the failure names `--tls-dir` among the fixes rather than reporting only an unreachable endpoint

#### Scenario: An untrusted certificate is not accepted
- **WHEN** the gateway presents a certificate that does not chain to the supplied certificate authority
- **THEN** the command fails instead of proceeding
