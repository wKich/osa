# OpenShell dashboard

A minimal local web dashboard for osa and [OpenShell](https://docs.nvidia.com/openshell):
the projects every agent front-end has registered with their sync state,
sandbox inventory and lifecycle, live logs over Server-Sent Events, read-only
policy inspection, and rule-proposal review, without replacing `openshell term`
or the CLIs.

Bun + TypeScript, **zero npm dependencies**, no build step, no database, no
daemon: one command starts a loopback-only server that reads gateway JSON
through the `openshell` CLI and project state from the osa state root.

## Requirements

- **Bun ≥ 1.2** (developed and tested against 1.4.2). Check with `bun --version`.
- **`openshell` CLI ≥ 0.1.2** on `PATH`, installed and authenticated against
  the gateway you want to inspect (`openshell status` should report
  `connected`). The dashboard never reads, stores, or forwards credential
  values; it invokes the CLI, which holds its own credentials.
- A gateway reachable from this host. Remote gateways are out of scope for v1.
- For the Projects view: the `osa` command (the repository's `bin/osa` is used
  by default) and the projects registered by `maki-oss`, `opencode-oss`, or
  `claude-oss`.

## Quick start

```sh
cd dashboard
bun install          # resolves with zero packages
bun run start        # http://127.0.0.1:8787
```

Open the printed URL. The page opens on **Projects**; the **Sandboxes** tab
holds the gateway inventory. Both lists refresh every 3 seconds; per-sandbox
views (`Logs`, `Policy`, `Rules`) stream or fetch on demand.

## Projects view

The Projects view lists every entry in the osa project registry
(`$XDG_STATE_HOME/osa/projects/*.toml`, else `$HOME/.local/state/osa/…`)
across all agents: agent, project, host path, and sandbox name. A sandbox that
the gateway lists links to its detail view; otherwise the row says
"not on gateway" (or "gateway unknown" while the inventory is unavailable).
An unknown agent tag is shown raw. An entry that does not parse, or whose
contract `version` is not `"1"`, is listed by file name with a note.

Each row shows:

- **Pending**: `retained` or `parked` from the session's `pending` marker, and
  `orphan` when the host folder is gone. These come from file reads only; the
  list never contacts the gateway.
- **Host**: whether the host changed since the last sync (`changed`,
  `unchanged`, `unknown`), from `osa status PATH --quick --json`. Results are
  cached per host path for 60 seconds and refreshed in the background, at most
  two at a time, and only while a page polls the list. Orphans are never
  checked. **Check host changes** drops the cache.
- **Status**: **Check (contacts gateway)** runs `osa status PATH --json` (30 s
  timeout) and shows the sync state (`clean`, `behind`, `retained`, `parked`),
  phase, and the next command the front-end suggests.
- **View patch** (retained patches only): the patch text read-only, with added
  and removed lines marked, truncated at 2 MiB with a notice.

The header's attention counter shows how many projects have a retained patch,
a parked workspace, or a missing folder; it is visible from every view and
opens Projects. Nothing in the Projects view writes: resolving pending work
stays with the front-end in the project.

## Scripts

| Script | Purpose |
|---|---|
| `bun run start` | Start the dashboard server |
| `bun run dev` | Start with `--watch` (restarts on source changes) |
| `bun test` | Run the stub-backed test suite (no gateway, no Docker, no network) |
| `bun run scripts/browser-check.ts` | Drive the real UI in headless Chrome against the stub (skips without Chrome) |

## Flags and environment

Priority: flag > environment variable > default.

| Flag | Environment | Default | Behavior |
|---|---|---|---|
| `--port N` | `DASHBOARD_PORT` | `8787` | Listen port |
| `--host ADDR` | `DASHBOARD_HOST` | `127.0.0.1` | Bind address. Any non-loopback address **requires** `--token`/`DASHBOARD_TOKEN` and prints a startup warning |
| `--token T` | `DASHBOARD_TOKEN` | random per start | Session token embedded in the served page and required by every mutating route |
| `--read-only` | `DASHBOARD_READ_ONLY` | off | Rejects every mutating route with 403 and hides the controls (`1`, `true`, `yes`, `on`) |
| — | `DASHBOARD_OPENSHELL_BIN` | `openshell` | CLI binary to invoke (tests point this at the stub) |
| — | `DASHBOARD_OSA_BIN` | `../bin/osa`, else `osa` | `osa` binary for host-change and full status checks: this variable, else the repository's `bin/osa` next to the dashboard, else `osa` on `PATH` |
| — | `XDG_STATE_HOME` | `$HOME/.local/state` | Base of the osa state root (`$XDG_STATE_HOME/osa`) the Projects view reads |
| `-h`, `--help` | — | — | Print usage |

`DASHBOARD_PORT` and `DASHBOARD_HOST` make `bun run start` easy to wrap in a
process manager; `DASHBOARD_READ_ONLY=1` is the shared/demo setting.

## Configuration (create defaults)

Create-time defaults come from the same file the `maki-oss` helper uses:

```
${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml
```

The dashboard reads `image`, `policy`, `providers` (comma-separated), `cpu`, and
`memory`; other keys are ignored. The create form pre-fills these values and
the server applies them when a request omits a field. A relative `policy` path
is tried against the current directory first, then the repository root; when the
file sets no policy, the repository's `examples/policies/maki-minimal.yaml` is
used if it exists. Copy [`examples/config.toml`](../examples/config.toml) as a
starting point.

## API

Read routes (no token required on loopback):

| Route | Returns |
|---|---|
| `GET /` | Page shell with the session bootstrap |
| `GET /api/doctor` | CLI presence, gateway reachability, read-only state |
| `GET /api/sandboxes` | Sandbox inventory (`name`, `phase`, labels, notes) |
| `GET /api/sandboxes/:name` | Detail: policy source/revision, providers, revision list |
| `GET /api/sandboxes/:name/policy?view=base\|full` | Base or effective policy |
| `GET /api/sandboxes/:name/rules?status=pending` | Rule proposals parsed from `rule get` |
| `GET /events/logs?name=:name&token=:token` | SSE log stream (ring-buffer replay, heartbeat comments). Requires the page's session token |
| `GET /api/projects[?refresh=1]` | Registry entries with `pending`, `orphan`, `note`, `fingerprintResult`, `checkedAt`, and per-row `osaError`; `refresh=1` drops the host-change cache |
| `GET /api/projects/:sandbox/status` | `osa status <host_path> --json`, narrowed to that sandbox; 404 for a sandbox not in the registry |
| `GET /api/projects/:sandbox/patch` | The retained patch `{name, size, truncated, text}`. Requires `X-Dashboard-Token`, in read-only mode too |

Project routes accept GET only; any other method returns 405 and runs nothing.

Mutating routes require the `X-Dashboard-Token` header and fail with 403 in
read-only mode:

| Route | Action |
|---|---|
| `POST /api/sandboxes` | Create from configured defaults (`{name, image?, policy?, providers?, cpu?, memory?}`) |
| `POST /api/sandboxes/:name/start` \| `/stop` \| `/delete` | Lifecycle |
| `POST /api/sandboxes/:name/rules/:chunkId/approve` | Approve a pending proposal |
| `POST /api/sandboxes/:name/rules/:chunkId/reject` | Reject with required `{reason}` |

CLI failures return a structured body
(`{"error":{"kind":"missing_cli|exit|invalid_json|timeout|...","message":"..."}}`)
that the UI renders as an error banner while keeping the last good data on
screen.

## Security notes and threat model

The dashboard is a local operator tool, not a hardened service. What it does:

- **Loopback by default.** `127.0.0.1` only. Binding elsewhere is possible but
  requires an explicit token and prints a warning; there is no TLS in v1, so
  for remote access prefer an SSH tunnel to the loopback port.
- **Session token on mutations and streams.** A random token is minted at
  startup unless `--token` is given, embedded in the served page, and required
  as `X-Dashboard-Token`. Cross-site form posts cannot set that header, and no
  CORS headers are served, so a malicious page cannot read responses either.
- **Log streams require the page token.** `GET /events/logs` checks the token
  as a `token` query parameter (the browser's `EventSource` cannot send
  headers) and returns 403 without spawning a log process. Read-only mode
  still mints a read token so the page can stream logs, but it continues to
  reject every mutation.
- **Read-only mode** for shared or demo machines: every mutation returns 403.
- **Defense in depth in the browser.** The page carries a strict CSP
  (`script-src 'self'`, `default-src 'none'`), and the frontend renders gateway
  and project data only as text nodes — the served ES modules under `/app/`
  contain no HTML sink identifiers, enforced by a test. Only the module names
  found in `src/app/` at startup are served; no URL path reaches the file
  system.
- **No secrets through the dashboard.** It never reads or stores credential
  values, and it adds no `--env` values; provider credentials stay with the
  CLI and OpenShell's provider profiles. The API responses contain gateway
  metadata only.
- **No host bind mounts, no sandbox changes.** The dashboard only shells out to
  `openshell` and `osa`, and only with argv arrays (never through a shell). The
  only `osa` commands it can run are `status PATH --json` and
  `status PATH --quick --json`.
- **Project data stays read-only.** The Projects view reads the osa state root
  and never creates, modifies, or deletes a file there or in a registered
  host project; no project route accepts a method other than GET.

Threat model: the assets are the gateway (mutating sandboxes, approving rules)
and the metadata the API exposes. The main risks are (1) another local process
reaching the loopback port and (2) a browser tricking the operator's session
into mutations. The token gate addresses both, and read-only mode removes the
mutation surface entirely. Anyone with local access to the host can already run
the authenticated `openshell` CLI, so the dashboard does not add a new trust
boundary; it just makes the same capabilities reachable from a browser tab.
The dashboard itself holds no credentials, so compromising it does not leak
gateway secrets directly.

Patches are host source code, which is more sensitive than gateway metadata.
The patch route therefore requires the session token as `X-Dashboard-Token`
in read-write and read-only mode alike, so a page that reaches the port (for
example through DNS rebinding) cannot read it. It serves a patch only when
the sandbox is in the registry and the marker's `patch` path resolves, after
following symbolic links, to a regular file directly inside that sandbox's
`sessions/<sandbox>/` directory, reads at most 2 MiB, and returns it as JSON
text that the page renders as text nodes. It serves host code read-only; no
project route writes anything.

## Known limitations

- **Per-sandbox image is not exposed by `openshell` 0.1.2.** `sandbox list` and
  `sandbox get` omit `spec.template.image`, so the inventory shows the
  configured image from `config.toml` with a `(configured)` label — the same
  approach as `maki-oss status` — rather than guessing per-sandbox values.
- **`rule get` has no JSON output mode.** The dashboard parses the CLI's stable
  field-per-line table (covered by tests); a future CLI JSON mode can replace
  that parser behind `src/openshell.ts`.
- Policy editing stays file-based; the dashboard is view-only for policy.
- No authentication, multi-user support, or remote gateway support in v1.

## Testing

```sh
bun test              # adapter, project reader, routes, guards, SSE lifecycle
bun run scripts/browser-check.ts   # real headless Chrome against the stubs
```

Tests put `test/stub` first on `PATH` (or set `DASHBOARD_OPENSHELL_BIN`) and
never touch a real gateway; the browser check uses the same stubs and a
throwaway Chrome profile. `test/stub/openshell` records argv, returns pinned
v0.1.2 JSON shapes, simulates lifecycle state, and can emit timed log lines.
`test/stub/osa` answers `status PATH [--quick] --json` from a JSON fixture,
logs argv, and can fail, hang, or print invalid JSON. `test/state-fixture.ts`
builds a throwaway state root with every registry and marker shape the
Projects view handles, and a conformance test checks the dashboard's reader
against the real `bin/osa projects --json` over it.

`scripts/smoke.sh` starts the real server with the stub on `PATH`, checks every
documented flag, and asserts the API payloads end to end:

```sh
dashboard/scripts/smoke.sh
```

## Manual verification against a real gateway

Run on **2026-10-05** against OpenShell **0.1.2** (local Docker gateway,
`openshell status` → `connected`) with Bun 1.4.2. Scratch sandbox
`dash-verify` created and deleted through the dashboard API; the local
`maki-agent:local` image and `examples/policies/maki-minimal.yaml` were used.

| Check | Result |
|---|---|
| `GET /api/doctor` | CLI `openshell 0.1.2`; gateway `connected` (`https://localhost:17670`) |
| Create via `POST /api/sandboxes` | `created dash-verify`; sandbox reached `Ready` |
| Inventory and detail | phase `Ready` and policy source `sandbox` / revision `1` matched `sandbox list`/`get -o json` |
| Policy views | Base and effective policy JSON byte-identical to `policy get --base/--full -o json`; revision list matched `policy list -o json` (`1` revision, `loaded`) |
| Logs (SSE) | 37 live lines captured during `exec` probes, including `gateway`/`sandbox` sources and `INFO`/`OCSF` levels, same format as `openshell logs` |
| Rules view | CLI reported no pending rules; the dashboard showed no pending proposals |
| Stop / Start | Dashboard messages `✓ Stopped sandbox dash-verify` / `✓ Started sandbox dash-verify`; CLI phase followed `Stopped` → `Ready` |
| Delete | `deletion accepted; cleanup is pending`; sandbox absent from both CLI list and dashboard inventory; the open SSE stream stopped with `event: end` |
| Cleanup | Scratch sandbox deleted; dashboard server stopped |

Two issues were found and fixed during this run:

- `openshell` 0.1.2 has no `version` subcommand; the adapter's `doctor()` now
  uses `openshell --version`, and the stub mirrors that.
- Real log levels are uppercase (`INFO`, `WARN`, `OCSF`); the client filters
  now normalize case and show unknown levels instead of hiding them.
