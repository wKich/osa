## ADDED Requirements

### Requirement: The example policies keep OpenShell's filesystem floor
Every policy under `examples/policies/` SHALL grant read-write access to
`/sandbox`, `/tmp`, and `/dev/null` and read-only access to system paths,
and SHALL NOT grant any other writable path. `/dev/null` SHALL be listed
explicitly so a sandbox created without a provider, whose effective policy
gets no baseline paths, can still spawn processes with a null stdin.

#### Scenario: A provider-less sandbox runs a shell command
- **WHEN** a sandbox is created from `examples/policies/maki-minimal.yaml`
  with no `--provider`, and Maki runs `rm -f probe.txt` through its bash tool
- **THEN** the command runs and Maki reports its result instead of
  `Permission denied (os error 13)`
