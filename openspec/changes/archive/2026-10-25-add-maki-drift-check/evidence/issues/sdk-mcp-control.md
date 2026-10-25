# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: connect and disconnect MCP servers at runtime

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** MCP servers connect when the child starts; stream-json has no control to connect, disconnect or list them (src/sdk_mode.rs v0.6.4 L818–L880), and `system.init` reports `mcp_servers: []` (L623).

**Ask:** Controls to list MCP servers with their status and to connect or disconnect one, with status events.

**Blocks in maki-oss:** mcp-toggle; routes POST /api/experimental/mcp/{server}/connect and /disconnect; journey manage-mcp-servers.
