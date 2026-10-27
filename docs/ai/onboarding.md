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
their host into an osa OpenShell sandbox. It routes Maki, OpenCode, Claude Code, and Codex without changing which agent
the user runs.

**The one rule: keep the same coding agent.** osa moves the agent you already
run into its own sandbox — Maki to `maki-oss`, OpenCode to `opencode-oss`,
Claude Code to `claude-oss`, and Codex to `codex-oss`. A cross-agent switch (for example OpenCode to
`maki-oss`) is not migration and is out of scope for onboarding.

The agent reading this page is the onboarding assistant, not necessarily the
agent being onboarded. Do not substitute your own agent, configuration,
credential store, or defaults for the user's. One agent per run: when the host
has more than one configured, ask which agent to onboard first and do not merge
their configurations.

This is a router. Commands and per-agent detail stay in the linked pages; do
not duplicate or improvise them here. The page is checked as a document, not
as a live four-agent run. The agent pages record their own verified runs.

## Copy this prompt

Replace both placeholders and send the block to a coding agent on the host.

```text
Onboard the coding agent I already run into an osa OpenShell sandbox.

If this host already has an osa clone, ask me for its path. Otherwise clone
https://github.com/wKich/osa.git into a directory I choose (ask me before
writing), then work from that repository root.

Project: <absolute path to my project>
My host agent: <Maki | OpenCode | Claude Code | Codex>

Use the same agent I already run. Do not switch to a different agent, and do
not translate my configuration to another agent. Read AGENTS.md,
docs/ai/onboarding.md, the shared docs/ai/host-playbook.md, and the playbook for
my agent under docs/ai/playbooks/. Audit my host and configuration first
(read-only), and show me the plan and the exact commands before changing
anything. Ask before installing host tooling, editing my shell, deleting or
recreating a sandbox, or discarding work. Never ask me to paste an API key or
token into this chat; name the environment variable or credential store I should
populate instead. Stop and report the command and output on any failed gate,
version mismatch, or unsupported item. Complete the canonical phases P0 through
P8, ending with the verification page, and finish with the report format from
the guide.
```

## Task index

