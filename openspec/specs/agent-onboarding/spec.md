# Agent Onboarding Specification

## Purpose

Guarantees that any onboarding assistant can identify the coding agent a user
already runs, onboard that same agent into its matching OpenShell sandbox
without translating between agents, and follow one shared phase-and-gate
contract across Maki, OpenCode, Claude Code, and Codex.

## Requirements

### Requirement: Same-agent onboarding only

The onboarding guide SHALL state that osa moves the coding agent the user
already runs into its own sandbox: Maki to `maki-oss`, OpenCode to
`opencode-oss`, Claude Code to `claude-oss`, and Codex to `codex-oss`. It MUST
state that a cross-agent switch (for example OpenCode to `maki-oss`) is not
migration and is out of scope for onboarding.

#### Scenario: OpenCode user is routed to OpenCode

- **WHEN** the onboarding assistant detects that the user's host agent is OpenCode
- **THEN** the guide routes to `opencode-oss`, an `opencode-agent:local` image, `opencode-*` profiles, and `~/.config/opencode/` configuration, and does not route to Maki

#### Scenario: Codex user is routed to Codex

- **WHEN** the onboarding assistant detects that the user's host agent is Codex
- **THEN** the guide routes to `codex-oss`, a `codex-agent:local` image, the
  `codex-chatgpt` provider, and `$CODEX_HOME` or `~/.codex` configuration, and
  does not route to Maki

#### Scenario: Cross-agent request stops

- **WHEN** the user asks to onboard a different agent from the one they run on the host
- **THEN** the guide instructs the assistant to stop and report that this is an agent switch, not a same-agent migration

### Requirement: The onboarding assistant is not the target agent

The guide SHALL state that the agent reading it is the onboarding assistant,
not necessarily the agent being onboarded, and MUST NOT substitute its own
agent, configuration, credential store, or defaults for the user's.

#### Scenario: Assistant differs from target
- **WHEN** a Claude Code session reads the guide to onboard a user who runs Maki
- **THEN** the assistant configures `maki-oss` and does not install Claude Code or copy its own configuration

#### Scenario: User runs both agents
- **WHEN** the host has both Maki and OpenCode configuration
- **THEN** the assistant asks which agent to onboard first and does not merge the two configurations

### Requirement: Short copy-paste onboarding prompt

The guide SHALL contain a short, copy-paste prompt that names a project path
and the host agent, says to use the same agent, forbids asking the user to
paste a credential, requires an audit-first plan, and requires stopping on a
mismatch.

#### Scenario: Prompt starts an end-to-end run
- **WHEN** a user sends the prompt to a coding agent on a bare host
- **THEN** the agent reads `AGENTS.md` and `docs/ai/onboarding.md`, audits the host before mutating it, and follows the canonical phases

#### Scenario: Prompt refuses a credential paste
- **WHEN** no API key or stored credential is found
- **THEN** the agent names the environment variable or credential store to populate instead of asking the user to paste a secret into the conversation

### Requirement: Canonical phase map with one column per front-end

The guide SHALL provide the canonical phases `P0` through `P8` and, for each
phase, a Maki, OpenCode, Claude Code, and Codex column that names the command
or document for that agent and the phase's gate.

#### Scenario: Every phase has three agent paths

- **WHEN** a reader inspects the phase map for Maki, OpenCode, and Claude Code
- **THEN** each of `P0`-`P8` names those three paths, or explicitly marks a
  shared phase that applies to them

#### Scenario: Every phase has a Codex path

- **WHEN** a reader inspects the `P0`-`P8` phase map for Codex
- **THEN** each phase names the Codex command or page, or explicitly marks a
  shared phase that applies to all four agents

#### Scenario: Phase links resolve

- **WHEN** the guide is checked by `scripts/check-links.sh`
- **THEN** every relative link to a playbook, reference, verification page, or helper document resolves to an existing file

### Requirement: Same-agent migration matrix

The guide SHALL list, for each supported agent, the migration source,
destination, and verification for credentials, MCP servers, settings, skills,
commands, plugins, and project-local configuration. It MUST report an item
that has no same-agent path by name instead of dropping it.

#### Scenario: OpenCode rows use OpenCode paths

- **WHEN** a reader inspects the OpenCode column
- **THEN** credentials come from the OpenCode store, MCP and settings from `~/.config/opencode/`, and the destination is the `opencode-agent` environment store

