# Proposal

## Why

Recording `manage-mcp-servers` with the journey MCP server, the Maki side's
`/mcps` dialog showed `journey  Connecting …` after the server's tool had
already run. The TUI reads `/api/mcp` at boot, before any Maki child exists
(so every server is pending). It refetches only on `mcp.status.changed`
(client `solid/data.ts` v2.0.32 L1332–L1335), which the bridge never sent.
The scripted child also asked permission for an MCP tool under its wire
name, where real Maki asks under `<server>.<tool>` (`maki-agent/src/mcp/mod.rs`
v0.6.4 L51–L52).

## What Changes

- On each child's `system.init`, which settles every configured server's
  status, the bridge emits `mcp.status.changed` per server.
- The scripted child's MCP permission ask names `<server>.<tool>`.
- `manage-mcp-servers` recorded offline and live: list, use, permission,
  dialog at parity, with each runtime's MCP tool names accepted. Toggling the
  server has no effect on Maki, which has no runtime MCP control over
  stream-json (`src/sdk_mode.rs` L818–L880). The journey is `blockedBy:
  "pin"`, with feature `mcp-toggle` (`degraded`, pin) and its connect and
  disconnect routes reachable and pin-blocked.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the MCP status-announcement requirement.

## Impact

`bridge/src/bridge.ts`, `bridge/test/{mcp-status.test,fake-maki}.ts`, rows.
