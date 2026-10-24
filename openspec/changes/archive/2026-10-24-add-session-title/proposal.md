# Proposal

## Why

The pilot `send-prompt-stream-reply` accepts its session-title difference with
the reason "the Maki side has no server-side session-title generator". That is
wrong at the pin: Maki titles every session from its first user message when
the run is recorded (`generate_title`, `maki-storage/src/sessions.rs` v0.6.4
L677–L695, applied by `update_title_if_default` from `record_turn`,
`maki-agent/src/session.rs` L203–L217, on each run's end, L143–L166). The TUI
therefore shows the timestamp fallback `New session - <TIME>` where a Maki
session has a real title, in the tab and in the session list
(`resume-session-history`).

## What Changes

- When a session's first run ends, the bridge titles the session with Maki's
  rule applied to the first prompt's text and emits `session.renamed`
  (`schema/src/session-event.ts` v2.0.32 L102–L109); `GET /api/session` and
  `GET /api/session/{id}` carry the title.
- New feature row `session-title`; the pilots' accepted reason is rewritten to
  the true one: the Maki screen shows Maki's own title, OpenCode asks the
  model for one.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds the session-title requirement.

## Impact

`bridge/src/bridge.ts`, a new `bridge/src/title.ts`, a bridge test,
`bridge/compat/statuses.json`, `bridge/compat/journeys.json`, journey
evidence, `docs/compatibility.md`. No sandbox, egress, or credential change.
