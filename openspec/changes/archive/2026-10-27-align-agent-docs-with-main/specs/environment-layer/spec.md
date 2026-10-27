# Spec Delta

## ADDED Requirements

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
