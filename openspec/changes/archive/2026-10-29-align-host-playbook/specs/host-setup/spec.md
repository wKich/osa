# Spec Delta

## MODIFIED Requirements

### Requirement: Ordered host playbook with a verification gate per step

The repository SHALL provide `docs/ai/host-playbook.md` as an ordered,
agent-executable sequence from a bare host to a working repository and shell,
where every step states the command to run, the expected output, and a rule to
stop and report on mismatch rather than continue. The agent-specific steps that
follow — agent CLI, image, provider, shell integration, and daily driver —
SHALL live in the playbook for the chosen agent.

#### Scenario: Every step is checkable

- **WHEN** a maintainer reads any step of `docs/ai/host-playbook.md`
- **THEN** that step names at least one verification command together with
  the output that counts as success, and the playbook states that a failed
  check stops the run

#### Scenario: Fresh host ordering

- **WHEN** an agent follows the playbook on a machine where Docker,
  `openshell`, and every agent CLI are all absent
- **THEN** the steps run in dependency order — tooling, then repository and
  shell — and no step assumes a tool the preceding steps have not installed
  and verified

#### Scenario: Shared page ends at the repository

- **WHEN** an agent finishes `docs/ai/host-playbook.md`
- **THEN** it has a cloned repository with `bin/` on `PATH` and a verified
  shared command, and the page hands off to onboarding for the agent-specific
  steps

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
  so the later `maki-oss doctor` engine failure in the agent playbook is not
  misread as an engine that is "installed but not running"

### Requirement: Host tooling installation and verification

The shared playbook SHALL install and verify the container engine (Docker
Engine 28+ or a documented equivalent) and the OpenShell CLI with a running
gateway, using the upstream installers, and SHALL record the required
post-install gateway recovery step for a `Disconnected` status. It MUST NOT
install or version-check an agent CLI; the chosen agent's playbook owns that
step.

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

#### Scenario: No agent CLI on the shared page

- **WHEN** `docs/ai/host-playbook.md` is searched for `maki --version`,
  `opencode --version`, or `claude --version`
- **THEN** there are no matches; the Maki version check is in
  `docs/ai/playbooks/maki.md`, and the OpenCode and Claude CLI versions are
  verified from their images in their own pages

### Requirement: Provider step states its inputs and scopes the login restriction

The Maki playbook SHALL state the input the provider wizard requires — a model
API key, exported in the environment or already present in a Maki or OpenCode
credential store — before running it, SHALL name the non-interactive forms
documented in `docs/providers.md` (`--from STORE --credential SLUG --yes`,
`--env VAR`, `--file PATH`), and SHALL scope any restriction on `maki auth
login` to the sandbox, matching `AGENTS.md`, so host-side credential stores
remain a legitimate wizard source.

#### Scenario: Required input is stated on a bare host

- **WHEN** an agent reads the provider step in `docs/ai/playbooks/maki.md` on
  a host whose Maki and OpenCode credential stores are empty
- **THEN** the playbook has already stated that a model API key is required
  input and where it comes from, instead of describing a scan that finds
  nothing

#### Scenario: Non-interactive forms are named

- **WHEN** the provider step runs without a terminal
- **THEN** the Maki playbook names the non-interactive flags rather than
  leaving the agent to infer them from a usage error

#### Scenario: Login restriction is sandbox-scoped

- **WHEN** an agent reads the Maki playbook's `maki auth login` restriction
- **THEN** it applies to the sandbox only, so host-side credential stores are
  still offered as a wizard source

### Requirement: Shell preparation with one verified path per shell

The shared host playbook SHALL add the repository's `bin/` to `PATH` and verify
the shared command with `command -v osa` in a POSIX shell. The Maki playbook
SHALL cover shell preparation for both zsh and fish, choosing exactly one
primary path per shell (repository `bin/` on `PATH`, or the fish plugin through
fisher, or `maki-oss fish install`), and SHALL document `MAKI_OSS_BIN` as the
fallback when the repository location must be discovered explicitly. Every
documented path SHALL be runnable on the bare host the playbook targets: a fish
path that depends on a plugin manager SHALL be presented only as an
alternative, the primary fish path SHALL be runnable from the repository root
before anything is on `PATH` or in the fish function directory, and each
shell's verification commands SHALL be labeled so they run only in that shell.

