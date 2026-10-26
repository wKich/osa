# Spec Delta

## MODIFIED Requirements

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
- **THEN** there are no command or step matches; the OpenCode and Claude
  pages own their image and provider steps
