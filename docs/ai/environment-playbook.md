# Environment playbook: compose a personal agent environment

An ordered, shared procedure for moving a host agent's personal configuration
onto an osa base image. Maki, OpenCode, Claude Code, and Codex readers follow
the same stages: the steps name the selected agent's command and expected
output from the adapter table below, never a required vendor. The Maki
reference store is the worked example, not a prerequisite.

The **base image** is the selected agent's runtime plus the safety baseline
(`maki-agent:local`, `opencode-agent:local`, `claude-agent:local`, or
`codex-agent:local`, each built by its own `image build`). It declares no MCP
servers, installs no MCP-specific runtime, sets no personal UI preference, and
starts every session with the agent's sandbox-boundary permission mode. The
**environment store** is a Docker build context you own, outside this
repository, whose `Dockerfile` builds `FROM` the selected base. You select the
resulting **derived image** through that helper's existing `image` setting.

The worked example is
[`examples/environments/reference/`](../../examples/environments/reference/);
copy it outside the repository for the Maki row. Never edit any agent's base
image context (`examples/maki-image/`, `opencode-oss/image/`,
`claude-oss/image/`, or `codex-oss/image/`) for a personal choice.

After every stage, run its verification and **stop on a mismatch**: report the
command and its output instead of working around it or continuing.

## Agent adapter table

Use the row for the agent you already run. Each row links that agent's reference
for the full configuration surface; later stages name the selected row instead
of repeating its commands.

| Agent | Base image | Helper config | Store config | Image setting | Provider setup | MCP config | Skills and plugins | Limitations |
|---|---|---|---|---|---|---|---|---|
| Maki | [`maki-agent:local`](reference/maki.md) (`maki-oss image build`) | `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml` | `/sandbox/.config/maki/` | `image` / `MAKI_OSS_IMAGE` | `maki-oss provider setup` | `~/.config/maki/mcp.toml`, provider `mcp-<name>`; `maki-oss mcp status` | skills, commands, and Lua plugins under `config/` | a store `init.lua` replaces the base file, so repeat `always_yolo = true` and the trust block; OAuth-only credentials have no path; profiles bind `/usr/local/bin/maki` |
| OpenCode | [`opencode-agent:local`](reference/opencode.md) (`opencode-oss image build`) | `${XDG_CONFIG_HOME:-$HOME/.config}/opencode-oss/config.toml` | `/sandbox/.config/opencode/` | `image` / `OPENCODE_OSS_IMAGE` | `opencode-oss provider setup` | `opencode.json` `mcp` key, provider `opencode-mcp-<name>`; `opencode-oss mcp status` | skills and commands under `config/`; plugins need a pinned runtime | a store `opencode.json` replaces the baked file, so repeat its `permissions` deny rules and update/share switches; an npm plugin that fetches at startup has no same-agent path; the base has no Node/Bun; OAuth-only credentials are unsupported |
| Claude Code | [`claude-agent:local`](reference/claude.md) (`claude-oss image build`) | `${XDG_CONFIG_HOME:-$HOME/.config}/claude-oss/config.toml` | `/sandbox/.claude/` plus `/sandbox/.claude.json` | `image` / `CLAUDE_OSS_IMAGE` | `claude-oss provider setup` (API key or host-created subscription token; attach only one) | `~/.claude.json` `mcpServers`, provider `claude-mcp-<name>`; `claude-oss mcp status` | skills and commands under `config/`; no plugin path | a store `.claude.json` replaces the base seed, so keep its onboarding and trust keys; keep the managed settings at least as strict; a subscription token is created on the host only; the base has no Node/Bun or ripgrep |
| Codex | [`codex-agent:local`](reference/codex.md) (`codex-oss image build`) | `${XDG_CONFIG_HOME:-$HOME/.config}/codex-oss/config.toml` | `/sandbox/.codex/config.toml` plus `/sandbox/.agents/skills/` | `image` / `CODEX_OSS_IMAGE` | `codex-oss provider setup` (host-only ChatGPT login; no `--env`, `--from`, or `--file`) | `$CODEX_HOME/config.toml` or `~/.codex/config.toml` `[mcp_servers.<name>]`, provider `codex-mcp-<name>`; `codex-oss mcp status` | skills under `config/skills/`; plugins are disabled | the managed provider, base URL, and traffic switches are root-owned and outrank the store config; only `[mcp_servers.<name>]` tables are read, so inline or dotted definitions are `unreadable`; no API-key path and no `auth.json`; login happens on the host; the base has no Node/Bun |

