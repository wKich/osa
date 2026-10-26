| Field | Value |
|---|---|
| Doc | `reference-opencode` |
| Kind | `reference` |
| Agent | `OpenCode` |
| Covers | `P3-P8` |
| Verified | not yet verified |

# Reference: OpenCode

> **OpenCode path; return to onboarding for Maki or Claude** — [open the
> onboarding guide](../onboarding.md).

## Scope

OpenCode-specific paths and differences for a reader who already has the
shared procedure. This page is an index, not a second procedure: the ordered
path is [`docs/ai/playbooks/opencode.md`](../playbooks/opencode.md), and the
pinned run is
[`opencode-oss/README.md#verification-record`](../../../opencode-oss/README.md#verification-record).
Shared helper behavior lives in [`docs/helper.md`](../../helper.md), provider
profiles in [`docs/providers.md`](../../providers.md), MCP in
[`docs/mcp-migration.md`](../../mcp-migration.md), and the environment store in
[`docs/ai/environment-playbook.md`](../environment-playbook.md). This page has
not been run as a separate procedure, so `Verified` says `not yet verified`.

## Config paths

| What | Host | Sandbox or store |
|---|---|---|
| Helper config | `${XDG_CONFIG_HOME:-$HOME/.config}/opencode-oss/config.toml` | host only |
| Helper state | `${XDG_STATE_HOME:-$HOME/.local/state}/osa/sessions/<sandbox>/` | host only |
| Agent global config | `~/.config/opencode/opencode.json`, `tui.json` | `/sandbox/.config/opencode/opencode.json`, baked from a store's `config/` |
| Credential store | `~/.local/share/opencode/auth.json` | never copied; import with `opencode-oss provider setup` |
| Project-local config | `opencode.json`, `.opencode/` | uploads with the project; never baked into the image |
| Custom profiles | `~/.config/opencode-oss/profiles/` | host only |

Settings resolve like `maki-oss`: flags, then `OPENCODE_OSS_<KEY>` environment
variables, then the config file, then defaults. The keys and file format are
in [`docs/helper.md`](../../helper.md#configuration). Only the names and
defaults differ:

| | `maki-oss` | `opencode-oss` |
|---|---|---|
| Environment prefix | `MAKI_OSS_` | `OPENCODE_OSS_` |
| Config file | `…/maki-oss/config.toml` | `…/opencode-oss/config.toml` |
| `image` default | `maki-agent:local` | `opencode-agent:local` |
| `policy` default | `examples/policies/maki-minimal.yaml` | `opencode-oss/policies/minimal.yaml` |
| `sandbox_name` default | `mk-{project}-{hash}` | `oc-{project}-{hash}` |
| Registry agent tag | `mk` | `oc` |
| In-sandbox sync state | `/sandbox/.maki-oss/` | `/sandbox/.opencode-oss/` |
| Curated profiles | `examples/providers/` | `opencode-oss/providers/` |

Both helpers keep their host state under the one shared root,
`~/.local/state/osa/` (see
[Shared state and the project registry](../../helper.md#shared-state-and-the-project-registry)),
so `osa projects` lists Maki and OpenCode projects together. In the same
project directory they still use different sandboxes (`mk-…` and `oc-…` with
the same path hash), config files, and session directories, and a `MAKI_OSS_*`
variable has no effect on `opencode-oss`. The default sandbox name
`oc-{project}-{hash}` follows the [sandbox name rules](../../helper.md#sandbox-names)
and fits OpenShell's 19-character limit. A sandbox created under an older
default keeps working once it has a registry entry; otherwise set
`sandbox_name` to its name or recreate it. The `tui` key is accepted but
ignored, because the OpenCode TUI mode is a `maki-oss` feature.

A minimal config:

```toml
providers = "opencode-synthetic"
model = "synthetic/hf:zai-org/GLM-5.3"
```

## Profiles

Shipped profiles are the `opencode-*` set under `opencode-oss/providers/`.
Each keeps the endpoint host, port, and credential env var of its Maki
counterpart in `examples/providers/`, but authorizes only the binary
`/usr/local/bin/opencode`. An OpenCode sandbox attaches `opencode-<name>`, not
`maki-<name>`, because OpenShell attaches one provider per credential key. The
catalog, plan choices, and the `--env`, `--from`, and `--file` forms are in
[`docs/providers.md`](../../providers.md).

### Provider setup

`opencode-oss provider setup` reads the same credential sources as `maki-oss`:
the Maki and OpenCode stores, a JSON file, a host environment variable, or a
hidden prompt. It maps a stored key to its `opencode-*` profile through
[`opencode-oss/providers/stores.tsv`](../../../opencode-oss/providers/stores.tsv).
For example:

```sh
opencode-oss provider setup --from opencode --credential synthetic --yes
# … Provider 'opencode-synthetic' created.
# example model: synthetic/hf:zai-org/GLM-5.3
# set it as the default: model = "synthetic/hf:zai-org/GLM-5.3" in ~/.config/opencode-oss/config.toml
```

The key is exported only into the environment of the `openshell` child
process. It never appears in argv, files, or output. Slugs with no curated
profile (google, mistral, xai, zai) fall through to a generated custom
profile. Its id has the `opencode-` prefix, it binds `/usr/local/bin/opencode`,
and it is written to `~/.config/opencode-oss/profiles/`.

OAuth-only logins (ChatGPT, Claude Pro/Max, Copilot) are not supported, because
they need in-sandbox authentication.

## Sessions

### Model selection

The model resolves from `--model`, then `OPENCODE_OSS_MODEL`, then the config
file's `model`.

- **`run`** passes it as `--model`.
- **The TUI** has no model flag, so the helper passes the model as a config
  overlay for that one exec:
  `--env OPENCODE_CONFIG_CONTENT={"model":"…"}`. OpenCode merges the overlay
  over the baked `/sandbox/.config/opencode/opencode.json`, so the image's deny
  rules stay in force. Nothing is written to your project or to the sandbox
  config.

With no model set, OpenCode falls back to its own default, which is usually a
free tier that the sandbox denies. `doctor` warns about this. Each curated
profile's example model is in
[`opencode-oss/providers/catalog.tsv`](../../../opencode-oss/providers/catalog.tsv),
and `provider setup` prints it.

### Session flags

OpenCode has one `--session` flag for both "resume" and "use this ID":

| Option | OpenCode flag |
|---|---|
| `--continue`, `-c` | `--continue` (the most recent session) |
| `--resume ID`, `-r ID` | `--session ID` |
| `--session-id ID` | `--session ID` (OpenCode creates the session when it does not exist) |

Any two of these options together are a usage error, raised before any
sandbox work. OpenCode session IDs start with `ses`. OpenCode rejects any other
ID with a JSON `error` event and exit code 1, and the helper passes that result
through unchanged. Sessions live in the sandbox: they survive `stop`/`start`,
but not `rm`.

### Runtime rules

- **Every exec runs `--standalone`.** Without it, OpenCode starts a background
  service in the sandbox and writes a `service.json` with that service's
  password under `/sandbox`. The helper never runs an OpenCode command that
  lacks the flag.
- **`run` closes stdin.** `opencode run` reads stdin when it is not a
  terminal, and `sandbox exec` leaves stdin open, so a run would otherwise
  wait forever. stdout carries OpenCode's JSON events unchanged, and the exit
  code is OpenCode's. `--timeout` uses the same in-sandbox wrapper as
  `maki-oss`.
- **`--auto` is for `run` only.** The TUI asks before each tool call that the
  baked config does not deny. To approve automatically, set `permissions` in
  an environment image built `FROM opencode-agent:local`. It is a personal
  preference, like Maki's `always_yolo`.
- **No catalog fetch.** Every exec gets
  `--env OPENCODE_DISABLE_MODELS_FETCH=1`, so OpenCode does not try
  `models.opencode.ai`. The sandbox would deny that request anyway, and the
  switch keeps the denial out of `opencode-oss logs`. It has to be set per
  exec because `sandbox exec` does not pass image `ENV` through.

On exit, both session kinds run the same patch sync and network-proposal check
as `maki-oss` (see [Safe session sync](../../helper.md#safe-session-sync)).

## MCP

### MCP status

`opencode-oss mcp status` compares the servers enabled under the `mcp` key of
the host's `~/.config/opencode/opencode.json` with the servers in the
sandbox's `/sandbox/.config/opencode/opencode.json`. It uses the same gate
vocabulary as `maki-oss mcp status`: sandbox, provider
(`opencode-mcp-<name>` attached), endpoint, and runtime for `local` servers.
`doctor` prints the same table. The file mapping and readiness checks are in
[`docs/mcp-migration.md`](../../mcp-migration.md).

- The base image declares no MCP servers. A missing server points to an
  environment image built `FROM opencode-agent:local` that declares it.
- The files are parsed with `jq`. Without `jq`, `mcp status` exits with the
  dependency code (2), and `doctor` prints `skipped: jq not found`.
- A file that `jq` cannot parse, such as JSONC with comments, is reported as
  `unreadable` and its servers are not guessed. `mcp status` then exits 3.

## Store

The base image is agent-only. Personal OpenCode config, MCP servers, and
global skills belong in an environment store built `FROM opencode-agent:local`
— the OpenCode counterpart of
[the environment playbook](../environment-playbook.md).

### Personal environment

A store needs:

- **`Dockerfile`** — pinned runtimes and `COPY` of `config/opencode.json` to
  `/sandbox/.config/opencode/opencode.json` and `config/skills/` to
  `/sandbox/.config/opencode/skills/`. Install a local MCP server's runtime and
  pre-install its package as uid 1500 at build; a session never fetches from a
  registry.
- **`config/opencode.json`** — the host config with every credential replaced
  by an `{env:VAR}` reference. The file replaces the baked one, so repeat the
  base image's `permissions` deny rules. `opencode debug config --print-logs`
  reports any normalization warning; fix or drop the entry rather than
  shipping the warning.
- **Provider profiles** — one per credential, bound to
  `/usr/local/bin/opencode`. MCP profiles are imported as
  `opencode-mcp-<server>`; that is the provider name `mcp status` checks.
  `provider setup --profile <file> --env <VAR>` lints, imports, and creates
  one without putting the value in argv or files.

Build the store, select it through the `image` setting, then verify:

```sh
docker build -t opencode-agent:personal <store>
# image = "opencode-agent:personal" in .../opencode-oss/config.toml
opencode-oss doctor
opencode-oss mcp status
```

Existing sandboxes keep their old image until they are deleted and recreated.
Host servers that are disabled, OAuth-only, or point at a loopback endpoint
are reported and skipped, not copied into the store.

### Image build

`opencode-oss image build` builds `opencode-oss/image` and tags it
`opencode-agent:local`, or the `--image` / `OPENCODE_OSS_IMAGE` tag. It never
uses the configured `image`, which may name a derived environment.
`--opencode-version V` passes `OPENCODE_VERSION=V`. The Dockerfile checks a
pinned sha512 for each architecture, so a new version also needs its
`OPENCODE_SHA512_*` values (see
[`opencode-oss/README.md`](../../../opencode-oss/README.md#1-build-the-image)).
Without them, the build fails rather than skipping the check.

## Differences

- The base image starts OpenCode without a Node or Bun runtime, MCP server, or
  plugin. A personal addition belongs in a store, not an install into a
  running sandbox.
- `--standalone` is mandatory on every exec; stdin is closed for `run`;
  `--auto` applies to `run` only; the TUI selects its model through `/models`
  or the project's `opencode.json`.
- OpenCode never authenticates inside the sandbox: no `opencode auth login`
  and no provider base-URL override. OAuth-only credentials have no path here.
- Provider profiles bind `/usr/local/bin/opencode`; renaming or wrapping the
  binary breaks the egress rule.
- The `tui = "opencode"` bridge mode is a Maki feature that drives the OpenCode
  TUI against Maki; it is not this path.
- No `opencode-git-push` policy ships; the playbook's Phase 3 covers the
  scratch copy of the repository-scoped GitHub policy. The dashboard and
  oskhs are out of scope.

## See also

- [`docs/ai/onboarding.md`](../onboarding.md) — choose Maki, OpenCode, or
  Claude Code.
- [`docs/ai/playbooks/opencode.md`](../playbooks/opencode.md) — the ordered
  OpenCode sandbox path.
- [`opencode-oss/README.md`](../../../opencode-oss/README.md) — the
  subproject, its raw-command path, and the verification record.
- [`docs/helper.md`](../../helper.md) — shared helper commands, settings, and
  sync.
- [`docs/providers.md`](../../providers.md) — the `opencode-*` profile catalog.
- [`docs/mcp-migration.md`](../../mcp-migration.md) — MCP definitions and
  status.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — the
  environment store.
- [`docs/verification.md`](../../verification.md) — isolation checklist.
- [`docs/ai/references.md`](../references.md) — upstream documentation index.
- [`docs/ai/document-contract.md`](../document-contract.md) — page shape used
  by this reference.
