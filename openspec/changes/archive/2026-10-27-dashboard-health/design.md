# Design

## Context

See proposal.md - Why. In place today:

- **Idle stop** (`lib/oss-core.sh`, `arm_idle_stop` and `__idle-watch`): a session writes `sessions/<sandbox>/idle` (a stamp naming the session) and appends to `idle.log` lines such as `armed secs=3600 session=<pid> watcher=<pid>`, `closed session=<pid>`, `superseded`, `busy`, `scan-failed`, `stopped`, `stop-failed`, each prefixed with a local timestamp. These files are internal, not part of the M0 contract. `idle_stop` comes from config (`resolved_idle_stop`), `0` disables it.
- **MCP readiness** (`cmd_mcp_status`, `mcp_readiness_report`): exists in `maki-oss` and `claude-oss`; prints one line per server and gate, exits non-zero on a failing gate. It reads the sandbox's MCP config through the gateway, so it needs a running sandbox.
- **Doctor** (`cmd_doctor` plus each front-end's `agent_doctor_extra`): prints `ok    …`, `fail  …`, `skip  …` lines.
- **`osa`**: full `status` dispatches to `__status-json`; `resolve` to `__resolve`. Quick status reads files only and now reports `busy`.
- **Dashboard**: `/api/doctor` reports CLI and gateway only; `ProjectService` gates `osa` argv through `isAllowedOsaArgv`.

## Goals / Non-Goals

**Goals:**

- The text commands and the JSON come from one set of collected check records, so they cannot disagree.
- The countdown costs no gateway call and no extra spawn beyond the existing quick status.

**Non-Goals:**

- Publishing the idle files as contract. `osa` reads them; other clients use `osa`.
- Health for unregistered sandboxes (raw `openshell` sandboxes in the inventory). They keep the existing detail view.

## Decisions

### D1: Collect checks as records, render twice

`doctor` and `mcp status` are refactored so their checks append records (`section`, `name`, `status`, `detail`, `fix`) to a temporary file instead of printing directly. The text commands render those records exactly as today (the existing tests pin the wording); `__health-json` renders them as JSON with `json_str`. Exit codes of the text commands are unchanged.

Alternatives: parse the text output in `__health-json`. Fragile and a second source of truth. Rejected. Duplicate the checks in a JSON path. Rejected for the same reason.

### D2: Idle state from the stamp and the log, in `lib/osa-state.sh`

`idle_state DIR SECS` reads the last relevant `idle.log` line and the `idle` stamp and prints `state deadline last_event last_time`:

- `SECS` = 0 → `off`; no `idle.log` → `none`;
- last event `armed` (and the stamp still names that session, whose PID is live) → `running`;
- last event `closed` → `counting`, deadline = that line's time + the `secs` from the matching `armed` line;
- `stopped` → `stopped`; `superseded` or `busy` → `skipped`; `stop-failed` or `scan-failed` → `failed`;
- an `armed` whose session PID is dead with no `closed` (the watcher was killed too) → `counting` from the stamp's mtime, marked `estimated`.

The log's local timestamps are converted to UTC once, in `idle_state`, and emitted as ISO 8601 UTC. The function lives in `lib/osa-state.sh` because `bin/osa` needs it for quick status without loading the core; the core's `__health-json` uses it too. `SECS` for quick status comes from the `armed` line, so `bin/osa` does not need the front-end's config.

### D3: `osa health` dispatch

`osa health SANDBOX [--json]` uses the same registry lookup as `resolve` and runs `(cd host_path && <front-end> --name SANDBOX __health-json)`. For an orphan, `osa` itself prints only the idle section (from files) with `mcp` and `doctor` set to `{ "error": "project folder missing" }`. Without `--json`, `osa health` prints the three sections as text by calling the front-end's existing `status`-style renderers.

JSON shape: `{ sandbox, agent, idle: { period, state, deadline, estimated, last_event, last_time }, mcp: { supported, ok, error, servers: [{ name, transport, gates: [{ gate, ok, fix }] }] }, doctor: { ok, error, checks: [{ name, status, detail }] } }`.

MCP on a stopped sandbox reports `error: "sandbox is not running"`; `osa health` never starts it.

### D4: Dashboard calls and caching

- `isAllowedOsaArgv` gains `health <sandbox> --json` (sandbox matching the registry name pattern).
- `GET /api/projects/:sandbox/health` runs it with a 30-second timeout, 404 for an unregistered sandbox. No token is required, like `status`, since it returns check results, not file or log content; it is GET and read-only. No cache: the panel is on demand and the user's Refresh means "run it again".
- Quick status `idle` flows through the existing 60-second quick-status cache into `/api/projects` rows. The client computes `deadline - now` every second from the row data; the server clock and the browser clock are on the same host for a loopback dashboard, and the row shows the absolute deadline on hover for the non-loopback case.

### D5: UI placement

`src/app/health.js` renders the panel (three sections, text only via `h()`) and is opened from a Health button on each project row and from the detail view when the sandbox name is in the registry. The project row gains an idle cell. The header status line, which already shows CLI and gateway, links to the Health panel of the first project with a failing doctor check from the last opened panel; it never runs `osa health` itself.

## Risks / Trade-offs

- [Refactoring `doctor`/`mcp status` changes their text] → The existing text tests stay unchanged and must pass before the JSON emitter is added.
- [The idle log format is internal and may change] → Only `idle_state` reads it, it is tested against the writer in the same suite, and both live in the same repository.
- [Clock skew between `idle.log` local time and UTC] → One conversion point; tested with a non-UTC `TZ`.
- [MCP readiness for a sandbox the user just stopped] → Reported as an error in that section, never a start.

## Migration Plan

None. New read paths only; rollback is a revert.