#### Scenario: Codex rows use Codex paths

- **WHEN** a reader inspects the Codex column
- **THEN** credentials come from a host ChatGPT login in a throwaway
  `CODEX_HOME` through `codex-oss provider setup`, MCP and settings come from
  `$CODEX_HOME/config.toml` or `~/.codex/config.toml`, the destination is
  `/sandbox/.codex/config.toml` in a `codex-agent` environment store, and an
  item with no recorded same-agent path is reported unsupported

#### Scenario: Unsupported item is reported

- **WHEN** an agent configuration contains an item with no same-agent migration path
- **THEN** the guide instructs the assistant to report its name and reason, and does not translate it into another agent's configuration

### Requirement: Add-binary guidance distinguishes four cases

The guide SHALL distinguish adding the helper to `PATH`, changing the pinned
agent version, adding a tool binary, and adding a new agent front-end. It MUST
send tool binaries to the environment store and MUST NOT install a runtime
into a running sandbox.

#### Scenario: Tool binary belongs in the image

- **WHEN** the user asks for an extra CLI tool in the sandbox
- **THEN** the guide places it in the environment store's Dockerfile, verifies it with `command -v` in the built image, and does not install it into a running sandbox

#### Scenario: Agent binary path stays policy-bound

- **WHEN** the user asks to move or wrap the agent binary
- **THEN** the guide warns that provider profiles authorize `/usr/local/bin/maki`, `/usr/local/bin/opencode`, `/usr/local/bin/claude`, or `/usr/local/bin/codex`, and that changing the path breaks egress binding

### Requirement: Safety gates and stop conditions

The guide SHALL require an audit before host mutation, explicit consent before
host installs, shell edits, or deleting an existing sandbox, and SHALL list
the conditions that stop onboarding: a disconnected gateway, a version
mismatch, no usable credential for the chosen agent, a loopback endpoint, an
unsupported item, a missing stdio runtime, a policy denial, a parked
workspace, or a sandbox that is not `Ready`. It MUST repeat every security
invariant that applies to the sandbox.

The guide MUST state that Codex's ChatGPT login happens on the host in a
throwaway `CODEX_HOME` through `codex-oss provider setup`, that the gateway
refreshes the access token, and that the sandbox holds no `auth.json`, never
receives the host's `~/.codex`, never runs `codex login`, and never overrides
the provider's base URL.

#### Scenario: Host mutation waits for consent

- **WHEN** the assistant has finished the audit and needs to install host tooling or edit the shell
- **THEN** it shows the planned commands and asks for confirmation before running them

#### Scenario: Destructive action stops for confirmation

- **WHEN** changing the image would require deleting an existing sandbox with sessions or a parked workspace
- **THEN** the guide instructs the assistant to report the loss and ask before deleting or recreating it

#### Scenario: Codex login stays on the host

- **WHEN** the assistant onboards a Codex user
- **THEN** the guide sends the login to `codex-oss provider setup` on the host,
  which uses a throwaway `CODEX_HOME`, and forbids `codex login`, an
  `auth.json`, the host's `~/.codex`, and a base-URL override inside the
  sandbox

### Requirement: Discoverable and neutrally framed

`AGENTS.md` and `README.md` SHALL link `docs/ai/onboarding.md` first and SHALL
describe the product as supporting the user's coding agent, naming Maki,
OpenCode, Claude Code, and Codex, rather than naming one as the default. The
agent-specific pages SHALL state which path they belong to.

#### Scenario: Instruction file points to onboarding

- **WHEN** an agent reads `AGENTS.md`
- **THEN** the onboarding guide is the first setup entry and names all four
  front-ends

#### Scenario: Agent page names its path

- **WHEN** a reader opens `docs/ai/host-playbook.md`,
  `docs/ai/playbooks/maki.md`, `docs/ai/playbooks/opencode.md`,
  `docs/ai/reference/opencode.md`, `docs/ai/playbooks/claude.md`,
  `docs/ai/reference/claude.md`, `docs/ai/playbooks/codex.md`, or
  `docs/ai/reference/codex.md`
- **THEN** the shared host page says it is the shared host path for every
  agent and links back to the onboarding guide, and the Maki, OpenCode, Claude,
  and Codex pages each state which agent path they belong to and link back to
  onboarding
