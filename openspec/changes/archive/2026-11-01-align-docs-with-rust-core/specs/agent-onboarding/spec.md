# Spec Delta

## MODIFIED Requirements

### Requirement: First-run documentation is executable

A page that claims to start from a clean host SHALL state its starting point
and SHALL include the repository clone, the pinned Rust toolchain and
`make build`, and the `bin/` `PATH` step, or explicitly state that it starts
after README Install and link there. It MUST NOT use a helper before explaining
how the helper is resolved, including the build that produces the binary behind
its shim. First-run command blocks SHALL order `make build` before the first
helper command, and `image build` before any diagnostic that requires the built
image, including `doctor`. A page that shows `mcp status` SHALL place it after
the sandbox-creation step.

#### Scenario: README builds the core before the helper

- **WHEN** a reader follows the README's install commands from a clean host
- **THEN** `make build` runs before the first `bin/<front-end>` command

#### Scenario: README builds before doctor

- **WHEN** a reader follows the README's install commands from a clean host
- **THEN** `image build` runs before `doctor`, and `doctor` is described as verifying the built image and host rather than as a prerequisite check

#### Scenario: Helper install and cookbook build before doctor

- **WHEN** a reader follows `docs/helper.md`'s Install or Cookbook block
- **THEN** `image build` runs before `doctor`

#### Scenario: Maki daily driver builds before doctor

- **WHEN** a reader follows the Maki playbook's one-time setup list
- **THEN** the base image build is listed before `doctor`

#### Scenario: Clean-host page states its starting point

- **WHEN** a page says it starts from a clean machine and uses a helper command
- **THEN** the page includes the clone, the toolchain and `make build`, and the `bin/` `PATH` step, or states that it starts after README Install and links there

#### Scenario: Unbuilt shim is not helper readiness

- **WHEN** a clean-host page resolves a front-end command but the binary behind its shim was never built
- **THEN** the page states that the command fails with a message naming `make build` and the reader runs the build before continuing

#### Scenario: mcp status follows sandbox creation

- **WHEN** a page shows `mcp status`
- **THEN** the sandbox-creation step appears earlier on the page
