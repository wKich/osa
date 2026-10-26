# opencode-oss: the OpenCode sandbox helper

`bin/opencode-oss` runs [OpenCode](https://opencode.ai/docs/cli/) inside a
per-project OpenShell sandbox, the way `bin/maki-oss` runs Maki. Both
helpers are thin front-ends over the same core, `lib/oss-core.sh`, so the
lifecycle, safe patch sync, policy review, provider setup, idle stop, and
the safety rules behave identically. [docs/helper.md](helper.md) is the
reference for that shared behavior. This page covers only what differs.

The security model is unchanged:

- the sandbox is the boundary, and nothing is bind-mounted;
- credentials reach the sandbox only through provider profiles;
- `--env` and `--env-from` refuse credential-like names;
- egress stays deny-by-default;
- `rm` needs confirmation.

## Install

From a clone of this repository:

```sh
./bin/opencode-oss image build      # opencode-agent:local from opencode-oss/image
./bin/opencode-oss provider setup   # pick a stored key, or enter one hidden
./bin/opencode-oss doctor
```

Put the repository's `bin/` on `PATH` to call it as `opencode-oss`. Keep
`lib/` and `opencode-oss/` next to `bin/`, because the helper loads them
from the repository root.

## Configuration

Settings resolve the same way as for `maki-oss`: flags, then
`OPENCODE_OSS_<KEY>` environment variables, then
`${XDG_CONFIG_HOME:-$HOME/.config}/opencode-oss/config.toml`, then
defaults. The keys and the file format are the ones in
[docs/helper.md](helper.md#configuration). Only the names and the
defaults differ:

| | `maki-oss` | `opencode-oss` |
|---|---|---|
| Environment prefix | `MAKI_OSS_` | `OPENCODE_OSS_` |
| Config file | `…/maki-oss/config.toml` | `…/opencode-oss/config.toml` |
| `image` default | `maki-agent:local` | `opencode-agent:local` |
| `policy` default | `examples/policies/maki-minimal.yaml` | `opencode-oss/policies/minimal.yaml` |
| `sandbox_name` default | `maki-{project}` | `oc-{project}` |
| Session state | `~/.local/state/maki-oss/`, `/sandbox/.maki-oss/` | `~/.local/state/opencode-oss/`, `/sandbox/.opencode-oss/` |
| Curated profiles | `examples/providers/` | `opencode-oss/providers/` |

The two helpers share no state. In the same project directory they use
different sandboxes, config files, and sync state, and a `MAKI_OSS_*`
variable has no effect on `opencode-oss`. The default sandbox name is
`oc-{project}` rather than `opencode-{project}`, so ordinary project
directories fit OpenShell's 19-character sandbox-name limit. A sandbox
created with the old `opencode-{project}` default is not found automatically;
set `sandbox_name` to its name or recreate it. The `tui` key is accepted but
ignored, because the OpenCode TUI mode is a `maki-oss` feature.

A minimal config:

```toml
providers = "opencode-synthetic"
model = "synthetic/hf:zai-org/GLM-5.3"
```

## Sessions

| Command | In-sandbox command |
|---|---|
| bare `opencode-oss`, `opencode-oss opencode` | `opencode --standalone` on a TTY |
| `opencode-oss run "<prompt>"` | `opencode run --standalone --auto --format json [--model M] [session flags] "<prompt>"` |

- **Every exec runs `--standalone`.** Without it, OpenCode starts a
  background service in the sandbox. The helper never runs an OpenCode
  command that lacks the flag.
- **`run` closes stdin.** `opencode run` reads stdin when it is not a
  terminal, and `sandbox exec` leaves stdin open, so a run would otherwise
  wait forever. stdout carries OpenCode's JSON events unchanged, and the
  exit code is OpenCode's. `--timeout` uses the same in-sandbox wrapper as
  `maki-oss`.
- **`--auto` is for `run` only.** The TUI asks before each tool call that
  the baked config does not deny. To approve automatically, set
  `permissions` in an environment image built `FROM opencode-agent:local`.
  It is a personal preference, like Maki's `always_yolo`.
- **No catalog fetch.** Every exec gets
  `--env OPENCODE_DISABLE_MODELS_FETCH=1`, so OpenCode does not try
  `models.opencode.ai`. The sandbox would deny that request anyway, and
  the switch keeps the denial out of `opencode-oss logs`. It has to be
  set per exec because `sandbox exec` does not pass image `ENV` through.

On exit, both session kinds run the same patch sync and network-proposal
check as `maki-oss` (see
[Safe session sync](helper.md#safe-session-sync)).

### Model selection

The model resolves from `--model`, then `OPENCODE_OSS_MODEL`, then the
config file's `model`.

- **`run`** passes it as `--model`.
- **The TUI** has no model flag, so the helper passes the model as a
  config overlay for that one exec:
  `--env OPENCODE_CONFIG_CONTENT={"model":"…"}`. OpenCode merges the
  overlay over the baked `/sandbox/.config/opencode/opencode.json`, so the
  image's deny rules stay in force. Nothing is written to your project or
  to the sandbox config.

With no model set, OpenCode falls back to its own default, which is usually
a free tier that the sandbox denies. `doctor` warns about this. Each curated
profile's example model is in
[`opencode-oss/providers/catalog.tsv`](../opencode-oss/providers/catalog.tsv),
and `provider setup` prints it.

### Session flags

OpenCode has one `--session` flag for both "resume" and "use this ID":

| Option | OpenCode flag |
|---|---|
| `--continue`, `-c` | `--continue` (the most recent session) |
| `--resume ID`, `-r ID` | `--session ID` |
| `--session-id ID` | `--session ID` (OpenCode creates the session when it does not exist) |

Any two of these options together are a usage error, raised before any
sandbox work. OpenCode session IDs start with `ses`. OpenCode rejects any
other ID with a JSON `error` event and exit code 1, and the helper passes
that result through unchanged. Sessions live in the sandbox: they survive
`stop`/`start`, but not `rm`.

## Provider setup

`opencode-oss provider setup` reads the same credential sources as
`maki-oss`: the Maki and OpenCode stores, a JSON file, a host environment
variable, or a hidden prompt. It maps a stored key to its `opencode-*`
profile through
[`opencode-oss/providers/stores.tsv`](../opencode-oss/providers/stores.tsv).
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
profile. Its id has the `opencode-` prefix, it binds
`/usr/local/bin/opencode`, and it is written to
`~/.config/opencode-oss/profiles/`.

A sandbox attaches `opencode-<name>`, not `maki-<name>`. Each profile
authorizes only its agent's binary, and OpenShell attaches one provider
per credential key.

## MCP status

`opencode-oss mcp status` compares the servers enabled under the `mcp`
key of the host's `~/.config/opencode/opencode.json` with the servers in
the sandbox's `/sandbox/.config/opencode/opencode.json`. It uses the same
gate vocabulary as `maki-oss mcp status`: sandbox, provider (`mcp-<name>`
attached), endpoint, and runtime for `local` servers. `doctor` prints the
same table.

- The base image declares no MCP servers. A missing server points to an
  environment image built `FROM opencode-agent:local` that declares it.
- The files are parsed with `jq`. Without `jq`, `mcp status` exits with
  the dependency code (2), and `doctor` prints `skipped: jq not found`.
- A file that `jq` cannot parse, such as JSONC with comments, is reported
  as `unreadable` and its servers are not guessed. `mcp status` then exits
  3.

## Image build

`opencode-oss image build` builds `opencode-oss/image` and tags it
`opencode-agent:local`, or the `--image` / `OPENCODE_OSS_IMAGE` tag. It
never uses the configured `image`, which may name a derived environment.
`--opencode-version V` passes `OPENCODE_VERSION=V`. The Dockerfile checks a
pinned sha512 for each architecture, so a new version also needs its
`OPENCODE_SHA512_*` values (see
[opencode-oss/README.md](../opencode-oss/README.md#1-build-the-image)).
Without them, the build fails rather than skipping the check.

## Not supported

- The `tui = "opencode"` bridge mode, which is a Maki feature that drives
  the OpenCode TUI against Maki.
- OAuth logins (ChatGPT, Claude Pro/Max, Copilot), which need in-sandbox
  auth. Use API keys.
- The dashboard and oskhs.

## See also

- [opencode-oss/README.md](../opencode-oss/README.md): the subproject, its
  raw-command path, and the verification record.
- [docs/helper.md](helper.md): the shared command reference (lifecycle,
  sync, policy, providers, idle stop, troubleshooting).