Only the Maki reference store is a built, worked example; the OpenCode,
Claude Code, and Codex rows describe documented shapes of the same pattern and
link their agent references.

## Stage 1 — Audit the host

Read the host's agent configuration and record what exists. Do not copy
anything yet, and never print a credential value. Use only the selected row;
these source adapters are common, so adapt the paths if your agent stores config
elsewhere:

| Source | Read | Notes |
|---|---|---|
| Maki host | `~/.config/maki/mcp.toml`, `~/.config/maki/init.lua`, `~/.config/maki/permissions.toml` | MCP servers, UI/YOLO/trust preferences, permission rules |
| Maki project | `.maki/mcp.toml`, `.maki/permissions.toml`, `.maki/skills/` | Project-local; usually stays with the project |
| OpenCode host | `~/.config/opencode/opencode.json` (`mcp` key), plugin and skill directories | Server definitions and personal tooling |
| OpenCode project | `.opencode/opencode.json`, `.opencode/` | Project-local; usually stays with the project |
| Claude Code host | `~/.claude/settings.json`, `~/.claude/skills/`, `~/.claude/commands/`, `~/.claude.json` (`mcpServers`) | Settings, MCP servers, skills, and commands |
| Claude Code project | `.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md` | Project-local; uploads with the project |
| Codex host | `$CODEX_HOME/config.toml` (else `~/.codex/config.toml`), `[mcp_servers.<name>]` tables, `~/.agents/skills/` if present | MCP servers, user config, and skills; the store target is `/sandbox/.agents/skills/`, and the host layout is not copied |
| Codex project | `AGENTS.md` and the project's own config | Project-local; uploads with the project |
| Generic | the agent's TOML/JSON MCP file plus its global preference file | Map names and shapes by hand |
| Credential stores | Maki `~/.local/state/maki/auth/`, OpenCode `~/.local/share/opencode/auth.json`, Claude host `ANTHROPIC_API_KEY` or a host-created `CLAUDE_CODE_OAUTH_TOKEN`, Codex host-only `codex-oss provider setup` | Existence only; the setup wizard reads these, this procedure never does. Codex has no store credential path: never read `~/.codex/auth.json`, and never copy, upload, or mount the host `~/.codex` |

Useful read-only commands (drop the `jq` form if `jq` is not installed and
read the file directly):

```sh
test -f ~/.config/maki/mcp.toml && sed -n '1,120p' ~/.config/maki/mcp.toml
test -f ~/.config/maki/init.lua && sed -n '1,80p' ~/.config/maki/init.lua
test -f ~/.config/opencode/opencode.json && jq '.mcp // {}' ~/.config/opencode/opencode.json
test -f ~/.claude.json && jq '.mcpServers // {}' ~/.claude.json
test -f "${CODEX_HOME:-$HOME/.codex}/config.toml" \
  && sed -n '1,120p' "${CODEX_HOME:-$HOME/.codex}/config.toml"
```

**Verify:** the audit lists each server, runtime/package, preference, and
credential source by name for the selected agent. Shell output that could
contain a value is filtered before it is quoted or recorded.

## Stage 2 — Classify every item

Put each audited item in exactly one bucket:

| Class | Belongs in | Rule |
|---|---|---|
| Portable config | the selected row's store config | Copy the definition, never a literal secret |
| Package or runtime | store `Dockerfile` | Pin the version and install it at image build; the helper never installs into a running sandbox |
| Credential | OpenShell provider profile | Value stays on the host; the store and sandbox see only a `${VAR}` name |
| Unsupported | the report, not the store | Name it and explain why; never drop it silently |
| Project-local | the uploaded project | Keep `.maki/`, `.opencode/`, `.claude/`, or `AGENTS.md` with the project unless it needs a package or runtime the image lacks |

