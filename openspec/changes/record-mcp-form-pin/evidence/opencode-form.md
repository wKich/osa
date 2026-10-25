# OpenCode 2.0.32: an MCP form is created but not presented (2026-10-25)

Measured with the harness's journey MCP server (`bridge/test/journeys/harness/mcp-server.ts`).

- The server's `elicitation/create` is answered by the MCP TypeScript SDK
  client (1.32.2) and by OpenCode's own `@modelcontextprotocol/client` 2.0.0
  with the same capabilities OpenCode declares (`elicitation: {form, url}`,
  `roots`): the handler receives the form, the tool returns "The user chose
  red.".
- `opencode serve` 2.0.32 with the same config: after the call,
  `GET /api/form?location[directory]=<workdir>` lists
  `{"sessionID":"global","title":"journey is requesting input",
  "metadata":{"kind":"mcp-elicitation","server":"journey",
  "message":"Which color should the journey use?"},"fields":[…]}`.
- The 2.0.32 TUI in a session never shows it (`routes/session/index.tsx`
  L209–L215 lists global forms for the session's location; client
  `solid/data.ts` L1283–L1288, L1817–L1824 keep a global form only with a
  location key equal to the session's). The call spins until interrupted;
  `/reload` rebuilds the MCP connection and cancels it.

## Draft upstream issue (not posted)

**Title:** MCP elicitation form is created but never shown in the TUI session

**Body:** With a stdio MCP server that sends `elicitation/create` during a
tool call, OpenCode 2.0.32 creates a global form (visible in
`GET /api/form`) but the session view never renders it; the tool call waits
until interrupted. Expected: the form appears in place of the composer.
Repro: any server whose tool sends a form-mode elicitation; the harness
server above is self-contained.
