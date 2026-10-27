# Spec Delta

## MODIFIED Requirements

### Requirement: Host tooling installation and verification

The shared playbook SHALL install and verify the container engine (Docker
Engine 28+ or a documented equivalent) and the OpenShell CLI with a running
gateway, using the upstream installers, and SHALL record the required
post-install gateway recovery step for a `Disconnected` status. The repository
SHALL NOT claim an engine it does not document: if `README.md` offers Podman,
the playbook SHALL name the `engine` setting (`MAKI_OSS_ENGINE=podman` or
`engine = "podman"`) and the verification command for that engine; otherwise
the README SHALL name only the engines the playbook verifies. The shared
playbook MUST NOT install or version-check an agent CLI; the chosen agent's
playbook owns that step, including the host `codex` CLI that the Codex playbook
installs for the one-time ChatGPT login.

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
  `opencode --version`, `claude --version`, or `codex --version`
- **THEN** there are no matches; the Maki version check, when present, is
  optional and in `docs/ai/playbooks/maki.md`, the OpenCode and Claude CLI
  versions are verified from their images in their own pages, and the Codex
  host CLI and image version are verified in `docs/ai/playbooks/codex.md`

#### Scenario: Engine claim matches a documented preflight

- **WHEN** `README.md` names Docker, Podman, or another engine as supported
- **THEN** the shared host playbook has a preflight and verification command for
  that engine, or the README names only the engine the playbook verifies

### Requirement: Per-agent host steps live in the agent playbook

Agent-specific host steps SHALL live in the page for that agent.
`docs/ai/host-playbook.md` MUST NOT contain an agent CLI install or version
check, an agent image build, a provider wizard or profile command, an
agent-specific shell integration command, or a daily-driver loop for any agent.
`docs/ai/playbooks/maki.md`, `docs/ai/playbooks/opencode.md`,
`docs/ai/playbooks/claude.md`, and `docs/ai/playbooks/codex.md` SHALL own those
steps for Maki, OpenCode, Claude Code, and Codex respectively, and MAY link
`docs/helper.md` for behavior shared by the helpers.

The Maki playbook SHALL treat a host `maki` CLI as optional for the helper
path: a missing host CLI MUST NOT stop onboarding, because the helper reads the
Maki credential store directly and the sandbox runs the image-pinned binary.
The Maki playbook MAY document a host CLI check for a user who wants to inspect
or use their host Maki installation, but it MUST label it optional and MUST NOT
make its version a gate.

#### Scenario: Maki CLI install and version are in the Maki playbook

- **WHEN** `docs/ai/host-playbook.md` and `docs/ai/playbooks/maki.md` are
  compared for the Maki CLI
- **THEN** any `maki --version` check and installer step appear only in
  `docs/ai/playbooks/maki.md` and are labelled optional

#### Scenario: Maki CLI absence does not stop the helper path

- **WHEN** the host has no `maki` command and the user chooses the Maki helper
- **THEN** the Maki playbook continues with `maki-oss provider setup` and the
  image-pinned sandbox binary, and does not stop on the missing host CLI

#### Scenario: Maki CLI check, when present, is not a gate

- **WHEN** the Maki playbook shows a host `maki --version` check
- **THEN** the check is marked optional and does not appear in the playbook's
  `Stop if` conditions

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

#### Scenario: Codex login and image steps stay in the Codex playbook

- **WHEN** `docs/ai/host-playbook.md` is searched for `codex login`,
  `codex-oss provider setup`, `codex-oss image build`, and `--device-auth`
- **THEN** there are no matches; `docs/ai/playbooks/codex.md` owns the host
  login, provider setup, image build, and device-auth steps