Classification rules:

- **Credentials never enter the store.** An `api_key`, token, OAuth secret, or
  literal header value in a host config is migration input for the selected
  row's provider setup (`maki-oss provider setup --env <VAR>`,
  `opencode-oss provider setup`, `claude-oss provider setup`, or
  `codex-oss provider setup`) or a shipped profile. Replace it with a `${VAR}`
  reference that names the provider-injected variable. The endpoint and the
  real value stay in the OpenShell provider profile.
- **A runtime is an image decision.** A stdio server's `command` array names a
  runtime (for example `bunx`). Install the runtime and pre-install the package
  in the store's Dockerfile as uid 1500, so a session resolves installed files
  only and never fetches from a registry at run time. Egress stays
  deny-by-default; do not add an npm endpoint to make a session install.
- **Unsupported means reported.** A plugin format, hook, or command the
  sandbox agent cannot load is reported by name in the final summary (for
  example "OpenCode plugin `foo` has no same-agent path"). If a project-local
  server needs a runtime the image lacks, report that server and runtime by
  name in the final summary; the helper never installs a package into a running
  sandbox. The selected row's `mcp status` reports the runtime gate for the
  servers it checks.
- **Personal preferences are opt-in.** Use the selected row's preference files:
  Maki's `init.lua`, OpenCode's `opencode.json` and `tui.json`, Claude Code's
  `settings.json`, or the Codex user config the store can carry. The base
  already sets each agent's sandbox-boundary permission mode and keeps its
  guardrails; a store file that replaces a base file must repeat those settings.
  For the Maki worked example, the base sets `always_yolo = true` and keeps the
  folder-trust block, and a store's `init.lua` replaces the base file, so repeat
  both when you add preferences (the reference store does). The base's
  `permissions.toml` deny rules are inherited and are not relaxed by YOLO.

**Verify:** every audited item has a bucket, every adapter row has a
destination or a reported-unsupported rule, every credential has a named
provider path, and no literal credential appears in the draft store.

## Stage 3 — Generate the store

Create a directory outside this repository with this shape:

```text
my-environment/
├── Dockerfile
├── .dockerignore
├── README.md
└── config/
    └── <the selected row's config files>
```

For the Maki row, start from the reference store:

```sh
mkdir -p ~/code
cp -R examples/environments/reference ~/code/my-environment
```

For another agent, create the same shape with that row's config files. Then
edit only your copy:

- **`Dockerfile`** — `FROM` the selected row's base image, then the pinned
  package/runtime installs and the row's copy target:
  - Maki: `COPY --chown=sandbox:sandbox config/… /sandbox/.config/maki/…`.
  - OpenCode: `config/` to `/sandbox/.config/opencode/`.
  - Claude Code: `config/` to `/sandbox/.claude/` and `config/` to
    `/sandbox/.claude.json`, preserving the base seed's onboarding and trust
    keys.
  - Codex: `config/config.toml` to `/sandbox/.codex/config.toml` and
    `config/skills/` to `/sandbox/.agents/skills/`.

  Install runtimes as root, then return to the inherited `USER sandbox` before
  installing packages into `/sandbox`.
- **MCP config** — only servers you classified as portable config. Use `${VAR}`
  for every header/environment value and leave the base's deny rules to the
  base. Maki uses `config/mcp.toml`; OpenCode uses the `mcp` key in
  `config/opencode.json`; Claude Code uses `config/.claude.json`; Codex uses
  `[mcp_servers.<name>]` tables in `config/config.toml`.
- **Preferences** — the selected row's preference file:
  - Maki `config/init.lua` — the trust block, `always_yolo = true`, and the
    preferences you want. The file replaces the base's `init.lua`, so repeat
    both shared settings: headless runs need the trust block, and without
    `always_yolo` the store reverts to in-sandbox permission prompts.
  - OpenCode `config/opencode.json` and `config/tui.json` — repeat the baked
    file's `permissions` deny rules and update/share switches.
  - Claude Code `config/settings.json` and `config/.claude.json` — keep the
    managed settings at least as strict and preserve the seed's trust keys.
  - Codex user config — keep the root-owned managed config in force; a store
    cannot override its provider, base URL, or traffic switches.
