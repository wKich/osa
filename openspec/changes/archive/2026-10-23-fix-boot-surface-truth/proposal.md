# Proposal

## Why

Two open defects from discovery pass 6 (`rebaseline-compat-iteration-6`):

- `boot-lists-phantom-rows` — the boot lists answer synthesized `sample`
  rows that the TUI renders as real. These include a connected MCP server,
  MCP resources, a running shell, an active plugin, a reference alias, a
  command whose pick POSTs `session.command`, and a `sample` agent.
- `info-advertises-terminals` — `GET /api/info` omits
  `capabilities.persistentPty`. The TUI therefore offers terminals the bridge
  cannot serve, and `urls: ["sample"]` is not a URL.

## What Changes

- `GET /api/info` describes the bridge process: the pinned version, its pid,
  its listen URL, the OS temp dir and `persistentPty: false`.
- The plugin, reference, shell, command, MCP and MCP resource lists answer
  empty. The agent list is the one primary `build` agent.
- `bridge/test/boot-surface.test.ts` proves every answer against the vendored
  contract. The goldens' agent id moves from `sample` to `build`.
- Close both defects. `server-info-live` becomes `verified` and
  `GET /api/info` `served-live`. `GET /api/agent`, `/api/plugin` and
  `/api/reference` are accepted with a reason. `GET /api/shell`,
  `/api/mcp/resource` and the session terminal list become `deferred`.
  `slash-commands` becomes `degraded` (pin).

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the boot surface requirement gains a server-info
  scenario and a no-fabricated-rows scenario.

## Impact

`bridge/src/spec-answers.ts`, `bridge/src/bridge.ts`, a new test, goldens,
statuses, defects, the regenerated report. No new transport or dependency.
