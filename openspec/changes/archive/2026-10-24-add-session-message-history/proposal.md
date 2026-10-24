# Proposal

## Why

The `resume-session-history` pilot is `broken`: after the TUI restarts and
reopens an earlier session, the transcript stays empty (`history-visible`
unreached), offline and live. A cold TUI reads the transcript from
`GET /api/session/{sessionID}/message` (`client/src/solid/data.ts` v2.0.32
L1690–L1716); the bridge answered that route with the deferred empty list.

## What Changes

- The bridge projects every frame it emits for a session into that session's
  transcript — user messages at delivery, assistant messages with their text,
  reasoning and tool parts, step completion, and idle markers — the shapes of
  `schema/src/session-message.ts` v2.0.32 L75–L300, applied as the client's
  mirror applies them (`client/src/solid/data.ts` L792–L1106).
- `GET /api/session/{sessionID}/message` answers it, paged like the real
  handler (default 50, newest first, `order`, `type`, and base64url cursors
  naming the boundary message, `server/src/handlers/message.ts` L9–L65).
- Route `GET /api/session/{sessionID}/message` becomes `served-live` with the
  new feature `session-message-history`; the deferred-surface requirement no
  longer lists it.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: the deferred read-surface requirement drops message
  history; a new requirement serves it.

## Impact

`bridge/src/history.ts`, `bridge/src/bridge.ts`, `bridge/test/session-history.test.ts`,
`bridge/test/deferred-session-surfaces.test.ts` (comment),
`bridge/compat/statuses.json`, `bridge/compat/journeys.json`, journey evidence,
`docs/compatibility.md`. History lives in the bridge process, like every other
session it serves; no sandbox, egress, or credential change.
