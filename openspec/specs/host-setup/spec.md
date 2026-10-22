# host-setup Specification

## Purpose

Guarantees that a coding agent starting from a bare macOS or Linux host can
provision the container engine, OpenShell, Maki, and the user's shell from
this repository's documentation alone, with a verification gate after every
step, a clear boundary between host setup and sandbox work, and discovery of
the playbook from the files agents read first.

## Requirements

### Requirement: Ordered host playbook with a verification gate per step

The repository SHALL provide `docs/ai/host-playbook.md` as an ordered,
agent-executable sequence from a bare host to a working `maki-oss`, where
every step states the command to run, the expected output, and a rule to stop
and report on mismatch rather than continue.

#### Scenario: Every step is checkable

- **WHEN** a maintainer reads any step of `docs/ai/host-playbook.md`
- **THEN** that step names at least one verification command together with
  the output that counts as success, and the playbook states that a failed
  check stops the run

#### Scenario: Fresh host ordering

- **WHEN** an agent follows the playbook on a machine where Docker,
  `openshell`, and `maki` are all absent
- **THEN** the steps run in dependency order — tooling, then repository and
  helper setup, then shell preparation, then the daily-driver loop — and no
  step assumes a tool the preceding steps have not installed and verified

### Requirement: Host preconditions are stated before the install steps

The playbook SHALL state, before the container-engine install step, every
precondition a bare host must supply that no earlier playbook step installs —
Homebrew on macOS, and container-engine access for a non-root user on Linux
(docker group membership or a rootless engine) — and SHALL give a command
that checks each precondition, so a missing precondition is reported as such
instead of surfacing as a confusing failure from a later verification.

#### Scenario: macOS engine step names Homebrew

- **WHEN** an agent reaches the macOS engine step on a host without `brew`
- **THEN** the playbook has already named Homebrew as a precondition with its
  check, so the missing `brew` is reported as an unmet precondition rather
  than an improvised install or a mid-phase stop

#### Scenario: Linux engine step names engine access

- **WHEN** an agent reaches the Linux engine step on a host where the
  non-root user cannot run containers
- **THEN** the playbook has already stated docker group membership (with the
  re-login it requires) or a rootless engine as a precondition with its check,
  so the later `maki-oss doctor` engine failure is not misread as an engine
  that is "installed but not running"

### Requirement: Host tooling installation and verification

The playbook SHALL install and verify the container engine (Docker Engine 28+
or a documented equivalent), the OpenShell CLI with a running gateway, and the
Maki CLI, using the upstream installers, and SHALL record the required
post-install gateway recovery step for a `Disconnected` status.

#### Scenario: Engine verification

- **WHEN** the agent runs the engine step's verification
- **THEN** the command reports version `28.0` or later (for example
  `docker version --format '{{.Server.Version}}'`)

#### Scenario: Gateway verification and recovery

- **WHEN** `openshell status` does not report `Connected`
- **THEN** the playbook directs the agent to restart the gateway service
  (`brew services restart openshell` on macOS,
  `systemctl --user restart openshell-gateway` on Linux) and re-verify before
  proceeding, instead of continuing to the next step

#### Scenario: Maki CLI verification

- **WHEN** the agent runs the Maki step's verification
- **THEN** `maki --version` prints the version pinned by
  `examples/maki-image/Dockerfile`

### Requirement: Provider step states its inputs and scopes the login restriction

The playbook SHALL state the input the provider wizard requires — a model API
key, exported in the environment or already present in a Maki or OpenCode
credential store — before running it, SHALL name the non-interactive forms
documented in `docs/providers.md` (`--from STORE --credential SLUG --yes`,
`--env VAR`, `--file PATH`), and SHALL scope any restriction on `maki auth
login` to the sandbox, matching `AGENTS.md`, so host-side credential stores
remain a legitimate wizard source.

#### Scenario: Required input is stated on a bare host

- **WHEN** an agent reads the provider step on a host whose Maki and
  OpenCode credential stores are empty
- **THEN** the playbook has already stated that a model API key is required
  input and where it comes from, instead of describing a scan that finds
  nothing

#### Scenario: Non-interactive forms are named

- **WHEN** the provider step runs without a terminal
- **THEN** the playbook names the non-interactive flags rather than leaving
  the agent to infer them from a usage error

#### Scenario: Login restriction is sandbox-scoped

- **WHEN** an agent reads the playbook's `maki auth login` restriction
- **THEN** it applies to the sandbox only, so host-side credential stores are
  still offered as a wizard source

### Requirement: Shell preparation with one verified path per shell

The playbook SHALL cover shell preparation for both zsh and fish, choosing
exactly one primary path per shell (repository `bin/` on `PATH`, or the fish
plugin through fisher, or `maki-oss fish install`), and SHALL document
`MAKI_OSS_BIN` as the fallback when the repository location must be
discovered explicitly. Every documented path SHALL be runnable on the bare
host the playbook targets: a fish path that depends on a plugin manager
SHALL be presented only as an alternative, the primary fish path SHALL be
runnable from the repository root before anything is on `PATH` or in the
fish function directory, and each shell's verification commands SHALL be
labeled so they run only in that shell.

