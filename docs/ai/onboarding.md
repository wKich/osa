| Field | Value |
|---|---|
| Doc | `router-onboarding` |
| Kind | `router` |
| Agent | `shared` |
| Covers | `P0-P8` |
| Verified | not yet verified |

# Onboarding

## Scope

Use this page when a user wants to put the coding agent they already run on
their host into an osa OpenShell sandbox. It routes Maki, OpenCode, and Claude
Code without changing which agent the user runs.

**The one rule: keep the same coding agent.** osa moves the agent you already
run into its own sandbox — Maki to `maki-oss`, OpenCode to `opencode-oss`, and
Claude Code to `claude-oss`. A cross-agent switch (for example OpenCode to
`maki-oss`) is not migration and is out of scope for onboarding.

The agent reading this page is the onboarding assistant, not necessarily the
agent being onboarded. Do not substitute your own agent, configuration,
credential store, or defaults for the user's. One agent per run: when the host
has more than one configured, ask which agent to onboard first and do not merge
their configurations.

This is a router. Commands and per-agent detail stay in the linked pages; do
not duplicate or improvise them here. The page is checked as a document, not
as a live three-agent run. The agent pages record their own verified runs.

## Copy this prompt

Replace both placeholders and send the block to a coding agent on the host.

```text
Onboard the coding agent I already run into an osa OpenShell sandbox.

Project: <absolute path to my project>
My host agent: <Maki | OpenCode | Claude Code>

Use the same agent I already run. Do not switch to a different agent, and do
not translate my configuration to another agent. Read AGENTS.md and
docs/ai/onboarding.md, audit my host and configuration first (read-only), and
show me the plan and the exact commands before changing anything. Ask before
installing host tooling, editing my shell, deleting or recreating a sandbox, or
discarding work. Never ask me to paste an API key or token into this chat; name
the environment variable or credential store I should populate instead. Stop
and report the command and output on any failed gate, version mismatch, or
unsupported item. Finish with the report format from the guide.
```

## Task index

