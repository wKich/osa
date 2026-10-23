# Proposal

## Why

Discovery pass 6 linked `GET /api/session/active` to `session-active-live`.
The bridge always answered `{data: {}}`. The TUI reads this map on every
`server.connected` (`client/src/solid/data.ts` v2.0.32 L637–L654), so a TUI
that reconnected mid-turn showed a running session as idle, with no busy
state or interrupt control until the next execution event.

## What Changes

- The route is answered from bridge state: each session whose translator has
  a turn open and whose child is running maps to `{type: "running"}`, the
  shape the real server returns (`server/src/handlers/session.ts` v2.0.32
  L182–L188).
- `bridge/test/session-active.test.ts` covers it. `session-active-live`
  becomes `verified` and the route `served-live`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the requirement "Report sessions with a turn in
  flight as active".

## Impact

`bridge/src/bridge.ts`, `bridge/src/spec-answers.ts` (the static empty map is
removed), a new test, statuses and the report.