#### Scenario: Shared path resolves the shared command

- **WHEN** an agent completes the shared repository step and runs
  `command -v osa`
- **THEN** the command resolves to this repository's `bin/osa`

#### Scenario: Maki fish path resolves the helper

- **WHEN** an agent completes the Maki playbook's fish section and runs
  `type -q maki-oss`
- **THEN** the command resolves to this repository's `bin/maki-oss`

#### Scenario: Maki fallback is documented

- **WHEN** neither the `PATH` entry nor the fish function can locate the Maki
  helper
- **THEN** the Maki playbook states that setting `MAKI_OSS_BIN` to the
  absolute path of `bin/maki-oss` makes the wrapper resolve it

#### Scenario: Maki fish path runs before the helper is resolvable

- **WHEN** an agent with no fisher, no `maki-oss` on `PATH`, and no installed
  fish function follows the Maki playbook's fish section from the repository
  root
- **THEN** `./bin/maki-oss fish install` runs from the repository's files and
  succeeds without a prior shell-preparation step

#### Scenario: Per-shell verification stays in its shell

- **WHEN** an agent runs the Maki playbook's POSIX verification block
- **THEN** no fish-only command (such as `type -q` or a check of
  `~/.config/fish/…`) appears in the commands it is expected to run, and the
  fish-only checks are labeled and grouped so they run only in fish

#### Scenario: Shared page stays shell-neutral

- **WHEN** `docs/ai/host-playbook.md` is read for shell integration
- **THEN** it names only the shared `bin/` on `PATH` step and points to the
  shared `docs/helper.md` Fish setup section or the agent playbook for fish
  integration and agent-specific fallback variables, with no
  `maki-oss fish install` or `MAKI_OSS_BIN` command

### Requirement: Daily-driver loop separated from one-time setup

The Maki playbook SHALL separate the one-time machine setup (`maki-oss doctor`,
`maki-oss image build` for the base image, an optional environment-store build,
`maki-oss provider setup`, and setting `image` when a derived image is used)
from the per-project everyday loop (`cd <project> && maki-oss`,
`maki-oss run "<prompt>"`, `maki-oss status`, cleanup), and SHALL state the
observable outcome of the bare `maki-oss` command.

#### Scenario: One-time vs per-project separation

- **WHEN** a maintainer reads the Maki playbook's `Daily driver` section
- **THEN** the commands that run once per machine are listed separately from
  the commands that run in every project, and no one-time command is presented
  as part of the per-project loop

#### Scenario: Base and environment builds are separate

- **WHEN** a maintainer reads the Maki playbook's one-time image setup
- **THEN** the base image build and any environment-store build are separate
  steps, and the derived image is selected through the `image` setting

#### Scenario: Bare command outcome stated

- **WHEN** an agent reads what `maki-oss` does with no arguments
- **THEN** the Maki playbook states that it creates or reuses the project
  sandbox, uploads the project on first creation, attaches remembered
  providers, launches Maki, and syncs changes back on exit

#### Scenario: No daily driver on the shared page

- **WHEN** `docs/ai/host-playbook.md` is searched for `maki-oss run`,
  `maki-oss status`, `maki-oss stop`, `maki-oss rm`, or `maki-oss policy
  review`
- **THEN** there are no matches; the Maki playbook's `Daily driver` section
  owns the loop

### Requirement: Clear boundary to the sandbox playbook

The shared playbook SHALL end by handing off to `docs/ai/onboarding.md`, which
routes to the chosen agent's playbook for agent CLI, image, provider, sandbox,
and run phases, and MUST NOT contain sandbox creation, policy selection,
isolation-verification, or agent-run commands of its own.

#### Scenario: No overlap with sandbox phases

- **WHEN** `docs/ai/host-playbook.md` is searched for
  `openshell sandbox create`, `openshell policy set`, and
  `openshell sandbox exec`
