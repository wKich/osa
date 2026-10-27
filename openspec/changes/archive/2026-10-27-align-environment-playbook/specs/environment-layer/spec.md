# Spec Delta

## MODIFIED Requirements

### Requirement: Environment store is a user-owned Docker build context

A user's environment store SHALL be a Docker build context owned and stored
outside this repository; the repository ships the Maki reference store
described below. Its Dockerfile SHALL build `FROM` the base image of the agent
selected in the environment playbook's adapter table; its build context SHALL
carry that agent's MCP configuration, skills, plugins, and package or runtime
installs where the sandbox agent supports them. It MUST NOT contain credential
values. The selected agent's base image MUST NOT be modified to carry the
environment.

#### Scenario: Store builds from the base

- **WHEN** the user builds an environment store with the configured container
  engine
- **THEN** the build succeeds from that agent's base image and the resulting
  image reports the same agent version as that base; for the Maki reference
  store, the same Maki version as `maki-agent:local`

#### Scenario: Store carries no credential value

- **WHEN** the store's files are inspected
- **THEN** they contain no API key, token, or OAuth secret; credentials appear
  only as `${VAR}` names that provider profiles resolve

#### Scenario: Base is not edited for a personal choice

- **WHEN** a user wants a different MCP server, package, or UI preference
- **THEN** the change is made in the user's store, not in the selected agent's
  base image build context (for Maki, `examples/maki-image/`)

### Requirement: Repository ships a reference store, not a default environment

The repository SHALL include the Maki reference environment store under
`examples/environments/reference/` that demonstrates the pattern: a Dockerfile,
an MCP configuration, an agent preference file, a `.dockerignore`, and a
README. The store's README and the environment playbook SHALL identify it as
the Maki worked example, not as a prerequisite or default store for OpenCode,
Claude Code, or Codex. The default configuration SHALL NOT select it; the
default image SHALL remain each agent's base image. The reference store SHALL
be opt-in.

#### Scenario: Default config selects the base

- **WHEN** `examples/config.toml` is read
- **THEN** it selects the base image and no provider, and the reference store is
  not referenced by default

#### Scenario: Reference store demonstrates the relocated behavior

- **WHEN** the reference store is built and selected
- **THEN** it provides the MCP servers, MCP runtime, and personal UI preferences
  that the base does not contain

#### Scenario: Other agents are not required to use the Maki store

- **WHEN** a reader follows the playbook for OpenCode, Claude Code, or Codex
- **THEN** the playbook uses that agent's adapter row and its reference or
  current page and does not require `examples/environments/reference/`

#### Scenario: Reference store is not built by the base command

- **WHEN** `maki-oss image build` runs with no environment argument
- **THEN** it builds the base image and does not build or inspect the reference
  store

### Requirement: The environment boundary is documented for any host agent

The repository SHALL provide `docs/ai/environment-playbook.md` as an ordered,
agent-agnostic procedure: audit the host's agent configuration, classify each
item as portable config, package or runtime, credential, project-local, or
unsupported, generate the store, build and select it, verify the boundary, and
report. The procedure SHALL include a per-agent adapter table with one row for
Maki, OpenCode, Claude Code, and Codex and columns for the base image, helper
config path, store config directory, image setting, provider setup, MCP config,
skills and plugins, and agent-specific limitations. It SHALL use
`examples/environments/reference/` as the Maki worked example and SHALL NOT
require Maki, or any other single agent, as a prerequisite. It SHALL include a
paste-able prompt that accepts each supported agent and forbids cross-agent
translation. It SHALL state that credentials are never copied into the store
and that MCP endpoints and credentials still require provider profiles.
Agent-specific store details SHALL link the agent's reference page, or the
current page while a front-end is still being aligned, instead of being
duplicated as a second procedure.

#### Scenario: Any host agent can follow the procedure

- **WHEN** a host coding agent reads the playbook for Maki, OpenCode, Claude
  Code, or Codex
- **THEN** each stage names the agent-specific command from the adapter table or
  links that agent's reference page or, while a front-end is still being
  aligned, its current page, together with the expected output and the
  stop-and-report rule, without naming one agent vendor as a prerequisite

#### Scenario: Adapter table is complete

- **WHEN** a reader inspects the per-agent adapter table
- **THEN** it has one row for each of Maki, OpenCode, Claude Code, and Codex and
  names that agent's base image, helper config path, store config directory,
  image setting, provider setup, MCP config, skills and plugins, and
  limitations

#### Scenario: Maki reference store is the worked example

- **WHEN** a reader follows the Maki adapter row
- **THEN** the playbook points at `examples/environments/reference/` and states
  that the other rows do not require it

#### Scenario: Credentials are classified out of the store

- **WHEN** the playbook encounters an API key or token in a host config
- **THEN** it directs the user to a provider profile and never writes the value
  into the store

#### Scenario: Unsupported items are reported

- **WHEN** a host config contains a plugin or command format the sandbox agent
  cannot load
- **THEN** the playbook reports it by name as unsupported rather than silently
  dropping it

#### Scenario: Paste-able prompt stays same-agent

- **WHEN** the paste-able prompt is copied for Maki, OpenCode, Claude Code, or
  Codex
- **THEN** it names the chosen agent, uses that agent's adapter row, and forbids
  translating configuration to another agent

### Requirement: Derived image uses the existing image setting

Each front-end helper SHALL select a user-built environment image through its
existing `image` configuration setting and the matching per-agent environment
variable; no new store-specific command is required. Each front-end's `image
build` SHALL continue to build its own base image, and its `doctor` SHALL treat
the configured image as the image to verify.

#### Scenario: User selects a derived image

- **WHEN** the user builds a store and sets the chosen helper's `image` setting
  to its tag
- **THEN** that helper's `status` reports the tag as the configured image and a
  new sandbox is created from it; for `maki-oss`, `maki-oss status` reports
  `maki-agent:my-environment`

#### Scenario: Base build is unchanged

- **WHEN** the user runs a front-end's `image build`
- **THEN** it builds that front-end's base image with the configured engine and
  does not inspect or build a user store; for `maki-oss`, `maki-oss image build`
  still builds `maki-agent:local`
