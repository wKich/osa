# environment-layer Specification

## Purpose

Defines the boundary between the generic maki-oss base image and a user-owned environment layer, so a person can compose their own MCP servers, packages, skills, and agent preferences without editing or forking the product.

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
outside this repository; the repository MAY ship the reference store described
below. Its Dockerfile SHALL build `FROM` the base image; its build context
SHALL carry the user's MCP configuration, skills, plugins, and package or
runtime installs where the sandbox agent supports them. It MUST NOT contain
credential values. The base image MUST NOT be modified to carry the
environment.

#### Scenario: Store builds from the base
- **WHEN** the user builds the reference environment store with the configured container engine
- **THEN** the build succeeds from the base image and the resulting image reports the same Maki version as the base

#### Scenario: Store carries no credential value
- **WHEN** the store's files are inspected
- **THEN** they contain no API key, token, or OAuth secret; credentials appear only as `${VAR}` names that provider profiles resolve

#### Scenario: Base is not edited for a personal choice
- **WHEN** a user wants a different MCP server, package, or UI preference
- **THEN** the change is made in the user's store, not in `examples/maki-image/`

### Requirement: Repository ships a reference store, not a default environment

The repository SHALL include a reference environment store under
`examples/environments/reference/` that demonstrates the pattern: a
Dockerfile, an MCP configuration, an agent preference file, a `.dockerignore`,
and a README. The default configuration SHALL NOT select it; the default image
SHALL remain the base image. The reference store SHALL be opt-in.

#### Scenario: Default config selects the base
- **WHEN** `examples/config.toml` is read
- **THEN** it selects the base image and no provider, and the reference store is not referenced by default

#### Scenario: Reference store demonstrates the relocated behavior
- **WHEN** the reference store is built and selected
- **THEN** it provides the MCP servers, MCP runtime, and personal UI preferences that the base does not contain

#### Scenario: Reference store is not built by the base command
- **WHEN** `maki-oss image build` runs with no environment argument
- **THEN** it builds the base image and does not build or inspect the reference store

### Requirement: The environment boundary is documented for any host agent

The repository SHALL provide `docs/ai/environment-playbook.md` as an ordered,
agent-agnostic procedure: audit the host's agent configuration, classify each
item as portable config, package or runtime, credential, or unsupported,
generate the store, build it, and verify it. The procedure SHALL NOT require a
specific host agent and SHALL include a paste-able prompt. It SHALL state that
credentials are never copied into the store and that MCP endpoints and
credentials still require provider profiles.

#### Scenario: Any host agent can follow the procedure
- **WHEN** a host coding agent reads the playbook
- **THEN** the steps name commands, expected outputs, and the stop-and-report rule without naming one agent vendor as a prerequisite

#### Scenario: Credentials are classified out of the store
- **WHEN** the playbook encounters an API key or token in a host config
- **THEN** it directs the user to a provider profile and never writes the value into the store

#### Scenario: Unsupported items are reported
- **WHEN** a host config contains a plugin or command format the sandbox agent cannot load
- **THEN** the playbook reports it by name as unsupported rather than silently dropping it

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

The helper SHALL select a user-built environment image through its existing
`image` configuration setting; no new store-specific command is required for
this change. `maki-oss image build` SHALL continue to build the base image,
and `maki-oss doctor` SHALL treat the configured image as the image to verify.

#### Scenario: User selects a derived image
- **WHEN** the user builds a store and sets `image` to its tag
- **THEN** `maki-oss status` reports that tag as the configured image and a new sandbox is created from it

#### Scenario: Base build is unchanged
- **WHEN** the user runs `maki-oss image build`
- **THEN** it builds the base image with the configured engine and does not inspect or build a user store
