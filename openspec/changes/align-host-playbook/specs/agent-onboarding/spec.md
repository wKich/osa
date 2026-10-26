# Spec Delta

## MODIFIED Requirements

### Requirement: Discoverable and neutrally framed

`AGENTS.md` and `README.md` SHALL link `docs/ai/onboarding.md` first and SHALL
describe the product as supporting the user's coding agent, naming Maki,
OpenCode, and Claude Code, rather than naming one as the default. The
agent-specific pages SHALL state which path they belong to.

#### Scenario: Instruction file points to onboarding

- **WHEN** an agent reads `AGENTS.md`
- **THEN** the onboarding guide is the first setup entry and names all three
  front-ends

#### Scenario: Agent page names its path

- **WHEN** a reader opens `docs/ai/host-playbook.md`,
  `docs/ai/playbooks/maki.md`, `docs/opencode-oss.md`, or
  `docs/claude-oss.md`
- **THEN** the shared host page says it is the shared host path for every
  agent and links back to the onboarding guide, and the Maki, OpenCode, and
  Claude pages each state which agent path they belong to and link back to
  onboarding
