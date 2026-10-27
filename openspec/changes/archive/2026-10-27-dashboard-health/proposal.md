# Proposal

## Why

A sandbox can stop on its own after its idle period, an MCP server can be configured on the host yet unusable in the sandbox, and a missing image or engine can block the next session. Today each of these is only visible by running `maki-oss status`, `mcp status`, or `doctor` in the right folder and reading text. The dashboard shows none of it, so a user looking at the Projects view cannot tell why an agent lacks a tool or when its sandbox will stop. M3 adds that health view. The idle, MCP, and doctor logic lives in the front-ends, so the dashboard asks `osa` for it rather than copying it or parsing text.

## What Changes

- Add **`osa health SANDBOX --json`**, a read-only command. Like full status, it hands off to the owning front-end through an internal `__health-json`, which reports:
  - **idle stop**: the setting, the state (`off`, `session running`, `counting down`, `stopped`, `skipped`, `failed`), the deadline when counting down, and the last idle event;
  - **MCP readiness**: per server, each gate with pass/fail and the fix text, from the same code as `mcp status`, or `unsupported` for a front-end without it;
  - **doctor**: each check (`ok`, `fail`, `skip`, `warn`) with its detail, from the same code as `doctor`.
- Add **`idle`** to `osa status --quick --json` (state and deadline only, read from files), so the Projects view can show a countdown without touching the gateway.
- In the dashboard, add a **Health panel** to the project row and the sandbox detail view, loaded on demand: a live idle countdown, an MCP gate table with fixes, and a doctor checklist. Rows show the idle countdown from quick status.
- Extend the dashboard's existing header status (`/api/doctor`: CLI and gateway) with a link to the per-agent doctor results.

Out of scope: changing the idle setting, attaching providers, or fixing gates from the browser (M4 covers setup); a health history.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `osa-project-layer`: MODIFIED "osa entry point" (adds `health` as a read-only command). MODIFIED "osa status reports a project across agents" (quick JSON gains `idle`). ADDED "osa health reports a sandbox's health".
- `dashboard`: ADDED "Project health panel" and "Idle stop countdown".

## Impact

- `bin/osa`: `health` parsing, registry lookup, front-end dispatch; `idle` in quick status.
- `lib/oss-core.sh`: `__health-json`; `doctor` and `mcp status` split into a check-collecting core used by both the text commands and the JSON emitter; an idle state reader over the session's idle stamp and log.
- `lib/osa-state.sh`: the idle state reader, shared with `bin/osa` for quick status.
- `bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`, `bin/codex-oss`: route `__health-json`.
- `dashboard/src/projects.ts` (argv gate `health <sandbox> --json`), `server.ts` (`GET /api/projects/:sandbox/health`), `src/app/health.js` (new), `projects.js`, `detail.js`.
- Tests: `tests/run-tests.sh`, `dashboard/test/stub/osa`, dashboard tests, one browser journey.
- `docs/helper.md`, `dashboard/README.md`.
- No new network endpoints, bind mounts, or secret paths. `osa health` never prints credential values; MCP and doctor output already avoid them.
