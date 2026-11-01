## ADDED Requirements

### Requirement: Core build step with its own verification

The shared host playbook SHALL, after the OpenShell step and before shell
preparation, install or verify the pinned Rust toolchain from
`rust-toolchain.toml`, build the core with `make build`, and verify the result
by running `osa --help` and confirming it exits 0 with the documented
subcommand list.

The step SHALL state that a missing binary makes `osa` fail with a message
naming the build command, so a host that skips the step cannot mistake the shim
for a working installation.

#### Scenario: Build verification
- **WHEN** the agent runs the core build step's verification
- **THEN** `osa --help` exits 0 and lists the subcommands the `osa` reference documents

#### Scenario: Skipped build is diagnosed, not silent
- **WHEN** the build step is skipped and `osa projects` runs
- **THEN** the command exits non-zero and its message names `make build`

#### Scenario: Toolchain version is pinned in one place
- **WHEN** the toolchain version in `rust-toolchain.toml` is compared with the version the playbook states
- **THEN** they match
