# Proposal

## Why

Discovery pass 6 linked `GET /api/mcp` to `mcp-server-status`. The route
listed a phantom connected server, and since `fix-boot-surface-truth` it has
listed nothing. The servers are real: Maki loads them from `mcp.toml`, and
this repository ships them into the sandbox (`mcp-integration`). The pinned
child, however, reports `mcp_servers: []` on `system.init` whatever it loaded
(`sdk_mode.rs` v0.6.4 L623).

## What Changes

- `readMcpConfig` (`bridge/src/sandbox.ts`) reads the global and project
  `mcp.toml` in one sandbox exec and merges them in Maki's order.
- `GET /api/mcp` lists those servers. Each one's state comes from the tools
  the child advertised (`<server>__<tool>`): `disabled`, `connected`,
  `pending` (state not observable) or `failed`.
- The scripted child gains `FAKE_MAKI_TOOLS`. The harnesses give the
  scripted sandbox an empty home, so no host Maki config leaks into a test.
- `bridge/test/mcp-status.test.ts` covers it. `mcp-server-status` becomes
  `verified` and the route `served-live`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the requirement "List the sandbox's MCP servers
  with their observed state".

## Impact

`bridge/src/sandbox.ts`, `bridge/src/bridge.ts`, `bridge/src/spec-answers.ts`,
test seams, a new test, statuses and the report. The sandbox reads use `cat`
only, and no credential is read: `mcp.toml` holds `${VAR}` placeholders, and
only server names and `enabled` are kept.
