# Environment playbook: compose a personal agent environment

An ordered, agent-agnostic procedure for moving a host agent's personal
configuration onto the maki-oss base image. Any host coding agent — or a human
— can follow it: the steps name commands and expected output, never a required
vendor.

The **base image** (`maki-agent:local`, built by `maki-oss image build`) is the
agent runtime plus the safety baseline. It declares no MCP servers, installs no
MCP-specific runtime, and sets no personal UI or YOLO preference. The
**environment store** is a Docker build context you own, outside this
repository, whose `Dockerfile` builds `FROM` the base. You select the resulting
**derived image** through the helper's existing `image` setting.

The worked example is [`examples/environments/reference/`](../../examples/environments/reference/);
copy it outside the repository as your starting point. Never edit
`examples/maki-image/` for a personal choice — that context is shared.

After every stage, run its verification and **stop on a mismatch**: report the
command and its output instead of working around it or continuing.

## Stage 1 — Audit the host

Read the host's agent configuration and record what exists. Do not copy
anything yet, and never print a credential value. These source adapters are
common; adapt the paths if your agent stores config elsewhere:

| Source | Read | Notes |
|---|---|---|
| Maki | `~/.config/maki/mcp.toml`, `~/.config/maki/init.lua`, `~/.config/maki/permissions.toml` | MCP servers, UI/YOLO/trust preferences, permission rules |
| Maki (project) | `.maki/mcp.toml`, `.maki/permissions.toml`, `.maki/skills/` | Project-local; usually stays with the project |
| OpenCode | `~/.config/opencode/opencode.json` (`mcp` key), plugin and skill directories | Server definitions and personal tooling |
| OpenCode (project) | `.opencode/opencode.json`, `.opencode/` | Project-local; usually stays with the project |
| Generic | the agent's TOML/JSON MCP file plus its global preference file | Map names and shapes by hand |
| Credential stores | Maki `~/.local/state/maki/auth/`, OpenCode `~/.local/share/opencode/auth.json` | Existence only; the setup wizard reads these, this procedure never does |

Useful read-only commands (drop the `jq` form if `jq` is not installed and
read the file directly):

```sh
test -f ~/.config/maki/mcp.toml && sed -n '1,120p' ~/.config/maki/mcp.toml
test -f ~/.config/maki/init.lua && sed -n '1,80p' ~/.config/maki/init.lua
test -f ~/.config/opencode/opencode.json && jq '.mcp // {}' ~/.config/opencode/opencode.json
```

**Verify:** the audit lists each server, runtime/package, preference, and
credential source by name. Shell output that could contain a value is filtered
before it is quoted or recorded.

## Stage 2 — Classify every item

Put each audited item in exactly one bucket:

| Class | Belongs in | Rule |
|---|---|---|
| Portable config | store `config/mcp.toml`, `config/init.lua`, `config/providers.toml` | Copy the definition, never a literal secret |
| Package or runtime | store `Dockerfile` | Pin the version and install it at image build; the helper never installs into a running sandbox |
| Credential | OpenShell provider profile | Value stays on the host; the store and sandbox see only a `${VAR}` name |
| Unsupported | the report, not the store | Name it and explain why; never drop it silently |
| Project-local | the uploaded project | Keep `.maki/` / `.opencode/` with the project unless it needs a package or runtime the image lacks |

Classification rules:

- **Credentials never enter the store.** An `api_key`, token, OAuth secret, or
  literal header value in a host config is migration input for
  `maki-oss provider setup --env <VAR>` or a shipped profile. Replace it with a
  `${VAR}` reference that names the provider-injected variable. The endpoint
  and the real value stay in the OpenShell provider profile.
- **A runtime is an image decision.** A stdio server's `command` array names a
  runtime (for example `bunx`). Install the runtime and pre-install the package
  in the store's Dockerfile as uid 1500, so a session resolves installed files
  only and never fetches from a registry at run time. Egress stays
  deny-by-default; do not add an npm endpoint to make a session install.
- **Unsupported means reported.** A plugin format, hook, or command the
  sandbox agent cannot load is reported by name in the final summary (for
  example "OpenCode plugin `foo` has no Maki equivalent"). If a project-local
  server needs a runtime the image lacks, report that server and runtime by
  name in the final summary; the helper never installs a package into a running
  sandbox. `maki-oss mcp status` reports the runtime gate for the servers it
  checks.
- **Personal preferences are opt-in.** `always_yolo`, compact-UI settings, and
  similar behavior belong in the store's `init.lua`; the base keeps only the
  folder-trust block. The base's `permissions.toml` deny rules are inherited and
  are not relaxed by YOLO.

**Verify:** every audited item has a bucket, every credential has a named
provider path, and no literal credential appears in the draft store.

## Stage 3 — Generate the store

Create a directory outside this repository with this shape:

```text
my-environment/
├── Dockerfile
├── .dockerignore
├── README.md
└── config/
    ├── mcp.toml
    ├── init.lua
    └── providers.toml
```

Start from the reference store:

```sh
mkdir -p ~/code
cp -R examples/environments/reference ~/code/my-environment
```

Then edit only your copy:

- **`Dockerfile`** — `FROM maki-agent:local`, then the pinned package/runtime
  installs and `COPY --chown=sandbox:sandbox config/… /sandbox/.config/maki/…`.
  Install runtimes as root, then return to the inherited `USER sandbox` before
  installing packages into `/sandbox`.
