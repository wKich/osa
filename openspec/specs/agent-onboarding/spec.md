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

The guide SHALL contain a short, copy-paste prompt that names the project path
and the host agent, or tells the agent to detect them; says to use the same
agent; forbids asking the user to paste a credential; requires an audit-first
plan; requires stopping on a mismatch; and requires completing the setup and
reporting the result. `README.md` SHALL present a short setup prompt as the
first human entry point and SHALL link the full prompt in the guide; the two
entry points SHALL name the same route.

#### Scenario: Prompt starts an end-to-end run
- **WHEN** a user sends the prompt to a coding agent on a bare host
- **THEN** the agent reads `AGENTS.md`, `docs/ai/onboarding.md`, the shared host playbook, and the chosen agent playbook, audits the host before mutating it, and follows the canonical phases through the report

#### Scenario: Prompt refuses a credential paste
- **WHEN** no API key or stored credential is found
- **THEN** the agent names the environment variable or credential store to populate instead of asking the user to paste a secret into the conversation

#### Scenario: README is the first human entry
- **WHEN** a human opens the README's setup section
- **THEN** the short agent prompt or its link appears before the manual command sequence, and the manual sequence remains available for a user who does not delegate setup

#### Scenario: One input, not a questionnaire
- **WHEN** a human prepares the prompt
- **THEN** the only required values are the project path and the host agent, or the agent detects them, and the human is not asked to choose commands or read the playbooks first

### Requirement: Canonical phase map with one column per front-end

The guide SHALL provide the canonical phases `P0` through `P8` and, for each
phase, a Maki, OpenCode, Claude Code, and Codex column that names the command
or document for that agent and the phase's gate. Each action SHALL have exactly
one owning phase: `P2` covers the repository, helper, and shell; `P3` covers
the image; `P4` covers the provider. A phase's gate MUST NOT require an
artifact that a later phase creates. `P1` covers shared host tools and any
host-only agent CLI; a CLI baked into the image is verified at `P3`. The
local-numbering map and each playbook's `Covers` and `Preconditions` metadata
SHALL agree with the table, and a playbook with a host-only preflight MAY
declare `P0-P8` only when it explains the extra phase.

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

#### Scenario: P2 does not build the image or provider

- **WHEN** a reader inspects the `P2` row for any agent
- **THEN** it names the repository, helper, and shell, and does not contain `image build`, `provider setup`, or a provider import

#### Scenario: One pass does not repeat a phase

- **WHEN** an agent follows the canonical phases from `P0` to `P8`
- **THEN** it builds the image once at `P3` and creates or imports the provider once at `P4`, and no earlier gate required either artifact

#### Scenario: Metadata matches the phase map

- **WHEN** a reader compares `Covers` and `Preconditions` on a playbook with the canonical table
- **THEN** an image-baked agent declares `P3-P8`, and a playbook with a host-only preflight declares `P0-P8` and explains the extra host phase

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
OpenCode, Claude Code, and Codex, rather than naming one as the default.
`AGENTS.md` SHALL also list all four agent playbooks and the shared helper and
provider references. Shared reference pages — `docs/helper.md`,
`docs/providers.md`, `docs/glossary.md`, and `dashboard/README.md` — SHALL name
all four front-ends or explicitly state their Maki-only scope and link the
other agents' pages. The agent-specific pages SHALL state which path they
belong to.

#### Scenario: Instruction file points to onboarding

- **WHEN** an agent reads `AGENTS.md`
- **THEN** the onboarding guide is the first setup entry, all four playbooks and the shared helper and provider references are listed, and all four front-ends are named

#### Scenario: Shared reference names all four or states its scope

- **WHEN** a reader opens `docs/helper.md`, `docs/providers.md`, `docs/glossary.md`, or `dashboard/README.md`
- **THEN** the page names Maki, OpenCode, Claude Code, and Codex, or states that it is the Maki-scoped reference and links the other agents' pages

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

### Requirement: One primary path per agent playbook

Each agent playbook SHALL present the helper as the primary ordered path and
MUST mark any raw `docker` or `openshell` commands as a fallback that is not
run in the same pass. The playbook SHALL state the helper's sandbox name and
the raw fallback's sandbox name, and MUST NOT present a helper shortcut after a
raw phase in a way that mixes the two. If the helper created the sandbox, the
raw create step MUST be skipped.