#### Scenario: Primary path resolves the command

- **WHEN** an agent completes the zsh section and runs `command -v maki-oss`,
  or completes the fish section and runs `type -q maki-oss`
- **THEN** the command resolves to this repository's `bin/maki-oss`

#### Scenario: Fallback is documented

- **WHEN** neither `PATH` entry nor the fish function can locate the helper
- **THEN** the playbook states that setting `MAKI_OSS_BIN` to the absolute
  path of `bin/maki-oss` makes the wrapper resolve it

#### Scenario: Fish path runs before the helper is resolvable

- **WHEN** an agent with no fisher, no `maki-oss` on `PATH`, and no installed
  fish function follows the fish section from the repository root
- **THEN** the documented primary fish command runs from the repository's
  files (for example `./bin/maki-oss fish install`) and succeeds without a
  prior shell-preparation step

#### Scenario: Per-shell verification stays in its shell

- **WHEN** an agent runs the verification block for a POSIX shell
- **THEN** no fish-only command (such as `type -q` or a check of
  `~/.config/fish/…`) appears in the commands it is expected to run, and the
  fish-only checks are labeled and grouped so they run only in fish

### Requirement: Daily-driver loop separated from one-time setup

The playbook SHALL separate the one-time machine setup (`maki-oss doctor`,
`maki-oss image build`, `maki-oss provider setup`) from the per-project
everyday loop (`cd <project> && maki-oss`, `maki-oss run "<prompt>"`,
`maki-oss status`, cleanup), and SHALL state the observable outcome of the
bare `maki-oss` command.

#### Scenario: One-time vs per-project separation

- **WHEN** a maintainer reads the daily-driver section
- **THEN** the commands that run once per machine are listed separately from
  the commands that run in every project, and no one-time command is presented
  as part of the per-project loop

#### Scenario: Bare command outcome stated

- **WHEN** an agent reads what `maki-oss` does with no arguments
- **THEN** the playbook states that it creates or reuses the project sandbox,
  uploads the project on first creation, attaches remembered providers,
  launches Maki, and syncs changes back on exit

### Requirement: Clear boundary to the sandbox playbook

The playbook SHALL end by handing off to `docs/ai/agent-playbook.md` for
sandbox phases, and MUST NOT contain sandbox creation, policy selection, or
isolation-verification commands of its own.

#### Scenario: No overlap with sandbox phases

- **WHEN** `docs/ai/host-playbook.md` is searched for
  `openshell sandbox create`, `openshell policy set`, and
  `openshell sandbox exec`
- **THEN** there are no matches; those steps are reached only through the
  handoff link

#### Scenario: Handoff is present

- **WHEN** an agent finishes the daily-driver section
- **THEN** the playbook links to `docs/ai/agent-playbook.md` and states that
  the sandbox phases continue there

### Requirement: Discoverable from the files agents read first

The README SHALL link `docs/ai/host-playbook.md` in its Guides list, and
`AGENTS.md` SHALL point to it in its start-here list, so an agent that reads
only the repository's instruction file reaches the playbook without searching.

#### Scenario: README link

- **WHEN** the README Guides list is read
- **THEN** it contains a working link to `docs/ai/host-playbook.md`

#### Scenario: Instruction-file pointer

- **WHEN** `AGENTS.md` is read by a coding agent
- **THEN** it names `docs/ai/host-playbook.md` as the path for setting up the
  host before running Maki

### Requirement: Versions match their canonical sources

Every version the playbook pins (Maki version, OpenShell version, container
engine minimum) SHALL match the repository's canonical source for that value —
`examples/maki-image/Dockerfile` for Maki, `docs/ai/references.md` for the
verified OpenShell and Maki versions — and the playbook SHALL link
`docs/ai/references.md` rather than restate external documentation links.

The OpenShell version a document claims to be verified against SHALL match
`docs/ai/references.md` on every page that states one, and a page claiming an
older verified version than the canonical one SHALL be treated as stale rather
than as a second opinion. Bumping the canonical version SHALL be accompanied by
a re-verification run recorded in `docs/verification-log.md`, so the claim is a
measurement rather than an edited string.

#### Scenario: Maki version consistency

- **WHEN** `MAKI_VERSION` in `examples/maki-image/Dockerfile` and the Maki
  version stated in `docs/ai/host-playbook.md` are compared
- **THEN** they are identical

#### Scenario: External links stay centralized

- **WHEN** `docs/ai/host-playbook.md` is searched for `https://` links
- **THEN** every such link is one of the URLs already listed in
  `docs/ai/references.md`

#### Scenario: OpenShell version consistency

- **WHEN** the OpenShell versions stated in `docs/ai/host-playbook.md`,
  `docs/setup-guide.md`, `docs/verification.md`, and `docs/ai/references.md`
  are compared
- **THEN** all four name the same version, and it is the version the
  verification log records as tested

#### Scenario: A version claim without a verification run is incomplete

- **WHEN** a page is changed to claim verification against a newer OpenShell
  version
- **THEN** `docs/verification-log.md` carries a dated entry for that version,
  and the checklist in `docs/verification.md` was run against it rather than
  carried forward
