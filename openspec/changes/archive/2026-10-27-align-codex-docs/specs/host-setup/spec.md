# Spec Delta

## MODIFIED Requirements

### Requirement: Host tooling installation and verification

The shared playbook SHALL install and verify the container engine (Docker
Engine 28+ or a documented equivalent) and the OpenShell CLI with a running
gateway, using the upstream installers, and SHALL record the required
post-install gateway recovery step for a `Disconnected` status. It MUST NOT
install or version-check an agent CLI; the chosen agent's playbook owns that
step, including the host `codex` CLI that the Codex playbook installs for the
one-time ChatGPT login.

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
- **THEN** there are no matches; the Maki version check is in
  `docs/ai/playbooks/maki.md`, the OpenCode and Claude CLI versions are
  verified from their images in their own pages, and the Codex host CLI and
  image version are verified in `docs/ai/playbooks/codex.md`

### Requirement: Per-agent host steps live in the agent playbook

Agent-specific host steps SHALL live in the page for that agent.
`docs/ai/host-playbook.md` MUST NOT contain an agent CLI install or version
check, an agent image build, a provider wizard or profile command, an
agent-specific shell integration command, or a daily-driver loop for any agent.
`docs/ai/playbooks/maki.md`, `docs/ai/playbooks/opencode.md`,
`docs/ai/playbooks/claude.md`, and `docs/ai/playbooks/codex.md` SHALL own those
steps for Maki, OpenCode, Claude Code, and Codex respectively, and MAY link
`docs/helper.md` for behavior shared by the helpers.

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

#### Scenario: Codex login and image steps stay in the Codex playbook

- **WHEN** `docs/ai/host-playbook.md` is searched for `codex login`,
  `codex-oss provider setup`, `codex-oss image build`, and `--device-auth`
- **THEN** there are no matches; `docs/ai/playbooks/codex.md` owns the host
  login, provider setup, image build, and device-auth steps

### Requirement: Versions match their canonical sources

The OpenShell version the shared playbook pins SHALL match
`docs/ai/references.md`, and its container-engine minimum SHALL match
`docs/setup-guide.md`. The Maki playbook's pinned Maki version SHALL match
`examples/maki-image/Dockerfile` and the verified version in
`docs/ai/references.md`. The Codex playbook's pinned Codex version SHALL match
the `CODEX_VERSION` build argument in `codex-oss/image/Dockerfile` and the run
version recorded in `docs/ai/verification/codex.md`. Each page SHALL link
`docs/ai/references.md` rather than restate external documentation links.

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

#### Scenario: Codex version consistency

- **WHEN** `CODEX_VERSION` in `codex-oss/image/Dockerfile`, the Codex version
  stated in `docs/ai/playbooks/codex.md`, and the version recorded in
  `docs/ai/verification/codex.md` are compared
- **THEN** they are identical, and the verification page records the date of
  the run that measured that version

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
  `docs/setup-guide.md`, `docs/ai/verification/maki.md`, and
  `docs/ai/references.md` are compared
- **THEN** all four name the same version, and it is the version the
  verification log records as tested

#### Scenario: A version claim without a verification run is incomplete

- **WHEN** a page is changed to claim verification against a newer OpenShell
  version
- **THEN** `docs/verification-log.md` carries a dated entry for that version,
  and the checklist in `docs/ai/verification/maki.md` was run against it rather
  than carried forward
