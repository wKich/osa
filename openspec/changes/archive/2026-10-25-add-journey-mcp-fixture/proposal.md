# Proposal

## Why

`manage-mcp-servers` and `answer-mcp-form` need an MCP server that both
sides run: the reference connects it from its OpenCode config, the offline
Maki side reports it from the sandbox user's `mcp.toml`, and the live
sandbox's real Maki runs it. The harness configured no server on any side,
so neither journey could be recorded.

## What Changes

- `harness/mcp-server.ts`: a dependency-free stdio MCP server, `journey`.
  It has two tools. `marker` returns `MCP-MARKER`. `ask_color` sends an
  `elicitation/create` form only to a client that advertised elicitation on
  `initialize`, as MCP requires, and otherwise says it could not ask.
- A journey's `mcp: true` configures it everywhere:
  - the reference config, as a local server with Code Mode off so its tools
    are called directly as Maki calls them (`core tool.ts` v2.0.32
    L234–L235), with an `ask` permission rule mirroring Maki's prompt for
    an MCP tool;
  - the offline sandbox user's `mcp.toml`, with the scripted child
    advertising `journey__marker` and `journey__ask_color`;
  - the live journey config, uploading the script next to `mcp.toml`. The
    pinned image's Bun runs it.
- Request logs name `/api/experimental/mcp/<server>` paths `{server}`.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement adds the MCP fixture.

## Impact

`bridge/test/journeys/harness/{mcp-server,mcp,journey,record,live-sandbox,live}.ts`
and the record test. Journeys without `mcp` are unchanged: the reference
config and the live `mcp.toml` stay as they were. No egress: the server is a
local process on every side.