#### Scenario: Maki playbook is helper-first
- **WHEN** a reader opens the Maki playbook's image, provider, sandbox, run, and cleanup phases
- **THEN** the helper command is the primary instruction and the raw command is in a labelled fallback section

#### Scenario: Raw fallback has its own sandbox name
- **WHEN** a reader compares the helper path and the raw fallback
- **THEN** the helper path names the `mk-<project>-<hash>` sandbox and the raw path names its separate sandbox, and the page says not to mix them

#### Scenario: No helper shortcut after a raw phase
- **WHEN** a reader reaches the run phase after following the raw create phase
- **THEN** the page does not tell them to run the helper as if it were the same sandbox, and it names the raw command for that path

### Requirement: Safe project preparation before upload

Any documented project-preparation step that runs in the user's repository
SHALL be consent-based and MUST NOT commit the user's work. It MUST NOT
instruct `git add -A` or `git commit` for the user's tree. If the project is a
git repository, the documentation SHALL add or verify ignore patterns without
committing. If it is not a git repository, the documentation SHALL ask before
`git init`. The documentation SHALL state that the helper handles a dirty
baseline and that secrets such as `.env` must stay ignored.

#### Scenario: Existing repository keeps its uncommitted work
- **WHEN** the project is a git repository with uncommitted changes
- **THEN** the preparation step adds or verifies ignore patterns, creates no commit, and the user's changes remain uncommitted

#### Scenario: Non-repository asks before init
- **WHEN** the project is not a git repository
- **THEN** the documentation tells the agent to ask before `git init` and does not run it as an unconditional step

#### Scenario: Secrets stay out of the commit
- **WHEN** the project contains an untracked `.env` or similar secret file
- **THEN** the preparation step neither stages nor commits it, and the documentation names the file as one that must stay ignored

### Requirement: Credential commands never expose a value

Any documented provider-setup command SHALL NOT place a credential value in
argv, a command line, or shell history. The documentation SHALL use the
provider wizard, a hidden prompt, or an environment variable populated outside
the recorded command. A manual recipe MUST NOT show `KEY=<value> command`; it
SHALL use a hidden read or the wizard and SHALL keep the value out of output.

#### Scenario: Setup-guide manual recipe hides the key
- **WHEN** a reader follows the setup guide's manual provider recipe
- **THEN** the command reads the key through a hidden prompt or an already-exported variable and never shows `KEY=<value>` in the command block

#### Scenario: Playbook provider step hides the key
- **WHEN** a reader follows an agent playbook's provider step
- **THEN** the step uses `provider setup` or a hidden input and does not put the key on the command line

### Requirement: First-run documentation is executable

A page that claims to start from a clean host SHALL state its starting point
and SHALL include the repository clone and `bin/` `PATH` step, or explicitly
state that it starts after README Install and link there. It MUST NOT use a
helper before explaining how the helper is resolved. First-run command blocks
SHALL order `image build` before any diagnostic that requires the built image,
including `doctor`. A page that shows `mcp status` SHALL place it after the
sandbox-creation step.

#### Scenario: README builds before doctor
- **WHEN** a reader follows the README's install commands from a clean host
- **THEN** `image build` runs before `doctor`, and `doctor` is described as verifying the built image and host rather than as a prerequisite check

#### Scenario: Helper install and cookbook build before doctor
- **WHEN** a reader follows `docs/helper.md`'s Install or Cookbook block
- **THEN** `image build` runs before `doctor`

#### Scenario: Maki daily driver builds before doctor
- **WHEN** a reader follows the Maki playbook's one-time setup list
- **THEN** the base image build is listed before `doctor`

#### Scenario: Clean-host page states its starting point
- **WHEN** a page says it starts from a clean machine and uses a helper command
- **THEN** it includes the clone and `bin/` `PATH` step, or states that it starts after README Install and links there

#### Scenario: mcp status follows sandbox creation
- **WHEN** a page shows `mcp status`
- **THEN** the sandbox-creation step appears earlier on the page
