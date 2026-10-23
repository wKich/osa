# Design

## Context

Pinned evidence, cited before code:

- OpenCode v2.0.32 TUI:
  - `tui/src/context/session-terminals.tsx` L62–L77 offers terminals unless
    `capabilities.persistentPty === false`.
  - `tui/src/component/dialog-pair.tsx` L22–L34 builds URLs from `urls[]`.
  - `tui/src/component/prompt/index.tsx` L1159–L1164 needs a primary agent to
    submit. L1312–L1325 POSTs `session.command` for a listed command name.
  - `tui/src/feature-plugins/sidebar/mcp.tsx` shows `/api/mcp` rows as
    servers.
- Maki v0.6.4 `src/sdk_mode.rs`:
  - `slash_commands: []` (L624), and `SdkParams` (L542–L557) carries no
    commands.
  - `initialize` ignores `agents` (L828–L839), and there is no `set_agent`
    (L818–L880).

## Decisions

1. **Info is bridge state.** The bridge is the server the TUI attached to, so
   its own pid, URL and lack of PTYs are the true values. The version stays
   pinned because a mismatch warns.
2. **Empty, not fabricated.** A list with nothing behind it answers `[]`.
   `/api/mcp` empties now and is filled from the sandbox by
   `mcp-server-status`. The skill, model, provider and integration lists keep
   their current answers until their capability changes land.
3. **One agent named `build`.** This is Maki's name for its default mode
   (`maki-ui/src/app/mode.rs` L15–L19). Sessions report it too, so the goldens
   change only in that id.

## Risks / Trade-offs

- An empty `/api/mcp` hides configured servers until `mcp-server-status`
  lands. That is better than one phantom connected server.

## Observed after the fix

`make test-ui` against the real TUI: 36 requests served without 404, and PONG
plus the permission round trip pass. The TUI no longer calls
`GET /api/experimental/session/{id}/terminal`, because `persistentPty: false`
keeps it from opening terminals. The route stays reachable through
`bridge/test/fixtures/bridge-requests.jsonl` and is `deferred` with its test.