- **Maki `config/providers.toml`** — optional host-only Maki provider settings:
  custom OpenAI-compatible providers, plan selection (for example Z.AI
  `coding`), or explicit model rows. The base seeds the models.dev catalog, so
  most providers need no entry here; add one only for a provider or plan the
  catalog cannot express. Copy it to
  `/sandbox/.config/maki/providers.toml` in the store's Dockerfile.
- **`.dockerignore`** — exclude `.git`, local credential files, and host-only
  profile copies so they cannot enter the image. The reference file is a safe
  starting point.
- **`README.md`** — record the build command, the tag, the profiles the store
  needs, and any unsupported item, so the next person does not rediscover it.

**Verify:** the store contains no credential value; every `${VAR}` has a
provider profile or a `provider setup --env <VAR>` step; the Dockerfile pins
each installed version; `.dockerignore` covers local secrets and profiles; the
selected row's copy target exists in the image.

## Stage 4 — Build and select

Build the selected agent's base, then the store, with the configured container
engine. The Maki commands are the example; substitute the row:

```sh
maki-oss image build
docker build -t maki-agent:my-environment ~/code/my-environment
```

The other bases build the same way:

```sh
opencode-oss image build   # opencode-agent:local
claude-oss image build     # claude-agent:local
codex-oss image build      # codex-agent:local
```

Select the derived image through the existing setting — no new command:

```sh
# in ${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml
image = "maki-agent:my-environment"
```

Or per invocation: `maki-oss --image maki-agent:my-environment …` and
`MAKI_OSS_IMAGE=maki-agent:my-environment maki-oss …`. The other rows use their
helper config path and environment variable from the adapter table
(`OPENCODE_OSS_IMAGE`, `CLAUDE_OSS_IMAGE`, or `CODEX_OSS_IMAGE`).

**Verify:**

```sh
docker run --rm maki-agent:my-environment maki --version
docker run --rm --entrypoint sh maki-agent:my-environment -c 'command -v <runtime>'
maki-oss status
```

Substitute each runtime the store installs for `<runtime>` (the reference store
uses `bun`). Expected: the same agent version as the selected base; every
runtime resolves; the selected helper's `status` reports the configured image
tag. Existing sandboxes keep their old image until they are deleted and
recreated.

## Stage 5 — Verify the boundary

Create or recreate the project sandbox from the derived image, attach the
profiles classified in Stage 2, and read the readiness table with the selected
helper:

```sh
# If the sandbox predates the store, delete it first (state is lost):
# maki-oss rm --yes
maki-oss up
maki-oss provider attach mcp-<server>   # one per server/profile from Stage 2
maki-oss mcp status
```

The other rows use their own helper:

```sh
opencode-oss provider attach opencode-mcp-<server>
opencode-oss mcp status
claude-oss provider attach claude-mcp-<server>
claude-oss mcp status
codex-oss provider attach codex-mcp-<server>
codex-oss mcp status
```

The four provider naming conventions are `mcp-<name>`,
`opencode-mcp-<name>`, `claude-mcp-<name>`, and `codex-mcp-<name>`. Expected:
one line per server. `sandbox=ok` means the store's config reached the image;
`runtime=ok` means the packaged runtime resolves; `provider=ok` means the
profile is attached; `endpoint=ok` means the HTTP endpoint is in the effective
policy. A missing server or runtime prints the environment-image build guidance
and this playbook — it never asks for a base rebuild.

Finish with a tool-level check and the isolation checklist:

```sh
maki-oss run --no-sync "List every MCP tool available to you, one per line. Do not call any tool."
```

Expected: one `<server>__<tool>` name per tool on every enabled server. Then
run the selected agent's verification page:
[`docs/ai/verification/maki.md`](verification/maki.md),
[`docs/ai/verification/opencode.md`](verification/opencode.md),
[`docs/ai/verification/claude.md`](verification/claude.md), or
[`docs/ai/verification/codex.md`](verification/codex.md). Stop and report any
mismatch.

