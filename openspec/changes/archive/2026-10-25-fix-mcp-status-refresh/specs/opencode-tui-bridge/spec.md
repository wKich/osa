## ADDED Requirements

### Requirement: Announce MCP status once a child reports its tools
The bridge SHALL emit `mcp.status.changed` for each configured MCP server
when a Maki child announces its tools on `system.init`.

#### Scenario: The dialog shows the server connected
- **WHEN** a session's child has started with the journey server's tools and
  the user opens `/mcps`
- **THEN** the dialog lists `journey` as connected, not connecting
