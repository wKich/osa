# Migrating MCP servers from OpenCode to Maki

A checklist for copying the `mcp` block of OpenCode's global config into
Maki's global `mcp.toml`, so a host that ran OpenCode keeps the same MCP
servers in Maki. This is server configuration only — model credentials are a
separate migration, see [`docs/dogfood-migration.md`](dogfood-migration.md).
Maki's MCP reference is indexed in [`docs/ai/references.md`](ai/references.md).

| | OpenCode | Maki |
|---|---|---|
| File | `~/.config/opencode/opencode.json`, key `mcp` | `~/.config/maki/mcp.toml`, table `mcp.<name>` |
| Per-project | `.opencode/opencode.json` | `.maki/mcp.toml` (needs folder trust) |

## 1. Field mapping

| OpenCode | Maki | Note |
|---|---|---|
| `"type": "remote"` + `url` | `url = "..."` | Maki picks the transport from `command` vs `url` — never set both |
| `headers` | `headers = { KEY = "value" }` | values may reference the environment as `${VAR}`; an unset variable fails that server loudly |
| `oauth.clientId` / `oauth.clientSecret` | `oauth = { client_id = "...", client_secret = "..." }` | snake_case; `callback_*` keys pin the loopback redirect URI |
| `"type": "local"` + `command` | `command = ["bunx", "-y", "pkg"]` | keep it an argument array, not a shell string |
| `environment` | `environment = { KEY = "value" }` | stdio only. Maki does not forward provider API keys to child processes, so a stdio server that needs one names it here explicitly |
| `enabled` | `enabled` | defaults to `true` in Maki; omit for enabled servers |

Copy every server, keeping its enabled/disabled state — a disabled server is
documentation, not attack surface. Server names are ASCII alphanumeric and
hyphens; tool names become `<server>__<tool>` and permission rules for them go
under `[mcp.<server>]` in `permissions.toml`.

## 2. Migrate

Edit the two files side by side. The Maki file is a plain TOML table per
server, so a server moves in one block; nothing else in either file changes.

## 3. Verify

Parse the result and diff the server names against the source:

```sh
python3 -c 'import json,tomllib,sys,pathlib; o=json.load(open(sys.argv[1]))["mcp"]; m=tomllib.load(open(sys.argv[2],"rb"))["mcp"]; print("opencode:", *sorted(o)); print("maki:", *sorted(m))' \
  ~/.config/opencode/opencode.json ~/.config/maki/mcp.toml
```

Expected: every OpenCode server appears on the `maki:` line with the same
enabled state (a Maki-only server is fine when it is deliberately there).
Tool names come from a one-turn headless run — `maki prompt --names --tools`
lists built-in tools only, MCP tools do not appear there:

```sh
maki -p "List every tool name available to you, one per line. Do not call any tool." \
  --max-turns 1 -m <cheap-model>
```

Expected: the built-in names, then one `<server>__<tool>` line per tool of each
enabled server. A server that is missing is `Disabled` or `Failed` in Maki's
`/mcp` picker — check that the command exists on the host (stdio) or that the
endpoint answers (HTTP) before touching the config again.

## 4. Run a server inside the sandbox

The OpenShell sandbox has its own `/sandbox/.config/maki`, baked from an
**environment image** built on top of the generic base, and never reads the
host's `mcp.toml`. Moving a server across the boundary needs more than a copied
config: the endpoint must be reachable under deny-by-default egress, and its
credential must be present without ever entering the sandbox. OpenShell
provider profiles supply both.

The base image declares no MCP servers. To add one, copy
[`examples/environments/reference/`](../examples/environments/reference/) outside
the repository, put the server in that store's `config/mcp.toml`, build the
store, and set the helper's `image` setting to its derived tag. The full
procedure is [`docs/ai/environment-playbook.md`](ai/environment-playbook.md);
the reference store is the worked example.

An MCP server works inside the sandbox when all four hold:

1. **Profiles carry egress and credential** — each server is backed by a
   provider profile under [`examples/providers/`](../examples/providers/)
   (`mcp-<server>.yaml`) that declares the endpoint with the protocol the
   traffic actually speaks, and binds the credential to that endpoint. For an
   HTTP server that is `protocol: mcp` with the host, port, and path the
   server actually serves; for a stdio server — whose Maki-facing leg is a
   local pipe the gateway never inspects — it is the upstream API endpoint the
   server process calls, `protocol: rest` (for `synthetic`,
   [`examples/providers/mcp-synthetic.yaml`](../examples/providers/mcp-synthetic.yaml)
   declares `api.synthetic.new:443`, confirmed from the package source). For an
   HTTP server the shipped example is
   [`examples/providers/mcp-context7.yaml`](../examples/providers/mcp-context7.yaml),
   which declares `mcp.context7.com:443/mcp` as `protocol: mcp`. The
   profile is both the egress rule and the
   narrowest credential boundary OpenShell offers, so there is no separate
   `network_policies` entry to copy and no wildcard host or `tls: skip`. The
   base policy gains no MCP endpoint of its own; reach comes only from the
   attached profile. Setup is the existing profile flow:
   `maki-oss provider setup --profile examples/providers/mcp-<server>.yaml --env <VAR>`
   (details in [`docs/providers.md`](providers.md)).
