| Field | Value |
|---|---|
| Doc | `reference-opencode` |
| Kind | `reference` |
| Agent | `OpenCode` |
| Covers | `P3-P8` |
| Verified | not yet verified |

# Reference: OpenCode

## Scope

The OpenCode path: OpenCode-specific paths and differences for a reader who
already has the shared procedure. This page is an index: the ordered path is
[`docs/ai/playbooks/opencode.md`](../playbooks/opencode.md), the pinned run is
[`docs/ai/verification/opencode.md`](../verification/opencode.md),
and shared behavior lives in [`docs/helper.md`](../../helper.md),
[`docs/providers.md`](../../providers.md),
[`docs/mcp-migration.md`](../../mcp-migration.md), and
[`docs/ai/environment-playbook.md`](../environment-playbook.md). This page is
an index, not a procedure, so `Verified` says `not yet verified`.

## Config paths

| What | Host | Sandbox or store |
|---|---|---|
| Helper config | `${XDG_CONFIG_HOME:-$HOME/.config}/opencode-oss/config.toml` | host only |
| Helper state | `${XDG_STATE_HOME:-$HOME/.local/state}/osa/sessions/<sandbox>/` | host only |
| Agent global config | `~/.config/opencode/opencode.json`, `tui.json` | `/sandbox/.config/opencode/`, baked from a store's `config/` |
| Credential store | `~/.local/share/opencode/auth.json` | never copied; import with `opencode-oss provider setup` |
| Project-local config | `opencode.json`, `.opencode/` | uploads with the project; never baked into the image |
| Custom profiles | `~/.config/opencode-oss/profiles/` | host only |

Settings resolve like `maki-oss` (flags, `OPENCODE_OSS_<KEY>`, config,
defaults; keys in [`docs/helper.md`](../../helper.md#configuration)). Only the
names and defaults differ: `OPENCODE_OSS_`, `opencode-agent:local`,
`opencode-oss/policies/minimal.yaml`, `oc-{project}-{hash}`, tag `oc`, and
`/sandbox/.opencode-oss/`. Both helpers share `~/.local/state/osa/`; the `tui`
helper key is ignored.

## Profiles

Shipped profiles are the `opencode-*` set under `opencode-oss/providers/`;
each keeps its Maki counterpart's endpoint and credential env var but
authorizes only `/usr/local/bin/opencode`, and a sandbox attaches
`opencode-<name>`, not `maki-<name>`. `opencode-oss provider setup` imports one
and remembers it; the playbook's
[Phase 2](../playbooks/opencode.md#phase-2--load-the-provider-profile-and-create-the-provider)
is the procedure. The OpenCode model catalog is
[`opencode-oss/providers/catalog.tsv`](../../../opencode-oss/providers/catalog.tsv);
shared `--env`/`--from`/`--file` forms are in
[`docs/providers.md`](../../providers.md).

## Sessions

The model resolves from `--model`, then `OPENCODE_OSS_MODEL`, then config
`model`. The TUI has no model flag, so the helper passes a one-exec
`OPENCODE_CONFIG_CONTENT` overlay over the baked
`/sandbox/.config/opencode/opencode.json`; deny rules stay in force. With no
model, OpenCode uses its free tier, which the sandbox denies; `doctor` warns.
The catalog's example model is the one `provider setup` prints.

### Session flags

OpenCode has one `--session` flag for both "resume" and "use this ID":

| Option | OpenCode flag |
|---|---|
| `--continue`, `-c` | `--continue` (the most recent session) |
| `--resume ID`, `-r ID` | `--session ID` |
| `--session-id ID` | `--session ID` (creates it when missing) |

Any two together are a usage error. IDs start with `ses`; others produce a
JSON `error` event and exit 1. Sessions survive `stop`/`start`, not `rm`.
OpenCode traps (commands are in [Phase 6](../playbooks/opencode.md#phase-6--run-opencode)):

- `--standalone` on every exec; otherwise a background service writes
  `service.json` under `/sandbox`.
- stdin from `/dev/null` for headless `run`; `--auto` on `run` only.
- TUI model via `/models` or project `opencode.json`; `OPENCODE_DISABLE_MODELS_FETCH=1` per exec.
- No in-sandbox `opencode auth login` or base-URL override.

## MCP

`opencode-oss mcp status` compares the host `~/.config/opencode/opencode.json`
`mcp` key with the sandbox's `/sandbox/.config/opencode/opencode.json`, using
`maki-oss mcp status`'s gates (sandbox, provider `opencode-mcp-<name>`,
endpoint, local runtime); `doctor` prints the table. The mapping is in
[`docs/mcp-migration.md`](../../mcp-migration.md).

- The base image declares no MCP servers; a missing server points to a store
  built `FROM opencode-agent:local`.
- Without `jq`, `mcp status` exits 2; a JSONC file is `unreadable` and exits 3.

## Store

### Personal environment

A store builds `FROM opencode-agent:local` (the base image is agent-only;
build: [Phase 1](../playbooks/opencode.md#phase-1--build-the-image)) and copies
`config/` to `/sandbox/.config/opencode/` (`opencode.json`, `tui.json`,
`skills/`). It selects its tag through the helper's `image` setting.
`config/opencode.json` is the host config with every credential replaced by an
`{env:VAR}` reference; do not bake a literal key. It replaces the baked file,
so repeat its `permissions` deny rules. Verify in a session or the built image
with `opencode debug config --standalone --print-logs`; never during the image
build. The full layout is in
[`docs/ai/environment-playbook.md`](../environment-playbook.md).

## Differences

- OAuth-only logins (ChatGPT, Claude Pro/Max, Copilot) are unsupported; use an API key.
- One env var can enable sibling OpenCode providers (for example
  `KIMI_API_KEY` also enables `kimi-code-plan-cn`); only the catalog row has a
  profile endpoint.
- The baked `opencode.json` denies `sudo`, `su`, `ssh`, `scp`,
  `opencode auth*`, and edits under `/sandbox/.config/**`, and holds under
  `--auto`; personal changes belong in a store.
- The `tui = "opencode"` bridge mode and the dashboard and oskhs are out of
  scope; the [playbook](../playbooks/opencode.md) owns the rest.

## See also

- [`docs/ai/onboarding.md`](../onboarding.md) — choose Maki, OpenCode, Claude Code, or Codex.
- [`docs/ai/playbooks/opencode.md`](../playbooks/opencode.md) — the ordered OpenCode path.
- [`opencode-oss/README.md`](../../../opencode-oss/README.md) — raw path and verification summary.
- [`docs/helper.md`](../../helper.md) — shared helper commands and sync.
- [`docs/providers.md`](../../providers.md) — shared provider forms.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — the store.
- [`docs/ai/verification/opencode.md`](../verification/opencode.md) — isolation
  checklist.
