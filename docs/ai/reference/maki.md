# Reference: Maki

| Field | Value |
|---|---|
| Doc | `reference-maki` |
| Kind | `reference` |
| Agent | `Maki` |
| Covers | `P0, P3-P8` |
| Verified | not yet verified |

## Scope

Maki-specific paths and differences for a reader who already has the shared
procedure. This page is an index: shared behavior lives in `docs/helper.md`,
provider profiles in `docs/providers.md`, MCP in `docs/mcp-migration.md`, and
the environment store in `docs/ai/environment-playbook.md`. It has not been run
as a separate procedure; each linked page carries its own verified results.

## Config paths

| What | Host | Sandbox or store |
|---|---|---|
| Agent config | `~/.config/maki/` (`init.lua`, `mcp.toml`, `permissions.toml`, `providers.toml`, `plugin.toml`, `skills/`, `commands/`, `lua/`) | `/sandbox/.config/maki/`, baked from a store's `config/` |
| Credential store | `~/.local/state/maki/auth/` | never copied; import with `maki-oss provider setup` |
| Project-local config | `.maki/` | uploads with the project |
| Helper config | `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml` | host only |
| Helper state | `${XDG_STATE_HOME:-$HOME/.local/state}/osa/sessions/<sandbox>/` | host only |

`init.lua` carries the folder-trust block and `always_yolo = true`; a store's
copy replaces the base file and must repeat both. Settings and state shapes are
in `docs/helper.md`; the store layout is in
`docs/ai/environment-playbook.md`.

## Profiles

Shipped profiles are the `maki-*` set under `examples/providers/`.
`maki-oss provider setup` imports one, creates the provider, and remembers it
for the project. The catalog, plan choices (for example Z.AI coding), and the
`--env`, `--from`, and `--file` forms are in `docs/providers.md`. A credential
stays in the host store or an exported variable; the sandbox sees only the
provider placeholder.

## MCP

Global servers live in `~/.config/maki/mcp.toml` under `mcp.<name>`;
project-local servers live in `.maki/mcp.toml` and need folder trust. A stdio
server's runtime must be installed in the environment image. The file mapping,
tool-name check, and readiness table are in `docs/mcp-migration.md`.

## Store

The environment store is a Docker build context outside this repository:
`Dockerfile`, `.dockerignore`, `README.md`, and `config/` copied to
`/sandbox/.config/maki/`. It builds `FROM maki-agent:local`, and the derived tag
is selected through the helper's `image` setting. Stage-by-stage instructions
are in `docs/ai/environment-playbook.md`; the worked example is
`examples/environments/reference/`.

## Differences

- The base image starts every Maki session in YOLO mode because the sandbox, not
  Maki, is the permission boundary; the baked `permissions.toml` deny rules
  still apply.
- Headless runs use `maki -p "<task>" --output-format json`; a store's
  `init.lua` must keep the folder-trust block for them.
- Maki never authenticates inside the sandbox: no `maki auth login` and no
  provider base-URL override. OAuth-only credentials have no path here.
- Provider profiles bind `/usr/local/bin/maki`; renaming or wrapping the binary
  breaks the egress rule.

## See also

- [`docs/ai/playbooks/maki.md`](../playbooks/maki.md) — the Maki sandbox path.
- [`docs/helper.md`](../../helper.md) — `maki-oss` commands, settings, and sync.
- [`docs/providers.md`](../../providers.md) — the `maki-*` profile catalog.
- [`docs/mcp-migration.md`](../../mcp-migration.md) — MCP definitions and status.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — the store.
- [`docs/verification.md`](../../verification.md) — isolation checklist.
