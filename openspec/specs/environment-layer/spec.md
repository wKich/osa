# environment-layer Specification

## Purpose

Defines the boundary between each agent's generic base image and a user-owned
environment layer, so a person can compose their own MCP servers, packages,
skills, and agent preferences without editing or forking the product. The
repository ships the Maki reference store and states the concrete Maki base and
store requirements as the worked example; the environment playbook generalizes
the procedure through a four-agent adapter table for Maki, OpenCode, Claude
Code, and Codex.

## Requirements

### Requirement: Base image contains no personal environment

The base image SHALL contain the agent runtime and the security baseline
only: the pinned Maki binary, the non-root sandbox identity, the
filesystem/Landlock policy settings, folder trust, YOLO mode, and the deny
rules that protect the baked configuration. It MUST NOT contain any MCP
server definition, any MCP-specific runtime or package, or any personal UI
preference. It MAY contain an MCP configuration file that declares zero
servers. YOLO belongs to the base because OpenShell, not Maki, is the
permission boundary; explicit deny rules still apply.

#### Scenario: Base has no MCP servers
- **WHEN** the base image is built and its MCP configuration is inspected
- **THEN** it declares zero enabled or disabled `[mcp.*]` servers

#### Scenario: Base has no MCP-specific package or runtime
- **WHEN** the base image's Dockerfile and built filesystem are inspected
- **THEN** they contain no `synthetic-search-mcp` package and no Bun runtime installed solely for MCP use

#### Scenario: Base keeps the safety baseline
- **WHEN** the base image is built
- **THEN** it runs as uid/gid 1500, keeps the minimal filesystem policy, pre-answers folder trust for `/sandbox`, starts sessions in YOLO mode, and keeps the deny rules that block `sudo`, `su`, `maki auth`, `ssh`, `scp`, and writes to `/sandbox/.config`

#### Scenario: Base starts sessions in YOLO mode
- **WHEN** the base image's Maki `init.lua` is inspected
- **THEN** it sets `always_yolo = true` and does not set compact-UI preferences; UI preferences belong to the environment layer

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

### Requirement: Global, project-local, and credential state have separate homes

The environment layer SHALL carry only global environment content.
Project-local agent configuration SHALL continue to travel with the uploaded
project. Credentials and egress SHALL remain in OpenShell provider profiles. A
project-local server whose runtime or package is absent from the environment
image SHALL fail the runtime gate rather than trigger an install.

#### Scenario: Project-local config does not rebuild the image
- **WHEN** a project carries `.maki/` or `.opencode/` configuration
- **THEN** it travels with the project upload and does not require an environment image rebuild unless it needs a package or runtime the image lacks

#### Scenario: Credentials never enter either state
- **WHEN** a global or project-local MCP server needs a credential
- **THEN** its config references a provider-injected `${VAR}` and the value remains in the OpenShell provider

#### Scenario: Missing project package is reported
- **WHEN** a project-local stdio server names a command absent from the environment image
- **THEN** `maki-oss mcp status` or the environment recipe reports the runtime gate as failing instead of installing the package

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

### Requirement: Base image checks use the shared osa image commands

The environment playbook SHALL use `osa images` to report each agent's base
image tag, engine, presence, and configured image, and `osa image build TAG` to
build a base image. It SHALL state that the dashboard's Images section builds
base images only, and that building a user environment store remains a terminal
Docker build. It MUST NOT claim that a dashboard build selects, builds, or
verifies the derived image.

#### Scenario: Base image check uses osa images

- **WHEN** a reader checks the base image before building a store
- **THEN** the playbook has them run `osa images` and compare the base tag,
  presence, and configured image for their agent

#### Scenario: Base build uses osa image build

- **WHEN** the base image is missing or stale
- **THEN** the playbook sends the reader to `osa image build TAG` for that
  agent, which builds the base image and no store

#### Scenario: Store build stays in the terminal

- **WHEN** a reader wants to build the environment store
- **THEN** the playbook keeps the Docker build in the terminal and does not
  send it to the dashboard

#### Scenario: Dashboard build scope is stated

- **WHEN** a reader opens the dashboard's Images section from the environment
  playbook
- **THEN** the page states that it builds base images only and that selecting
  or verifying a derived image stays a helper and terminal step
