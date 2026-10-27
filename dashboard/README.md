# OpenShell dashboard

A minimal local web dashboard for osa and [OpenShell](https://docs.nvidia.com/openshell):
the projects every agent front-end has registered with their sync state and
`osa resolve` actions for their pending work, sandbox inventory and lifecycle, live logs over Server-Sent Events, read-only
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
- **Idle stop**: the idle-stop state from the same cached quick status
  (`idle` in `osa status --quick --json`). While it is `counting`, the cell
  shows the time left (for example `stops in 4m 59s`), updated every second in
  the browser without a request; once the deadline passes it reads
  `stop due` until the next quick status reports the new state. Hovering
  shows the absolute deadline (UTC), which matters when the browser's clock
  is not the dashboard host's. Other states read `off`, `no session`,
  `session running`, `stopped`, `skipped`, or `stop failed`.
- **Health** opens the Health panel under the row (see below).
- **Review patch** (retained patches only): the patch text, never editable,
  with added and removed lines marked, truncated at 2 MiB with a notice.

The header's attention counter shows how many projects have a retained patch,
a parked workspace, or a missing folder; it is visible from every view and
opens Projects.

### Health panel

**Health** on a project row, or on the detail view of a sandbox that is in
the registry, runs `osa health SANDBOX --json` (30 s timeout) and shows:

- **Idle stop**: the state, the deadline (marked when estimated), the period,
  and the last idle event;
- **MCP readiness**: each server and gate with pass or fail and the fix text
  `mcp status` prints; `unsupported` for a front-end without `mcp status`
  (not a failure);
- **Doctor**: each check with its status and detail.

`osa health` runs only when the panel opens or **Refresh health** is pressed,
never on a poll tick, and results are not cached on the server. A section that
reports an error (for example MCP while the gateway is unreachable, or a
stopped sandbox) shows the error text while the other sections stay visible.
The panel only reads: it has no control that changes configuration,
providers, or the sandbox, and every value reaches the page as text.

The header status line (CLI and gateway) adds a link, "doctor checks fail for
SANDBOX", when the last opened panel of a project had a failing doctor check;
it opens that panel with its last result and never runs `osa health` itself.

### Resolve actions

Outside read-only mode, pending work can be resolved from the browser. Each
action runs exactly one `osa resolve SANDBOX ACTION --json` (see
[`docs/helper.md`](../docs/helper.md#osa-resolve) for what each one does):

| Pending | Where | Actions |
|---|---|---|
| `retained` | Under the diff in the patch view, so the patch is on screen first | **Apply** lists the files the patch touches (parsed from its `diff --git` headers, marked incomplete for a truncated patch) and runs only after **Confirm apply**. **Branch** commits the patch on a new `osa/<sandbox>-<timestamp>` branch. **Drop** needs the sandbox name typed |
| `parked` | On the row | **Rescue** copies the sandbox workspace into a `rescue-<timestamp>/` folder; the row stays `parked`. **Discard** needs the sandbox name typed |

Orphans and rows with nothing pending have no action. While the last quick
status says a session or resolve holds the sandbox (`busy`), the actions are
disabled and the row says "a session is running"; that result can be up to
60 seconds old, and `osa`'s own lock refuses a resolve that races a session.

After an action, the row (and the patch view, when it ran there) shows what
changed (files, branch, rescue folder), "nothing changed" with `osa`'s message
when it refused, or the error text when it failed. The project's rows are
re-read at once, so a cleared `retained` or `parked` badge disappears without
waiting for the next poll. In read-only mode none of these controls exist.

## Rules view and egress denials

Egress is deny-by-default, so a sandbox's network denials are the evidence
behind a rule proposal. The **Rules** view of a sandbox lists its pending
proposals and, under each one, the denials that proposal would allow; denials
that match no pending proposal are listed under **Denied, no proposal**.

- **Source.** One bounded read per refresh:
  `openshell logs NAME --since WINDOW --source sandbox -n 5000` (20 s timeout).
  The dashboard parses the OCSF shorthand denial lines,
  `… [OCSF ] [ocsf] NET:… [SEV] DENIED <binary>(<pid>) -> <host>:<port> [reason:…]`
  and `… DENIED <host> [reason:…]`, and ignores every other line.
- **Window.** Last 15 minutes, last hour (default), or last 6 hours, picked in
  the view. The window is a fixed choice; no free text reaches the CLI.
- **Groups.** Denials are grouped by destination host, port (absent for a
  DNS-stage refusal), and binary, each with a count, first and last time seen,
  and the distinct `reason` values.
- **Matching.** A group matches a proposal when its host equals one of the
  proposal's endpoint hosts (case-insensitive), its port is absent or equal to
  that endpoint's port, and, when both name binaries, its binary is one of the
  proposal's. One group can match several proposals.
- **When it reads.** Only when the Rules view opens, the window changes, or
  **Refresh denials** is pressed; never on a poll tick. A read is reused for the
  same sandbox and window for 30 seconds; **Refresh denials** bypasses that.
  Proposals are matched fresh on every request, so an approval or rejection
  moves its denials at once.
- **Badges.** The inventory row and the project row show **N denied**, the
  number of groups with no pending proposal from the last read, with its age.
  They show nothing until a read has happened; a badge never triggers one.
- **Limits and errors.** A read that returns 5000 lines says so, since older
  denials in the window were cut. A `DENIED` OCSF line in a layout the parser
  does not know (including non-`NET:` classes such as L7 `HTTP:` events) is
  counted as unparsed and up to five are shown raw, so a format change shows up
  instead of an empty view. A failed read shows the CLI's error text; the
  proposals stay listed.

The denial section has no control that writes policy: approving or rejecting
stays on the proposals, and a denial with no proposal is not turned into a
rule from the browser.

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
| `--host ADDR` | `DASHBOARD_HOST` | `127.0.0.1` | Bind address. Any non-loopback address **requires** `--token`/`DASHBOARD_TOKEN`, prints a startup warning, and then requires that token for the page and every read (see [Remote bind](#remote-bind)) |
| `--token T` | `DASHBOARD_TOKEN` | random per start | Session token required by every mutating route; on loopback it is embedded in the served page, off loopback only in a page requested with `?token=T` |
| `--read-only` | `DASHBOARD_READ_ONLY` | off | Rejects every mutating route with 403 and hides the controls (`1`, `true`, `yes`, `on`) |
| — | `DASHBOARD_OPENSHELL_BIN` | `openshell` | CLI binary to invoke (tests point this at the stub) |
| — | `DASHBOARD_OSA_BIN` | `../bin/osa`, else `osa` | `osa` binary for host-change and full status checks and resolve actions: this variable, else the repository's `bin/osa` next to the dashboard, else `osa` on `PATH` |
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

Read routes (no token required on loopback; on a non-loopback bind every
route below needs `X-Dashboard-Token`, `/` needs `?token=`, and the stream
needs `token=` as it already does):

| Route | Returns |
|---|---|
| `GET /` | Page shell with the session bootstrap. Off loopback: `GET /?token=T` |
| `GET /api/doctor` | CLI presence, gateway reachability, read-only state |
| `GET /api/sandboxes` | Sandbox inventory (`name`, `phase`, labels, notes, and `denials`: `{unmatched, window, readAt}` from the last denials read, or `null`) |
| `GET /api/sandboxes/:name` | Detail: policy source/revision, providers, revision list |
| `GET /api/sandboxes/:name/policy?view=base\|full` | Base or effective policy |
| `GET /api/sandboxes/:name/rules?status=pending` | Rule proposals parsed from `rule get` |
| `GET /api/sandboxes/:name/denials?window=15m\|1h\|6h[&refresh=1]` | `{denials: {window, capped, unparsed, unparsedSamples, readAt, groups: [{host, port, binary, count, firstSeen, lastSeen, reasons, matches}]}}`, `matches` holding the chunk ids of the pending proposals each group matches. Requires `X-Dashboard-Token`, in read-only mode too. 400 for another window; cached 30 s per sandbox and window unless `refresh=1` |
| `GET /events/logs?name=:name&token=:token` | SSE log stream (ring-buffer replay, heartbeat comments). Requires the page's session token |
| `GET /api/projects[?refresh=1][&path=P]` | Registry entries with `pending`, `orphan`, `note`, `fingerprintResult`, `checkedAt`, `busy`, `idle` (from the cached quick status, or `null`), and per-row `osaError`; `refresh=1` drops the host-change cache. With `path`, only the rows registered at host path `P`, and only that path is checked or dropped |
| `GET /api/projects/:sandbox/status` | `osa status <host_path> --json`, narrowed to that sandbox; 404 for a sandbox not in the registry |
| `GET /api/projects/:sandbox/health` | `{health}`: `osa health <sandbox> --json` (idle stop, MCP readiness, doctor checks); 404 for a sandbox not in the registry, 504 after 30 s. Not cached |
| `GET /api/projects/:sandbox/patch` | The retained patch `{name, size, truncated, text}`. Requires `X-Dashboard-Token`, in read-only mode too |

Project routes accept GET only, except the resolve route below, which accepts
POST only; any other method returns 405 and runs nothing.

Mutating routes require the `X-Dashboard-Token` header and fail with 403 in
read-only mode:

| Route | Action |
|---|---|
| `POST /api/sandboxes` | Create from configured defaults (`{name, image?, policy?, providers?, cpu?, memory?}`) |
| `POST /api/sandboxes/:name/start` \| `/stop` \| `/delete` | Lifecycle |
| `POST /api/sandboxes/:name/rules/:chunkId/approve` | Approve a pending proposal |
| `POST /api/sandboxes/:name/rules/:chunkId/reject` | Reject with required `{reason}` |
| `POST /api/projects/:sandbox/resolve` | `{action}`, one of `apply`, `branch`, `drop`, `rescue`, `discard`: runs `osa resolve <sandbox> <action> --json`, with `--yes` added by the server for `drop` and `discard`. Returns `osa`'s `{sandbox, action, ok, changed, message}` plus `exitCode`: 200 for exit 0, 409 for exit 2 (refused, nothing changed). 400 for an unknown action, 404 for a sandbox not in the registry, 409 while a resolve for that sandbox runs, 502 for exit 3 or unparsable output (stderr in `error.detail`), 504 after 60 s (120 s for `rescue`) |

CLI failures return a structured body
(`{"error":{"kind":"missing_cli|exit|invalid_json|timeout|...","message":"..."}}`)
that the UI renders as an error banner while keeping the last good data on
screen.

## Security notes and threat model

The dashboard is a local operator tool, not a hardened service. What it does:

- **Loopback by default.** `127.0.0.1` only. Binding elsewhere is possible but
  requires an explicit token, prints a warning, and switches on token-gated
  reads (below); there is no TLS in v1, so for remote access prefer an SSH
  tunnel to the loopback port.
- **`Host` is validated on every request, in both modes.** A loopback bind
  accepts only `127.0.0.1`, `localhost`, and `[::1]` (with the bound port or no
  port); any other `Host`, including a DNS name an attacker has rebound to
  `127.0.0.1`, gets 403 before the page or any API route. A concrete
  non-loopback bind also accepts its own address. A wildcard bind
  (`0.0.0.0`, `::`) cannot list the machine's names, so it accepts any `Host`
  and relies on the token; bind a concrete address if you want rebinding
  protection there.
- **Session token on mutations and streams.** A random token is minted at
  startup unless `--token` is given and required as `X-Dashboard-Token`.
  Cross-site form posts cannot set that header, and no CORS headers are
  served, so a malicious page cannot read responses either. On loopback the
  token is embedded in the served page; off loopback see
  [Remote bind](#remote-bind).
- **Log streams require the page token.** `GET /events/logs` checks the token
  as a `token` query parameter (the browser's `EventSource` cannot send
  headers) and returns 403 without spawning a log process. Read-only mode
  still requires it, but continues to reject every mutation.
- **Denials require the token too.** Denial groups carry log content (host
  names, binary paths), so `GET /api/sandboxes/:name/denials` requires
  `X-Dashboard-Token` in both modes and returns 403 before any CLI call.
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
- **No host bind mounts.** The dashboard only shells out to `openshell` and
  `osa`, and only with argv arrays (never through a shell). The only `osa`
  commands it can run are `status PATH --json`, `status PATH --quick --json`,
  `health SANDBOX --json`, and `resolve SANDBOX ACTION --json` with `--yes`
  for `drop` and `discard` only; one allowlist check in `src/projects.ts` refuses every other argv.
- **Project writes go through `osa resolve` only.** The dashboard itself never
  creates, modifies, or deletes a file in the osa state root or a registered
  host project. The resolve route is the only project route that is not GET.

Threat model. The dashboard guards three assets:

1. **The gateway**: mutating sandboxes and approving rules. Unchanged from v1.
2. **Host project trees and git refs**, newly writable: **Apply** writes the
   patch's files into the working tree, and **Branch** creates an
   `osa/<sandbox>-<timestamp>` ref.
3. **The osa state root**, newly writable: **Drop** clears the marker and moves
   the patch into `dropped/`, **Rescue** adds a `rescue-<timestamp>/` folder,
   and **Discard** replaces the sandbox workspace and clears the marker.

The main risks are (1) another local process reaching the loopback port and
(2) a browser tricking the operator's session into requests. The host writes
sit behind the same guards as every other mutation, plus their own:

- the session token in `X-Dashboard-Token`, which a cross-site form post or a
  DNS-rebound page cannot set, and the token never leaves the page;
- read-only mode, which refuses the resolve route with 403 before any argv is
  built;
- a fixed argv: the client sends only an action name from a set of five, the
  server adds `--yes` itself, and the sandbox must be a registry entry (no
  path, no other `osa` command, no extra flags);
- `osa`'s own checks: a dry run before Apply, a temporary worktree for Branch,
  refusal of the wrong pending kind, and a lock that refuses a resolve while a
  session runs (and a session while a resolve runs);
- in the UI, typed sandbox names for Drop and Discard and the touched-file list
  before Apply. These guard against slips, not attackers; the token is the
  security guard.

### Remote bind

Loopback and non-loopback binds differ on purpose. On loopback (the default)
the page embeds the token, reads are open, and mutations require the header: a
local process can read the token from the same page, so requiring it earlier
would add friction and no security. Off loopback the token is the only thing
between the network and your projects, so:

- `GET /` requires `?token=<token>`; only then is the bootstrap, including the
  token, rendered. Open `http://HOST:PORT/?token=<token>` once; the page then
  sends the token as `X-Dashboard-Token` on its API calls and as `token=` on its
  log stream.
- every `/api/...` route, reads included (`/api/doctor`, `/api/sandboxes`,
  `/api/projects`, policy, rules, status, patch), requires `X-Dashboard-Token`;
  `/events/logs` requires `?token=`.
- an unauthenticated request gets 403 with a generic body: no token, no
  project, sandbox, policy, rule, log, or host-path data, and no `openshell` or
  `osa` command runs. The static `/app/*.js` modules stay open; they contain
  code only, and the browser loads them without the token.
- `--read-only` keeps refusing every mutation, with or without the token, and
  still requires the token for the page, reads, and logs.

The token travels in the URL query for the page and stream, and there is no
TLS, so use an SSH tunnel to a loopback bind for anything beyond a trusted
network.

**What read-only mode guarantees**: no host writes at all. Every project route
is GET, the resolve route answers 403, and the page shows no resolve control.
`DASHBOARD_READ_ONLY=1` (or `--read-only`) is the setting for any shared or
non-loopback use.

**What a holder of the token can now do**, beyond the gateway mutations: the
five resolve actions, for registered sandboxes, and nothing else on the host.
Drop and Rescue are recoverable (the dropped patch stays on disk; Rescue only
adds a folder); Apply and Branch are undone with git; Discard keeps every
patch file but replaces the sandbox workspace. A leaked token is therefore
more serious than in v1, which is another reason to keep the dashboard on
loopback and use read-only mode wherever the token may travel.

Anyone with local access to the host can already run `osa resolve`, the
front-ends, and the authenticated `openshell` CLI, so the dashboard adds no
new trust boundary; it makes those capabilities reachable from a browser tab.
It holds no credentials, so compromising it does not leak gateway secrets
directly.

Patches are host source code, which is more sensitive than gateway metadata.
The patch route therefore requires the session token as `X-Dashboard-Token`
in read-write and read-only mode alike, so a page that reaches the port (for
example through DNS rebinding) cannot read it. It serves a patch only when
the sandbox is in the registry and the marker's `patch` path resolves, after
following symbolic links, to a regular file directly inside that sandbox's
`sessions/<sandbox>/` directory, reads at most 2 MiB, and returns it as JSON
text that the page renders as text nodes. Outcome messages from `osa resolve`
are rendered the same way.

## Known limitations

- **Per-sandbox image is not exposed by `openshell` 0.1.2.** `sandbox list` and
  `sandbox get` omit `spec.template.image`, so the inventory shows the
  configured image from `config.toml` with a `(configured)` label — the same
  approach as `maki-oss status` — rather than guessing per-sandbox values.
- **`rule get` has no JSON output mode.** The dashboard parses the CLI's stable
  field-per-line table (covered by tests); a future CLI JSON mode can replace
  that parser behind `src/openshell.ts`.
- **Egress denials come from the log shorthand only.** `openshell logs` has no
  JSON mode, so denials are parsed from its OCSF shorthand lines. The OCSF JSON
  export would be easier to parse, but its files live in the sandbox
  supervisor's filesystem, which `openshell sandbox exec` cannot read, so the
  CLI's log output is the only source the dashboard can reach. Gateway-side
  `CONFIG:*` events and L7 events are not grouped (L7 denials count as
  unparsed), and denials are not kept across reads or restarts.
- Policy editing stays file-based; the dashboard is view-only for policy.
- No multi-user support or remote gateway support in v1; the only authentication
  is the single shared session token, required for everything on a
  non-loopback bind and for mutations, streams, and patches on loopback.

## Testing

```sh
bun test              # adapter, project reader, routes, guards, SSE lifecycle
bun run scripts/browser-check.ts   # real headless Chrome against the stubs
```

Tests put `test/stub` first on `PATH` (or set `DASHBOARD_OPENSHELL_BIN`) and
never touch a real gateway; the browser check uses the same stubs and a
throwaway Chrome profile. `test/stub/openshell` records argv, returns pinned
v0.1.2 JSON shapes, simulates lifecycle state, can emit timed log lines, and
answers a one-shot `logs --since` read with a denial fixture (real and upstream
shapes, IPv6, ANSI color, an unknown layout, a markup host) or a failure.
`test/stub/osa` answers `status PATH [--quick] --json` (with `busy` and
`idle` when the fixture says so), `health SANDBOX --json` (built-in reports:
all ok, a failing MCP gate, unsupported MCP, a partial error, markup in a
detail), and `resolve SANDBOX ACTION --json [--yes]` from a JSON fixture, logs argv, and can succeed, refuse (exit 2), fail (exit 3), answer
slowly, hang, or print invalid JSON. `test/state-fixture.ts`
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