- **`config/mcp.toml`** — only servers you classified as portable config. Use
  `${VAR}` for every header/environment value and leave `permissions.toml` to
  the base.
- **`config/init.lua`** — the trust block plus the preferences you want. Keep
  the trust block intact; headless runs need it.
- **`config/providers.toml`** — optional host-only Maki provider settings:
  custom OpenAI-compatible providers, plan selection (for example Z.AI
  `coding`), or explicit model rows. The base seeds the models.dev catalog, so
  most providers need no entry here; add one only for a provider or plan the
  catalog cannot express. Copy it to `/sandbox/.config/maki/providers.toml`
  in the store's Dockerfile.
- **`.dockerignore`** — exclude `.git`, local credential files, and host-only
  profile copies so they cannot enter the image. The reference file is a safe
  starting point.
- **`README.md`** — record the build command, the tag, the profiles the store
  needs, and any unsupported item, so the next person does not rediscover it.

**Verify:** the store contains no credential value; every `${VAR}` has a
provider profile or a `provider setup --env <VAR>` step; the Dockerfile pins
each installed version; `.dockerignore` covers local secrets and profiles.

## Stage 4 — Build and select

Build the base, then the store, with the configured container engine:

```sh
maki-oss image build
docker build -t maki-agent:my-environment ~/code/my-environment
```

Select the derived image through the existing setting — no new command:

```sh
# in ${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml
image = "maki-agent:my-environment"
```

Or per invocation: `maki-oss --image maki-agent:my-environment …` and
`MAKI_OSS_IMAGE=maki-agent:my-environment maki-oss …`.

**Verify:**

```sh
docker run --rm maki-agent:my-environment maki --version
docker run --rm --entrypoint sh maki-agent:my-environment -c 'command -v <runtime>'
maki-oss status
```

Substitute each runtime the store installs for `<runtime>` (the reference store
uses `bun`). Expected: the same Maki version as the base; every runtime resolves;
`maki-oss status` reports the configured image tag. Existing
sandboxes keep their old image until they are deleted and recreated.

## Stage 5 — Verify the boundary

Create or recreate the project sandbox from the derived image, attach the
profiles classified in Stage 2, and read the readiness table:

```sh
# If the sandbox predates the store, delete it first (state is lost):
# maki-oss rm --yes
maki-oss up
maki-oss provider attach mcp-<server>   # one per server/profile from Stage 2
maki-oss mcp status
```

Expected: one line per server. `sandbox=ok` means the store's config reached
the image; `runtime=ok` means the packaged runtime resolves; `provider=ok`
means the profile is attached; `endpoint=ok` means the HTTP endpoint is in the
effective policy. A missing server or runtime prints the environment-image
build guidance and this playbook — it never asks for a base rebuild.

Finish with a tool-level check and the isolation checklist:

```sh
maki-oss run --no-sync "List every MCP tool available to you, one per line. Do not call any tool."
```

Expected: one `<server>__<tool>` name per tool on every enabled server. Then
run the relevant checks in [`docs/verification.md`](../verification.md). Stop
and report any mismatch.

**Verify the credential boundary one last time:** search the store and the
image for literal credential material (known API-key prefixes and
bearer-token shapes) and confirm the only matches are documentation about the
pattern; inspect `maki-oss mcp status` output for placeholders, not values.
Delete any scratch sandbox created for the check.

## Report format

End with a short report any human can act on:

```text
Store: <path or tag>
Classified: <n> portable config, <n> package/runtime, <n> credential, <n> project-local
Provider setup: <profile> --env <VAR> for each credential
Unsupported: <name — reason> (or "none")
Verification: <each command and its observed result>
Known limits: <for example host-oracle false positives, or "none">
```

## Paste-able prompt for a host coding agent

```text
Follow docs/ai/environment-playbook.md in the maki-oss repository and build me
a personal environment store outside the repository.

1. Audit my host agent config (Maki and/or OpenCode, plus any project-local
   .maki/ or .opencode/ directories). List every MCP server, runtime or package,
   personal preference, and credential source by name. Never print or copy a
   credential value.
2. Classify each item as portable config, package/runtime, credential,
   project-local, or unsupported. For every credential, name the OpenShell
   provider profile and `maki-oss provider setup --env <VAR>` step. Report
   unsupported items by name instead of dropping them.
3. Copy examples/environments/reference to a directory I name, and edit only
   that copy: pinned runtime installs in the Dockerfile, `${VAR}` only in
   config/mcp.toml, the trust block plus my chosen preferences in config/init.lua,
   and a .dockerignore that excludes local secrets and host-only profiles.
4. Build the base and the store, set the helper's `image` setting to the derived
   tag, and verify with maki --version, the runtime check, maki-oss status, and
   maki-oss mcp status.
5. Stop and report the exact command and output on any mismatch. Do not relax
   the security invariants: no host bind mounts, no secrets in the store or
   `--env`, deny-by-default egress, non-root sandbox user, no `maki auth login`
   inside the sandbox.
```

## Invariants (never relax these to make a step work)

- No host bind mounts; project files move with upload/download.
- No secrets in the store, the image, `--env`, or any file the sandbox reads.
  Credentials come from OpenShell provider profiles.
- Egress stays deny-by-default; add the narrowest policy/profile rule, never a
  wildcard host or `tls: skip`.
- Sandbox processes stay non-root (uid/gid 1500).
- Never run `maki auth login`, or set a provider base-URL override, inside a
  sandbox.
- Do not edit `examples/maki-image/` for a personal choice; copy the reference
  store and change the copy.
