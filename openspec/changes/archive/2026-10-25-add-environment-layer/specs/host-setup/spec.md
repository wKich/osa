# Spec Delta

## MODIFIED Requirements

### Requirement: Daily-driver loop separated from one-time setup

The playbook SHALL separate the one-time machine setup (`maki-oss doctor`,
`maki-oss image build` for the base image, an optional environment-store build,
`maki-oss provider setup`, and setting `image` when a derived image is used)
from the per-project everyday loop (`cd <project> && maki-oss`,
`maki-oss run "<prompt>"`, `maki-oss status`, cleanup), and SHALL state the
observable outcome of the bare `maki-oss` command.

#### Scenario: One-time vs per-project separation

- **WHEN** a maintainer reads the daily-driver section
- **THEN** the commands that run once per machine are listed separately from
  the commands that run in every project, and no one-time command is presented
  as part of the per-project loop

#### Scenario: Base and environment builds are separate

- **WHEN** a maintainer reads the one-time section
- **THEN** the base image build and any environment-store build are separate
  steps, and the derived image is selected through the `image` setting

#### Scenario: Bare command outcome stated

- **WHEN** an agent reads what `maki-oss` does with no arguments
- **THEN** the playbook states that it creates or reuses the project sandbox,
  uploads the project on first creation, attaches remembered providers,
  launches Maki, and syncs changes back on exit

### Requirement: Discoverable from the files agents read first

The README SHALL link `docs/ai/host-playbook.md` and
`docs/ai/environment-playbook.md` in its Guides list, and `AGENTS.md` SHALL
point to both in its start-here list, so an agent that reads only the
repository's instruction file reaches the setup and environment recipes without
searching.

#### Scenario: README link

- **WHEN** the README Guides list is read
- **THEN** it contains working links to `docs/ai/host-playbook.md` and
  `docs/ai/environment-playbook.md`

#### Scenario: Instruction-file pointer

- **WHEN** `AGENTS.md` is read by a coding agent
- **THEN** it names `docs/ai/host-playbook.md` for host setup and
  `docs/ai/environment-playbook.md` for composing a personal environment
