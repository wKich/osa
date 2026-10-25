# Proposal

## Why

Connecting or disconnecting an MCP server from `/mcps` does nothing under the
bridge. Maki v0.6.4 starts its servers with the child and has no runtime MCP
control over stream-json (`src/sdk_mode.rs` L818–L880), so `mcp-toggle` is
`degraded` and `manage-mcp-servers` diverges. A `tool.*.input` layer sees every
MCP call as `mcp__<server>__<tool>` and can block it
(https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/hooks/_index.md,
"Wrapping every tool").

## What Changes

- On `POST /api/experimental/mcp/{server}/disconnect`, the bridge marks the
  server disconnected in the mailbox and reports it `disabled` in `GET /api/mcp`
  and `mcp.status.changed`. `connect` clears the mark for a server Maki started.
- The `maki_bridge` plugin's `tool.*.input` layer refuses calls to a
  disconnected server with a message the model reads, so the server's tools stop
  working as they do in OpenCode.
- Partial by design: the server process keeps running and its tools stay in the
  model's tool list. `connect` cannot start a server that was not configured
  when the child started. Those limits stay pin-blocked with their citation.
- `mcp-toggle` stays `degraded` with a narrower title. `manage-mcp-servers` is
  re-recorded, and its remaining difference stays pin-blocked or becomes an
  accepted diff.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `maki-bridge-plugin`: adds the disconnected-server gate.
- `opencode-tui-bridge`: MCP connect and disconnect change what the session can
  call and what the status routes report.

## Impact

- Depends on `add-maki-bridge-plugin`.
- `bridge/src/` MCP routes (connect and disconnect move off `served-faked`);
  plugin layer; MCP journey fixture; `statuses.json`.