2. **Config travels with the sandbox, without credentials** — the server's
   definition is baked at image build in the environment store's
   `config/mcp.toml` (the reference store's file is
   [`examples/environments/reference/config/mcp.toml`](../examples/environments/reference/config/mcp.toml))
   and copied to `/sandbox/.config/maki/mcp.toml`. Every `headers` and
   `environment` entry
   expands a `${VAR}` placeholder that the attached provider injects; no
   credential value, client secret, or access token is baked into the file,
   the image, or any helper-generated artifact. A host literal is migration
   input for `maki-oss provider setup --env <VAR>`, never a value to copy
   across the boundary. A server whose variable is
   unset fails with the variable named in its status while the other servers
   keep working.
3. **OAuth-gated servers are tracked by the follow-up change** — the invariant
   still holds that no OAuth callback, browser flow, or `maki mcp auth` runs
   inside the sandbox; the login happens once on the host and the gateway would
   broker the refresh token, with the sandbox seeing only a placeholder. Two
   facts from the live test shape this: `maki mcp auth <server>` resolves the
   name against the *host's* `~/.config/maki/mcp.toml`, so the server must be
   declared there first (url only), and at OpenShell v0.1.5 the gateway's
   refresh exchange is rejected by at least one major server's token endpoint
   (client-authentication mismatch — details in
   [`docs/verification-log.md`](verification-log.md) §5.2). OAuth-gated MCP
   delivery therefore lives in the follow-up change `add-oauth-mcp-support`;
   this document covers the verified HTTP/API-key path.
4. **The readiness table is the verification step** — `maki-oss mcp status`
   compares the host's `~/.config/maki/mcp.toml` against the sandbox's baked
   config and reports, per server, the gates for its transport: present in
   the sandbox and provider attached for both kinds, plus endpoint in the
   effective policy for HTTP and the runtime gate — the command its
   `command` array names present in the sandbox — for stdio. It exits
   non-zero on any failing gate and prints
   the command or guidance that fixes it
   ([`docs/helper.md`](helper.md)). Because the config is baked at environment
   image build, adding or removing a server means rebuilding that store and
   selecting its derived tag — not rebuilding the base.

**A stdio server runs when the environment image provides its runtime.** A
stdio server (one configured with a `command` array) works in the sandbox when
the environment image provides the command that array names and the server's
package is installed in that image — both at image build: the store's
Dockerfile pins the runtime (bun in the reference store) and pre-installs the
declared server's package as uid 1500, so a session resolves installed files
only and never fetches from a registry. The helper never installs a runtime,
fetches a package, or otherwise adds code to a running sandbox; when the
runtime is missing, `maki-oss mcp status` names the command and prints the
environment-image build guidance and the environment playbook as the fix.
Credentials cross only as `${VAR}` expansion of a provider-injected
placeholder — a host literal in `~/.config/maki/mcp.toml` is migration input
for `maki-oss provider setup --env <VAR>`, never a value to copy — and the
upstream API the server process calls is reached through its own
`protocol: rest` profile.

**Two known limitations, both reported rather than hidden.** A server whose
token endpoint requires an RFC 8707 `resource` parameter cannot be expressed in
a profile and stays unsupported. A server needing an MCP revision newer than the
gateway supports either falls back to uninspected traffic — omit `protocol` and
`mcp` in the profile, trading tool-level policy for reach — or fails with a
named policy error that the readiness table surfaces for that server.

## This machine's run — 2026-10-19

Source: `~/.config/opencode/opencode.json` (last changed 2026-10-16) against
`~/.config/maki/mcp.toml` (originally migrated 2026-10-04, trimmed this run).

| Server | Transport | State | Note |
|---|---|---|---|
| `context7` | HTTP | enabled | header auth; verified loaded in step 3 |
| `synthetic` | stdio (`bunx -y synthetic-search-mcp`) | enabled | key passed through `environment`; verified loaded in step 3 |

Removed from the Maki file this run, all three unused: `wiki` and `figma`
(disabled in both files) and `kiss` (only ever in the Maki file). The OpenCode
block still lists `wiki` and `figma`; step 3's name diff therefore reports
them missing from `maki:` — expected until they are dropped from OpenCode
too. Nothing else drifted.
