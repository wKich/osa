# Proposal

## Why

`answer-mcp-form` was the last unrecorded reachable journey. Maki v0.6.4
cannot answer an MCP form. Its MCP client declares no capabilities on
`initialize` (`maki-agent/src/mcp/protocol.rs` L60), so the journey server
does not ask it, and stream-json has no elicitation message
(`src/sdk_mode.rs` L1122–L1160). Its call returns at once, offline and live.

The reference has a defect of its own at the pin. OpenCode 2.0.32 receives
the journey server's `elicitation/create` and creates the form on its server
(`GET /api/form` lists it). Its TUI does not present it in a session, so the
call stays pending until interrupted. The fixture answers forms correctly with
both the MCP TypeScript SDK and OpenCode's own client library (2.0.0). The
evidence below records this.

## What Changes

- Record `answer-mcp-form` as each side behaves (`diverges`, offline equal to
  live), `blockedBy: "pin"` with Maki's citation; feature `mcp-forms`
  (`degraded`, pin).

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: a pin-blocked journey scenario.

## Impact

Catalog rows and the journey's snapshots only.