- **THEN** there are no matches; those steps are reached only through the
  handoff link

#### Scenario: Handoff is present

- **WHEN** an agent finishes the shared host playbook
- **THEN** the playbook links to `docs/ai/onboarding.md` and states that the
  chosen agent's playbook owns the agent CLI, image, provider, and sandbox
  steps

### Requirement: Versions match their canonical sources

The OpenShell version the shared playbook pins SHALL match
`docs/ai/references.md`, and its container-engine minimum SHALL match
`docs/setup-guide.md`. The Maki playbook's pinned Maki version SHALL match
`examples/maki-image/Dockerfile` and the verified version in
`docs/ai/references.md`. Each page SHALL link `docs/ai/references.md` rather
than restate external documentation links.

The OpenShell version a document claims to be verified against SHALL match
`docs/ai/references.md` on every page that states one, and a page claiming an
older verified OpenShell version than the canonical one SHALL be treated as
stale rather than as a second opinion. Bumping the canonical version SHALL be
accompanied by a re-verification run recorded in `docs/verification-log.md`, so
the claim is a measurement rather than an edited string.

#### Scenario: Maki version consistency

- **WHEN** `MAKI_VERSION` in `examples/maki-image/Dockerfile` and the Maki
  version stated in `docs/ai/playbooks/maki.md` are compared
- **THEN** they are identical

#### Scenario: Shared OpenShell and engine pins

- **WHEN** the OpenShell version in `docs/ai/host-playbook.md` is compared with
  `docs/ai/references.md`, and its container-engine minimum with
  `docs/setup-guide.md`
- **THEN** the shared page states the same verified OpenShell version and the
  same container-engine minimum of `28.0` or later

#### Scenario: External links stay centralized

- **WHEN** `docs/ai/host-playbook.md` and `docs/ai/playbooks/maki.md` are
  searched for `https://` links
- **THEN** every such link is one of the URLs already listed in
  `docs/ai/references.md`

#### Scenario: OpenShell version consistency

- **WHEN** the OpenShell versions stated in `docs/ai/host-playbook.md`,
  `docs/setup-guide.md`, `docs/ai/verification/maki.md`, and `docs/ai/references.md`
  are compared
- **THEN** all four name the same version, and it is the version the
  verification log records as tested

#### Scenario: A version claim without a verification run is incomplete

- **WHEN** a page is changed to claim verification against a newer OpenShell
  version
- **THEN** `docs/verification-log.md` carries a dated entry for that version,
  and the checklist in `docs/ai/verification/maki.md` was run against it rather than
  carried forward

### Requirement: Per-agent host steps live in the agent playbook

Agent-specific host steps SHALL live in the page for that agent.
`docs/ai/host-playbook.md` MUST NOT contain an agent CLI install or version
check, an agent image build, a provider wizard or profile command, an
agent-specific shell integration command, or a daily-driver loop for any agent.
`docs/ai/playbooks/maki.md`, `docs/ai/playbooks/opencode.md`, and
`docs/ai/playbooks/claude.md` SHALL own those steps for Maki, OpenCode, and
Claude Code respectively, and MAY link `docs/helper.md` for behavior shared by
the helpers.

#### Scenario: Maki CLI install and version are in the Maki playbook

- **WHEN** `docs/ai/host-playbook.md` and `docs/ai/playbooks/maki.md` are
  compared for the Maki CLI
- **THEN** `maki --version` and the installer step appear only in
  `docs/ai/playbooks/maki.md`

#### Scenario: Shared page contains no Maki command

- **WHEN** `docs/ai/host-playbook.md` is searched for `maki --version`,
  `maki-oss`, and `maki-agent`
- **THEN** there are no command matches; a Maki mention in the `See also`
  navigation links is allowed, but no Maki-specific step is present

#### Scenario: OpenCode and Claude image and provider steps stay in their pages

- **WHEN** `docs/ai/host-playbook.md` is searched for `opencode-oss`,
  `claude-oss`, `opencode-agent`, and `claude-agent`
- **THEN** there are no command or step matches; the OpenCode and Claude pages
  own their image and provider steps
