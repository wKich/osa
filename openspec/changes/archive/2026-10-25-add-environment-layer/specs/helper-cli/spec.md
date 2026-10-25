# Spec Delta

## MODIFIED Requirements

### Requirement: MCP readiness command
`maki-oss mcp status` SHALL compare the servers enabled in the host's
`~/.config/maki/mcp.toml` against the servers present in the project sandbox's
MCP config, and SHALL report one line per server naming each gate that decides
whether the server works in the sandbox. For an HTTP server those gates are:
present in the sandbox config, provider attached to the project sandbox,
endpoint present in the effective policy, and transport supported. For a stdio server they are: present in the sandbox
config, the command named by its
`command` array present in the sandbox (the runtime gate), and provider
attached — the endpoint gate is carried by the attached profile, because a
stdio server's config names no URL. A server enabled on the host but absent
from the sandbox SHALL be reported by name as missing from the sandbox,
together with the environment-image build guidance and the environment
playbook. It SHALL exit non-zero when any server fails a gate, and SHALL print
the command or guidance that fixes each failing gate — for a missing runtime,
the environment-image build guidance, not a base-image rebuild. When no sandbox
exists for the project, or neither the host config nor the sandbox config
declares an enabled server, it SHALL report that and exit zero. It SHALL NOT
mutate the sandbox, gateway, profiles, or policy, and MUST NOT print any
credential value.

#### Scenario: All gates satisfied exits zero
- **WHEN** a server's gates for its transport all hold and the user runs `maki-oss mcp status`
- **THEN** the output names the server with every gate satisfied and the command exits 0

#### Scenario: A failing gate names its fix
- **WHEN** a server's provider is not attached and the user runs `maki-oss mcp status`
- **THEN** the output names the attachment as the failing gate, prints the `maki-oss provider attach` command, and the command exits non-zero

#### Scenario: A stdio server missing its runtime names the image-build fix
- **WHEN** a stdio server is present in both configs but its command is absent from the sandbox, and the user runs `maki-oss mcp status`
- **THEN** the output names the runtime gate as failing with the missing command and the environment-image build guidance as the fix, the command exits non-zero, and no install or image change is attempted

#### Scenario: A host server missing from the sandbox is named
- **WHEN** the host's `~/.config/maki/mcp.toml` enables a server that the sandbox's MCP config does not contain, and the user runs `maki-oss mcp status`
- **THEN** that server is reported by name as missing from the sandbox with the environment-image build guidance, and the command exits non-zero

#### Scenario: A zero-MCP base points at the environment layer
- **WHEN** the sandbox is built from the base image and the host enables a server the base does not declare
- **THEN** the output names the server as missing and directs the user to the environment image and playbook rather than `maki-oss image build`

#### Scenario: No sandbox reports cleanly
- **WHEN** the user runs `maki-oss mcp status` with no project sandbox
- **THEN** the command reports no sandbox and exits 0 without attempting sandbox operations

#### Scenario: Report performs no mutation
- **WHEN** `maki-oss mcp status` runs against a `Ready` sandbox
- **THEN** no `sandbox create`, `provider attach`, `profile import`, or policy update invocation is recorded, and no credential value appears in the output