| Need | Start here |
|---|---|
| Setup on a bare host | Start with the shared [host playbook](host-playbook.md) (P0-P2), then the user's agent playbook from [Phase map](#phase-map) |
| Put a helper or agent binary on `PATH` | [Add a binary](#add-a-binary) |
| Create or inspect an OpenShell sandbox | P4-P5 and the matching agent page |
| Migrate configs: MCP, settings, skills, commands, plugins | [Same-agent migration matrix](#same-agent-migration-matrix) |
| Migrate credentials | [Same-agent migration matrix](#same-agent-migration-matrix) and `provider setup` in the agent page |
| Move an existing project and its local configs | [Same-agent migration matrix](#same-agent-migration-matrix), project-local row |
| Understand a failure | [Stop if](#stop-if) and [Report](#report) |

## Inputs

- The repository URL is `https://github.com/wKich/osa.git`; clone it when the
  host does not already have the repository.
- The project path, or "empty workspace" when there is no project.
- The host agent and how it is invoked: `maki`, `opencode`, `claude`, or
  `codex`. For Codex, also the host `codex` CLI used once for the ChatGPT
  login.
- Read-only audit facts: OS and architecture, container engine, `openshell
  status`, the agent version, and the paths that exist under the agent's
  config and credential stores.
- Consent for host installs, shell edits, sandbox deletion, or discarding
  uncommitted work. Audit before asking for any mutation.
- No credential value. Name the environment variable or credential store to
  populate; never ask for, echo, or copy a secret.

## Phase map

The canonical gate for every phase is defined once in
[`document-contract.md`](document-contract.md#phase-ids). This table only routes
the phase to each agent's command and page; if a cell and the contract disagree,
the contract wins. `P0` is read-only: record what is present and its version;
an absent tool on a bare host is expected and is installed in `P1`.

| Phase | Maki (`maki-oss`) | OpenCode (`opencode-oss`) | Claude (`claude-oss`) | Codex (`codex-oss`) |
|---|---|---|---|---|
| P0 Preflight / audit | [host playbook](host-playbook.md) Phase 1; optional `maki --version` | host playbook Phase 1 | host playbook Phase 1 | host playbook Phase 1; `codex --version` |
| P1 Host tools | host playbook Phase 2 | host playbook Phase 2 | host playbook Phase 2 | host playbook Phase 2; install host `codex` |
| P2 Repository + helper | host playbook Phase 3; [Shell preparation](playbooks/maki.md#shell-preparation); `command -v maki-oss` | host playbook Phase 3; `command -v opencode-oss` | host playbook Phase 3; `command -v claude-oss` | host playbook Phase 3; `command -v codex-oss` |
| P3 Image | `maki-oss image build` ([Phase 1](playbooks/maki.md)) | `opencode-oss image build` ([Phase 1](playbooks/opencode.md)) | `claude-oss image build` ([Phase 1](playbooks/claude.md)) | `codex-oss image build` ([Phase 1](playbooks/codex.md)) |
| P4 Provider | `maki-oss provider setup` (or `--stdin --profile ID`); `doctor` ([Phase 2](playbooks/maki.md)) | `opencode-oss provider setup` (or `--stdin --profile ID`); `doctor` ([Phase 2](playbooks/opencode.md)) | `claude-oss provider setup` (or `--stdin --profile ID`); `doctor`; host token only when needed ([Phase 2](playbooks/claude.md)) | `codex-oss provider setup`; `doctor`; host-only ChatGPT login, no stdin form ([Phase 2](playbooks/codex.md)) |
| P5 Sandbox | `maki-oss up` ([Phases 3-4](playbooks/maki.md)) | `opencode-oss up` ([Phases 3-4](playbooks/opencode.md)) | `claude-oss up` ([Phases 3-4](playbooks/claude.md)) | `codex-oss up` ([Phases 3-4](playbooks/codex.md)) |
| P6 Verify | `osa health <sandbox>`; `maki-oss mcp status` and [verification](verification/maki.md) ([Phase 5](playbooks/maki.md)) | `osa health <sandbox>`; `opencode-oss mcp status` and [verification](verification/opencode.md) ([Phase 5](playbooks/opencode.md)) | `osa health <sandbox>`; `claude-oss mcp status` and [verification](verification/claude.md) ([Phase 5](playbooks/claude.md)) | `osa health <sandbox>`; `codex-oss mcp status` and [verification](verification/codex.md) ([Phase 5](playbooks/codex.md)) |
| P7 Run | `maki-oss` or `maki-oss run "<task>"` ([Phase 6](playbooks/maki.md)) | `opencode-oss` or `opencode-oss run "<task>"` ([Phase 6](playbooks/opencode.md)) | `claude-oss` or `claude-oss run "<task>"` ([Phase 6](playbooks/claude.md)) | `codex-oss` or `codex-oss run "<task>"` ([Phase 6](playbooks/codex.md)) |
| P8 Report | collect the patch, then `maki-oss status` ([Phase 7](playbooks/maki.md)) | collect the patch, then `opencode-oss status` ([Phase 7](playbooks/opencode.md)) | collect the patch, then `claude-oss status` ([Phase 7](playbooks/claude.md)) | collect the patch, then `codex-oss status` ([Phase 7](playbooks/codex.md)) |

`P1` covers the shared host tools plus any host-only agent CLI: the host
`codex` CLI for the one-time ChatGPT login, and, optionally, a host `maki` CLI.
A CLI baked into the image (OpenCode, Claude Code, and the sandbox Maki and
Codex binaries) is verified at `P3`, not installed on the host.

`P4` keeps the wizard as the human path. Scripted and dashboard setup use
`--stdin` with `--profile ID` on the agent's helper, or
`osa provider setup TAG --profile ID`, which passes the credential to the same
stdin handoff; the value never appears in argv or shell history. Codex is the
terminal-only exception: `codex-oss provider setup` is a host ChatGPT login,
has no `--stdin` form, and the dashboard shows that command instead of a
wizard.

Local numbering stays where it is. This table maps the shared host playbook and
the Maki, OpenCode, Claude, and Codex agent playbooks to the canonical IDs.

| Canonical | Shared host playbook | Maki agent playbook | OpenCode agent playbook | Claude agent playbook | Codex agent playbook |
|---|---|---|---|---|---|
| P0 | Phase 1 | Phase 0 | - | - | Phase 0 |
| P1 | Phase 2 | Phase 0 | - | - | Phase 0 |
| P2 | Phase 3 | Shell preparation | - | - | - |
| P3 | - | Phase 1 | Phase 1 | Phase 1 | Phase 1 |
| P4 | - | Phase 2 | Phase 2 | Phase 2 | Phase 2 |
| P5 | - | Phases 3-4 | Phases 3-4 | Phases 3-4 | Phases 3-4 |
| P6 | - | Phase 5 | Phase 5 | Phase 5 | Phase 5 |
| P7 | - | Phase 6 | Phase 6 | Phase 6 | Phase 6 |
| P8 | - | Phase 7 | Phase 7 | Phase 7 | Phase 7 |

## Shared operator surface

The shared `osa` command spans every front-end. None of these is a phase or a
setup gate; use them beside the agent path.

```sh
osa dashboard --open                  # web UI: Projects, Setup, Rules
osa health <sandbox>                  # idle stop, MCP readiness, doctor checks
osa providers                         # setup profiles and providers per agent
osa provider setup TAG --profile ID   # credential on stdin, no prompt
osa images                            # each agent's base image, present or missing
osa image build TAG                   # build an agent's base image
```

- **Dashboard boundary.** `osa dashboard` binds loopback by default; a
  non-loopback bind requires an explicit token. The session token gates
  mutations and sensitive reads (patches, denials, streams), and `--read-only`
  refuses every mutation. The dashboard is not a credential store: a provider
  credential typed into the Setup wizard travels only to `osa provider setup`'s
  stdin handoff, which redacts it from the result. Codex shows its terminal
  login command instead of a wizard. Details:
  [`dashboard/README.md`](../../dashboard/README.md).
- **Health is read-only.** `osa health <sandbox>` reports the same idle-stop,
  MCP-readiness, and doctor results as `status`, `mcp status`, and `doctor`,
  and never starts a sandbox.
- **Images.** `osa images` reports each agent's base tag, engine, presence, and
  configured image; `osa image build TAG` builds only that base. The dashboard
  Images section builds base images only; an environment-store build stays a
  terminal `docker build` (see the
  [environment playbook](environment-playbook.md)).

## Same-agent migration matrix

Each cell reads **source → destination · verification**. The destination is
the same agent's environment store, provider, or uploaded project. A global
config change is an image rebuild; it is never an install into a running
sandbox. Copy definitions, never a credential value. Replace every secret with
the provider's environment-variable reference.

| Item | Maki | OpenCode | Claude | Codex |
|---|---|---|---|---|
| Credentials | `~/.local/state/maki/auth/` → `maki-*` provider via `maki-oss provider setup` · `openshell provider list`, `maki-oss doctor` | `~/.local/share/opencode/auth.json` → `opencode-*` provider via `opencode-oss provider setup` · `openshell provider list`, `opencode-oss doctor` | host `ANTHROPIC_API_KEY` or a host-created subscription token → `claude-anthropic` or `claude-anthropic-oauth` · `claude-oss doctor`; attach only one | host ChatGPT login in a throwaway `CODEX_HOME` → `codex-chatgpt` via `codex-oss provider setup` · `openshell provider list`, `codex-oss doctor` |
| MCP | `~/.config/maki/mcp.toml` → store `config/mcp.toml`, baked to `/sandbox/.config/maki/mcp.toml` · `maki-oss mcp status` | `~/.config/opencode/opencode.json` `mcp` key → store `config/opencode.json`, baked to `/sandbox/.config/opencode/opencode.json` · `opencode-oss mcp status` | `~/.claude.json` `mcpServers` → store config baked to `/sandbox/.claude.json` · `claude-oss mcp status` | `$CODEX_HOME/config.toml` (else `~/.codex/config.toml`) `[mcp_servers.<name>]` → store `/sandbox/.codex/config.toml` · `codex-oss mcp status`; provider `codex-mcp-<name>` |
| Settings | `~/.config/maki/init.lua`, `permissions.toml`, `providers.toml`, `plugin.toml` → store `config/` · rebuild and `maki-oss doctor` | `~/.config/opencode/opencode.json`, `tui.json` → store `config/` · rebuild and `opencode debug config --standalone --print-logs` | `~/.claude/settings.json` → store config baked to `/sandbox/.claude/settings.json` · rebuild; check settings sources in a session | `$CODEX_HOME/config.toml` (else `~/.codex/config.toml`) → store `/sandbox/.codex/config.toml` · rebuild and `codex-oss doctor` |
| Skills | `~/.config/maki/skills/` → store `config/skills/`, baked to `/sandbox/.config/maki/skills/` · `test -f` in the built image | `~/.config/opencode/skills/` → store `config/skills/`, baked to `/sandbox/.config/opencode/skills/` · `test -f` in the built image | `~/.claude/skills/` → store `config/skills/`, baked to `/sandbox/.claude/skills/` · `test -f` in the built image | no recorded host source → store `/sandbox/.agents/skills/` when baked · `test -f` in the built image |
| Commands | `~/.config/maki/commands/` → store `config/commands/`, baked to `/sandbox/.config/maki/commands/` · `test -f` and the command palette | `~/.config/opencode/commands/` → store `config/commands/`, baked to `/sandbox/.config/opencode/commands/` · `test -f` and `/` | `~/.claude/commands/` → store `config/commands/`, baked to `/sandbox/.claude/commands/` · `test -f` and `/` | no recorded same-agent path: report the command by name as unsupported |
| Plugins | `~/.config/maki/lua/` with `plugin.toml` → store `config/lua/` and `config/plugin.toml` · `/reload` and a tool call | Local `~/.config/opencode/plugins/` → store `config/plugins/` with a pinned runtime · load in a built image; an npm plugin that fetches at startup has no same-agent path, so report it by name | No supported path in this change: report the plugin name as unsupported; do not translate it. | no supported path in this change: report the plugin name as unsupported; do not translate it. |
| Project-local configuration | `.maki/` (MCP, permissions, skills, commands, Lua) stays with the project and uploads with it · `maki-oss mcp status` for servers | `.opencode/` and the project `opencode.json` stay with the project and upload with it · `opencode-oss mcp status` for servers | `.claude/`, `.mcp.json`, `CLAUDE.md`, or `AGENTS.md` stay with the project and upload with it · a headless run; keep secrets out of `.mcp.json` | `AGENTS.md` stays with the project and uploads with it · a headless run |

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
- **OAuth is not a migration to copy.** Report a Maki or OpenCode OAuth-only
  credential as unsupported and stop; never extract a token from another
  agent's store or from `~/.codex`. Claude Code accepts only a host-created
  subscription token or API key. Codex accepts only a host ChatGPT login in a
  throwaway `CODEX_HOME` through `codex-oss provider setup`. No agent logs in
  inside the sandbox.
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
command -v codex-oss
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

Adding another front-end means a new helper, image, policy, provider set,
docs, and spec. It is not onboarding and is out of scope here. Report it as a
new capability instead of bolting it onto an existing agent's paths.

**Agent binary paths are policy-bound.** Provider profiles authorize the exact
binaries `/usr/local/bin/maki`, `/usr/local/bin/opencode`,
`/usr/local/bin/claude`, and `/usr/local/bin/codex`. Moving, renaming, or wrapping an agent binary breaks
the egress binding; do not do it to make a command resolve.

## Stop if

Stop before the next phase when any condition below is true. Report the
condition, the failing command, and its output. Never work around it by
widening an invariant.

| Condition | What to report |
|---|---|
| A disconnected gateway | `openshell status` output; restart the gateway once, then stop if it remains disconnected. |
| A version mismatch | The expected pin and the observed version; do not tag, wrap, or install around it. |
| No usable credential for the chosen agent | Name the environment variable, store, or host-only login to populate; never extract an OAuth token. |
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
Agent: <Maki | OpenCode | Claude Code | Codex>
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
- Codex never authenticates inside the sandbox. Do not run `codex login`
  there, and never create, upload, or mount an `auth.json` or the host's
  `~/.codex`. The ChatGPT login happens on the host in a throwaway
  `CODEX_HOME` through `codex-oss provider setup`, the gateway keeps and
  refreshes the tokens, and the provider's base URL is never overridden.
- Personal config, runtimes, skills, commands, and plugins are image-build
  decisions, not installs into a running sandbox.
- Show planned host and destructive commands and ask before running them. Do
  not delete a sandbox with sessions or a parked workspace without reporting
  the loss.

## See also

- [`docs/ai/quickstart.md`](quickstart.md) — the one-page setup path for a
  human or an agent starting from a clean host.
- [`docs/ai/host-playbook.md`](host-playbook.md) — the shared host path,
  P0-P2.
- [`docs/ai/playbooks/maki.md`](playbooks/maki.md) — the Maki agent path,
  P0-P8.
- [`docs/ai/environment-playbook.md`](environment-playbook.md) — compose a
  same-agent environment store for any supported agent; the Maki store is the
  worked example.
- [`docs/ai/playbooks/opencode.md`](playbooks/opencode.md) — the OpenCode
  agent path, P3-P8.
- [`docs/ai/reference/opencode.md`](reference/opencode.md) — OpenCode
  configuration, profiles, sessions, MCP, and store shape.
- [`docs/ai/playbooks/claude.md`](playbooks/claude.md) — the Claude Code agent
  path, P3-P8.
- [`docs/ai/reference/claude.md`](reference/claude.md) — Claude Code
  configuration, credentials, profiles, sessions, MCP, and store shape.
- [`docs/ai/playbooks/codex.md`](playbooks/codex.md) — the Codex agent path,
  P0-P8.
- [`docs/ai/reference/codex.md`](reference/codex.md) — Codex configuration,
  credentials, profiles, sessions, MCP, and store shape.
- [`docs/ai/verification/maki.md`](verification/maki.md) — the Maki isolation
  checklist.
- [`docs/ai/verification/opencode.md`](verification/opencode.md) — the OpenCode
  verification record.
- [`docs/ai/verification/claude.md`](verification/claude.md) — the Claude Code
  verification record.
- [`docs/ai/verification/codex.md`](verification/codex.md) — the Codex
  verification record.
- [`docs/helper.md`](../helper.md) — shared helper commands and sync states.
- [`docs/helper.md#osa-health`](../helper.md#osa-health) — the health report
  the shared surface and dashboard use.
- [`dashboard/README.md`](../../dashboard/README.md) — the dashboard's
  Projects, Setup, and Rules views, its flags, and its security boundary.
- [`docs/providers.md`](../providers.md) — provider profiles and setup.
- [`docs/migrating-providers.md`](../migrating-providers.md) — provider
  credential stores and the OAuth limitation.
- [`docs/ai/references.md`](references.md) — upstream documentation index.
- [`docs/ai/document-contract.md`](document-contract.md) — the page contract
  this router follows.
