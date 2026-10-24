# Proposal

## Why

Recording `copy-session-content` showed the transcript-copied toast on both
sides, but the Maki side's copied text was built from a synthesized sample:
"Copy session transcript" and `/export` both read
`GET /api/experimental/session/{sessionID}/export`
(`tui/src/routes/session/index.tsx` v2.0.32 L1191–L1240), which the bridge
answered from the spec. The screen matched while the behavior was wrong.

## What Changes

- The bridge answers `session.export` with the session read and its settled
  transcript, oldest first (`core/src/session/transfer.ts` v2.0.32 L56–L62),
  from the projected history (add-session-message-history); `sanitize=true`
  redacts content the way the real transfer does (L165–L348).
- Route `served-live`/reachable with feature `session-export`.
- Recorded alongside: `pin-session`, `clear-session`, `switch-session-tab`,
  `close-reopen-session-tab`, `jump-to-message`, `copy-session-content`,
  `export-session-transcript`, `adjust-transcript-display` — all `parity`
  offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the session export requirement.

## Impact

`bridge/src/history.ts`, `bridge/src/bridge.ts`,
`bridge/test/session-history.test.ts`, statuses, journeys and their
evidence, the report. No sandbox, egress, or credential change.