**Verify the credential boundary one last time:** search the store and the
image for literal credential material (known API-key prefixes and
bearer-token shapes) and confirm the only matches are documentation about the
pattern; inspect the selected helper's `mcp status` output for placeholders, not
values. Delete any scratch sandbox created for the check.

## Report format

End with a short report any human can act on:

```text
Agent: <agent>
Store: <path or tag>
Base image: <base image>
Classified: <n> portable config, <n> package/runtime, <n> credential, <n> project-local
Provider setup: <agent-specific provider setup for each credential>
Unsupported: <name — reason> (or "none")
Verification: <each command and its observed result>
Credential boundary: <mcp status check -> observed placeholders, not values>
Known limits: <for example host-oracle false positives, or "none">
```

## Paste-able prompt for a host coding agent

```text
Follow docs/ai/environment-playbook.md in the osa repository and build me
a personal environment store outside the repository.

1. Use the adapter row for my agent: <Maki | OpenCode | Claude Code | Codex>.
   Audit that agent's host config (its global config and any project-local
   configuration). List every MCP server, runtime or package, personal
   preference, and credential source by name. Never print or copy a credential
   value.
2. Classify each item as portable config, package/runtime, credential,
   project-local, or unsupported. For every credential, name the OpenShell
   provider profile and that agent's provider setup step. Report unsupported
   items by name instead of dropping them.
3. Use the matching adapter row's base image and store config. For Maki, copy
   examples/environments/reference to a directory I name and edit only that
   copy; for another agent, create the same store shape with that row's config.
   Pin runtime installs in the Dockerfile, use ${VAR} only for credentials, and
   write a .dockerignore that excludes local secrets and host-only profiles.
4. Build the base and the store, set that helper's `image` setting to the
   derived tag, and verify with the agent's version check, the runtime check,
   the helper's status, and the helper's mcp status.
5. Stop and report the exact command and output on any mismatch. Do not translate
   configuration between agents. Do not relax the security invariants: no host
   bind mounts, no secrets in the store or `--env`, deny-by-default egress,
   non-root sandbox user, and no in-sandbox authentication for any agent.
```

## Invariants (never relax these to make a step work)

- No host bind mounts; project files move with upload/download.
- No secrets in the store, the image, `--env`, or any file the sandbox reads.
  Credentials come from OpenShell provider profiles.
- Egress stays deny-by-default; add the narrowest policy/profile rule, never a
  wildcard host or `tls: skip`.
- Sandbox processes stay non-root (uid/gid 1500).
- No agent authenticates inside the sandbox: never run `maki auth login`,
  `opencode auth login`, `claude /login`, `claude auth`, `claude setup-token`,
  or `codex login` there, and never set a provider base-URL override.
- Never mount or upload a host agent's configuration or credential store,
  including `~/.claude/`, `~/.claude.json`, `~/.codex/`, or an `auth.json`.
- Do not edit any agent's base image context for a personal choice. The Maki
  base path (`examples/maki-image/`) is only the worked-example reference; copy
  the matching store shape and change the copy.

## See also

- [`docs/ai/reference/maki.md`](reference/maki.md) — Maki configuration,
  credentials, profiles, MCP, and store shape.
- [`docs/ai/reference/opencode.md`](reference/opencode.md) — OpenCode
  configuration, credentials, profiles, MCP, and store shape.
- [`docs/ai/reference/claude.md`](reference/claude.md) — Claude Code
  configuration, credentials, profiles, MCP, and store shape.
- [`docs/ai/reference/codex.md`](reference/codex.md) — Codex configuration,
  credentials, profiles, MCP, and store shape.
- [`examples/environments/reference/README.md`](../../examples/environments/reference/README.md)
  — the Maki worked example.
- [`docs/ai/onboarding.md`](onboarding.md) — choose the agent path.
- [`docs/helper.md`](../helper.md) — shared helper commands and configuration.
- [`docs/providers.md`](../providers.md) — provider profiles and setup.
