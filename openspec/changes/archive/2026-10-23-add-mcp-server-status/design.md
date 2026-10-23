# Design

## Context

- Maki v0.6.4:
  - `maki-agent/src/mcp/config.rs`: `MCP_CONFIG_FILE = "mcp.toml"` (L13).
    `enabled` defaults to true (L105–L107, L158–L160). `merge_config` merges
    global first and project last, a same-named project server replacing the
    global one (L270, L310). Tools are deferred behind `tool_search` above a
    `defer_tools` threshold unless `always_load` (L145–L148, L186–L190).
  - `src/sdk_mode.rs` L610–L625: `tools` lists the advertised tool names,
    `mcp_servers` is `[]`.
- OpenCode v2.0.32: `Mcp.Server {name, status}`. The status is one of
  `connected | pending | disabled | failed{error} | needs_auth{error}`
  (vendored OpenAPI). The sidebar, `/status` and a toast on `failed` read it
  (`tui/src/app.tsx` L525–L545).
- The sandbox config lives at the sandbox user's `~/.config/maki/mcp.toml`
  (`bin/maki-oss` `sandbox_mcp_path`).

## Decisions

1. **Names and `enabled` only.** The bridge keeps nothing else from the file,
   so no URL, header or placeholder leaves the sandbox read.
2. **State only from what is observable.** An advertised `<name>__` tool
   proves the server connected. Without a child, or when MCP tools are
   deferred, nothing is observable, and the answer is `pending` rather than a
   guess. `failed` is reported only when every tool was advertised and none
   came from the server.
3. **No `mcp.status.changed` event.** Its envelope is not pinned in the
   matrices. The TUI re-reads `/api/mcp` on every location sync.

## Risks / Trade-offs

- A connected server that exposes zero tools reads as `failed`. Maki's SDK
  surface has no other signal at the pin.