| Need | Start here |
|---|---|
| Setup on a bare host | P0-P1, then the host playbook for the user's agent |
| Put a helper or agent binary on `PATH` | [Add a binary](#add-a-binary) |
| Create or inspect an OpenShell sandbox | P4-P5 and the matching agent page |
| Migrate configs: MCP, settings, skills, commands, plugins | [Same-agent migration matrix](#same-agent-migration-matrix) |
| Migrate credentials | [Same-agent migration matrix](#same-agent-migration-matrix) and `provider setup` in the agent page |
| Move an existing project and its local configs | [Same-agent migration matrix](#same-agent-migration-matrix), project-local row |
| Understand a failure | [Stop if](#stop-if) and [Report](#report) |

## Inputs

- The project path, or "empty workspace" when there is no project.
- The host agent and how it is invoked: `maki`, `opencode`, or `claude`.
- Read-only audit facts: OS and architecture, container engine, `openshell
  status`, the agent version, and the paths that exist under the agent's
  config and credential stores.
- Consent for host installs, shell edits, sandbox deletion, or discarding
  uncommitted work. Audit before asking for any mutation.
- No credential value. Name the environment variable or credential store to
  populate; never ask for, echo, or copy a secret.

## Phase map

The canonical phases are shared. The gate is the same for every agent; the
agent columns name the command or page for that front-end.

| Phase | Gate | Maki (`maki-oss`) | OpenCode (`opencode-oss`) | Claude (`claude-oss`) |
|---|---|---|---|---|
| P0 Preflight / audit | Every required host tool is present and reports a usable version. | Read the host and config; shared preflight from [host playbook](host-playbook.md) Phase 1; `maki --version` from [agent playbook](playbooks/maki.md) Phase 0. | Read the host and config; `openshell status`; [OpenCode page](../opencode-oss.md#install). | Read the host and config; `openshell status`; [Claude page](../claude-oss.md#credentials). |
| P1 Host tools | The engine, OpenShell CLI and gateway, and agent CLI are installed. | Install engine and OpenShell from [host playbook](host-playbook.md) Phase 2; install the pinned Maki CLI from [agent playbook](playbooks/maki.md) Phase 0. | Install engine, OpenShell, and the helper; the OpenCode CLI comes from the image at P3; [OpenCode page](../opencode-oss.md#install). | Install engine, OpenShell, and the helper; create a subscription token on the host only when needed; [Claude page](../claude-oss.md#credentials). |
| P2 Repository + helper | The repository, helper preflight, image, and provider profile exist. | Clone the repo and put `bin/` on `PATH` from [host playbook](host-playbook.md) Phase 3; run `maki-oss doctor`, `maki-oss image build`, and `maki-oss provider setup` from [agent playbook](playbooks/maki.md) Phases 1-2 and Shell preparation. | Clone the repo, put `bin/` on `PATH`, run `opencode-oss doctor`; [OpenCode page](../opencode-oss.md#install). | Clone the repo, put `bin/` on `PATH`, run `claude-oss doctor`; [Claude page](../claude-oss.md#install). |
| P3 Image | The agent image builds and reports the pinned agent version. | `maki-oss image build` (`maki-agent:local`); verify with `maki --version`; [agent playbook](playbooks/maki.md) Phase 1. | `opencode-oss image build` (`opencode-agent:local`); verify with `opencode --version`; [OpenCode page](../opencode-oss.md#install). | `claude-oss image build` (`claude-agent:local`); verify with `claude --version`; [Claude page](../claude-oss.md#install). |
| P4 Provider | The provider profile is imported and the provider is created. | `maki-oss provider setup`; [agent playbook](playbooks/maki.md) Phase 2. | `opencode-oss provider setup`; [OpenCode page](../opencode-oss.md#provider-setup). | `claude-oss provider setup`; [Claude page](../claude-oss.md#credentials). |
| P5 Sandbox | The sandbox reaches `Ready` with the chosen policy and provider. | `maki-oss up`; [agent playbook](playbooks/maki.md) Phases 3-4. | `opencode-oss up`; [OpenCode page](../opencode-oss.md#sessions). | `claude-oss up`; [Claude page](../claude-oss.md#sessions). |
| P6 Verify | Every isolation check reports its expected result. | `maki-oss mcp status` and [verification](../verification.md); [agent playbook](playbooks/maki.md) Phase 5. | `opencode-oss mcp status` and [verification](../verification.md); [OpenCode page](../opencode-oss.md#mcp-status). | `claude-oss mcp status` and [verification](../verification.md); [Claude page](../claude-oss.md#mcp-status). |
| P7 Run | The smoke test and the real task complete through the sandbox. | `maki-oss` or `maki-oss run "<task>"`; [agent playbook](playbooks/maki.md) Phase 6. | `opencode-oss` or `opencode-oss run "<task>"`; [OpenCode page](../opencode-oss.md#sessions). | `claude-oss` or `claude-oss run "<task>"`; [Claude page](../claude-oss.md#sessions). |
| P8 Report | Results are collected, the sandbox is cleaned up, and the user has a summary. | Collect the patch, then `maki-oss status`; [agent playbook](playbooks/maki.md) Phase 7. | Collect the patch, then `opencode-oss status`; [OpenCode page](../opencode-oss.md#sessions). | Collect the patch, then `claude-oss status`; [Claude page](../claude-oss.md#sessions). |

For OpenCode and Claude Code the agent CLI is baked into the image; the P1
agent-CLI gate is satisfied by the P3 build, not by a host install.

Local numbering stays where it is. This table maps the shared host playbook and
the Maki agent playbook to the canonical IDs; the OpenCode and Claude pages are
unnumbered references.

| Canonical | Shared host playbook | Maki agent playbook |
|---|---|---|
| P0 | Phase 1 | Phase 0 |
| P1 | Phase 2 | Phase 0 |
| P2 | Phase 3 | Shell preparation, Phases 1-2 |
| P3 | - | Phase 1 |
| P4 | - | Phase 2 |
| P5 | - | Phases 3-4 |
| P6 | - | Phase 5 |
| P7 | - | Phase 6 |
| P8 | - | Phase 7 |

## Same-agent migration matrix

Each cell reads **source → destination · verification**. The destination is
the same agent's environment store, provider, or uploaded project. A global
config change is an image rebuild; it is never an install into a running
sandbox. Copy definitions, never a credential value. Replace every secret with
the provider's environment-variable reference.

| Item | Maki | OpenCode | Claude |
|---|---|---|---|
| Credentials | `~/.local/state/maki/auth/` → `maki-*` provider via `maki-oss provider setup` · `openshell provider list`, `maki-oss doctor` | `~/.local/share/opencode/auth.json` → `opencode-*` provider via `opencode-oss provider setup` · `openshell provider list`, `opencode-oss doctor` | host `ANTHROPIC_API_KEY` or a host-created subscription token → `claude-anthropic` or `claude-anthropic-oauth` · `claude-oss doctor`; attach only one |
| MCP | `~/.config/maki/mcp.toml` → store `config/mcp.toml`, baked to `/sandbox/.config/maki/mcp.toml` · `maki-oss mcp status` | `~/.config/opencode/opencode.json` `mcp` key → store `config/opencode.json`, baked to `/sandbox/.config/opencode/opencode.json` · `opencode-oss mcp status` | `~/.claude.json` `mcpServers` → store config baked to `/sandbox/.claude.json` · `claude-oss mcp status` |
| Settings | `~/.config/maki/init.lua`, `permissions.toml`, `providers.toml`, `plugin.toml` → store `config/` · rebuild and `maki-oss doctor` | `~/.config/opencode/opencode.json`, `tui.json` → store `config/` · rebuild and `opencode debug config --standalone --print-logs` | `~/.claude/settings.json` → store config baked to `/sandbox/.claude/settings.json` · rebuild; check settings sources in a session |
| Skills | `~/.config/maki/skills/` → store `config/skills/`, baked to `/sandbox/.config/maki/skills/` · `test -f` in the built image | `~/.config/opencode/skills/` → store `config/skills/`, baked to `/sandbox/.config/opencode/skills/` · `test -f` in the built image | `~/.claude/skills/` → store `config/skills/`, baked to `/sandbox/.claude/skills/` · `test -f` in the built image |
| Commands | `~/.config/maki/commands/` → store `config/commands/`, baked to `/sandbox/.config/maki/commands/` · `test -f` and the command palette | `~/.config/opencode/commands/` → store `config/commands/`, baked to `/sandbox/.config/opencode/commands/` · `test -f` and `/` | `~/.claude/commands/` → store `config/commands/`, baked to `/sandbox/.claude/commands/` · `test -f` and `/` |
| Plugins | `~/.config/maki/lua/` with `plugin.toml` → store `config/lua/` and `config/plugin.toml` · `/reload` and a tool call | Local `~/.config/opencode/plugins/` → store `config/plugins/` with a pinned runtime · load in a built image; an npm plugin that fetches at startup has no same-agent path, so report it by name | No supported path in this change: report the plugin name as unsupported; do not translate it. |
| Project-local configuration | `.maki/` (MCP, permissions, skills, commands, Lua) stays with the project and uploads with it · `maki-oss mcp status` for servers | `.opencode/` and the project `opencode.json` stay with the project and upload with it · `opencode-oss mcp status` for servers | `.claude/`, `.mcp.json`, `CLAUDE.md`, or `AGENTS.md` stay with the project and upload with it · a headless run; keep secrets out of `.mcp.json` |

Rules for every row:

- **Audit first, then classify.** List each item by name before copying it.
  Never print a credential value, and never put one in the store, the image,
  or the conversation.
- **Global config belongs to the store.** Add it to the store's build context,
  rebuild the derived image, and select that tag in the agent's helper config.
  Existing sandboxes keep their old image until recreated.
- **Project config belongs to the project.** Upload it with the project; keep
  dependency and credential directories out of the upload.
- **No row, no translation.** An item with no same-agent path is reported by
  name and reason. It is never translated into another agent's format.
- **OAuth is not a migration.** Report an OAuth-only credential and stop.
  Maki and OpenCode cannot use those logins here; Claude Code accepts only a
  host-created subscription token or API key, never an in-sandbox login.
- **Loopback and local endpoints stop.** A server or provider pointed at
  `localhost`, `127.0.0.1`, or another loopback address is reported, not
  copied into the sandbox.
- **A stdio server needs an image runtime.** Add the pinned runtime and package
  to the store's Dockerfile and verify with `command -v`; never install into a
  running sandbox. A missing runtime is a stop condition.

## Add a binary

"Add a binary" means one of four different things. Pick the right one before
changing anything.

### Helper on `PATH`

The helper runs on the host, not in the sandbox. Clone the repository, put
`bin/` on `PATH`, then verify the matching command resolves:

```sh
command -v maki-oss
command -v opencode-oss
command -v claude-oss
```

For fish, use `./bin/maki-oss fish install` or `fisher install ./fish`. The
fallback is `MAKI_OSS_BIN` pointing at this repository's `bin/maki-oss`. This
case changes no sandbox and no image.

### Pinned agent version

The agent version is part of the image. Change the pin and its checksums in the
matching Dockerfile, rebuild the base and any derived store, and re-run that
agent's verification page. Never update, install, or wrap the agent inside a
running sandbox. A version mismatch between the pin and the running image is a
stop condition, not a reason to patch the sandbox.

### Tool binary or stdio runtime

A tool, runtime, or stdio MCP package belongs in the environment store's
Dockerfile. Pin it, install it at build time, and verify it in the built image:

```sh
docker run --rm --entrypoint sh <derived-image> -c 'command -v <tool>'
```

The helper never installs a package into a running sandbox, and the sandbox
never fetches from a registry at session time. A missing runtime stays a
reported stop condition until the store is rebuilt.

### New agent front-end

Adding a fourth front-end means a new helper, image, policy, provider set,
docs, and spec. It is not onboarding and is out of scope here. Report it as a
new capability instead of bolting it onto an existing agent's paths.

**Agent binary paths are policy-bound.** Provider profiles authorize the exact
binaries `/usr/local/bin/maki`, `/usr/local/bin/opencode`, and
`/usr/local/bin/claude`. Moving, renaming, or wrapping an agent binary breaks
the egress binding; do not do it to make a command resolve.

## Stop if

Stop before the next phase when any condition below is true. Report the
condition, the failing command, and its output. Never work around it by
widening an invariant.

| Condition | What to report |
|---|---|
| A disconnected gateway | `openshell status` output; restart the gateway once, then stop if it remains disconnected. |
| A version mismatch | The expected pin and the observed version; do not tag, wrap, or install around it. |
| no key or OAuth-only | Name the environment variable or credential store to populate; never extract an OAuth token. |
| A loopback endpoint | The server or provider name and its loopback address; do not copy it into the store. |
| An unsupported item | Its name and why it has no same-agent path; do not translate it. |
| A missing stdio runtime | The server, the command it needs, and the store Dockerfile change; never install into the running sandbox. |
| A policy denial | The denied command and endpoint; add only the narrowest explicit policy or provider rule, or stop. |
| A parked workspace | The helper's sync state and next-command hint; download or discard only with consent. |
| A sandbox not `Ready` | The sandbox name, state, and the create or start output; do not attach a broader policy. |

Also stop for an ambiguous agent choice, a request to merge two agents'
configuration, an unreadable config, or any request to move an agent binary.

## Report

End with a short block any human can act on. Never include a credential value
or the literal provider-placeholder prefix. The block names host, image,
provider, sandbox, migrated, unsupported, verification, and next:

```text
Host: <OS/architecture; engine; OpenShell status>
Agent: <Maki | OpenCode | Claude Code>
Image: <base tag; derived tag, or "none">
Provider: <profile and provider names; credential source by name>
Sandbox: <name; state; policy>
Migrated: <items moved to the store, provider, or project>
Unsupported: <name — reason> (or "none")
Verification: <command -> observed result>
Next: <one safe next action>
```

## Invariants

These are the same rules as `AGENTS.md`; restate them, never relax them.

- The OpenShell sandbox is the security boundary. No host bind mounts; project
  files move with upload and download.
- No secrets through `--env` or `--env-from`. Model and service credentials go
  through OpenShell provider profiles; the sandbox sees only an opaque stand-in
  and the proxy substitutes the real value at approved endpoints.
- Never spell the literal provider-placeholder prefix in a file the agent can
  read. Describe it in prose instead.
- Egress stays deny-by-default. Every endpoint is an explicit policy or
  provider-profile decision; never use `tls: skip`, `access: full`, or a
  wildcard host to fix a denial.
- Sandbox processes stay non-root, uid/gid 1500, with the minimal filesystem
  policy.
- Maki and OpenCode never authenticate inside the sandbox. Do not run
  `maki auth login` or `opencode auth login` there, and do not set a provider
  base-URL override.
- Claude Code never authenticates inside the sandbox. Do not run `/login`,
  `claude auth`, or `claude setup-token` there; create a subscription token on
  the host only. Do not set `ANTHROPIC_BASE_URL` or an `apiKeyHelper`, and
  never mount or upload the host's `~/.claude`, `~/.claude.json`, or
  `~/.config/anthropic`.
- Personal config, runtimes, skills, commands, and plugins are image-build
  decisions, not installs into a running sandbox.
- Show planned host and destructive commands and ask before running them. Do
  not delete a sandbox with sessions or a parked workspace without reporting
  the loss.

## See also

- [`docs/ai/host-playbook.md`](host-playbook.md) — the shared host path,
  P0-P2.
- [`docs/ai/playbooks/maki.md`](playbooks/maki.md) — the Maki agent path,
  P0-P8.
- [`docs/ai/environment-playbook.md`](environment-playbook.md) — compose a
  same-agent environment store.
- [`docs/opencode-oss.md`](../opencode-oss.md) — the OpenCode path.
- [`docs/claude-oss.md`](../claude-oss.md) — the Claude path.
- [`docs/verification.md`](../verification.md) — the isolation checklist.
- [`docs/helper.md`](../helper.md) — shared helper commands and sync states.
- [`docs/providers.md`](../providers.md) — provider profiles and setup.
- [`docs/migrating-providers.md`](../migrating-providers.md) — provider
  credential stores and the OAuth limitation.
- [`docs/ai/references.md`](references.md) — upstream documentation index.
- [`docs/ai/document-contract.md`](document-contract.md) — the page contract
  this router follows.
