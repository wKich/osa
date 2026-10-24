# Proposal

## Why

The `send-prompt-stream-reply` pilot's accepted `streamed` difference hid a
second one: the reference tab shows the unread marker `•` after the reply and
the Maki tab does not. The TUI derives unread from `Session.Info.time.idle`
and `time.viewed` (`tui/src/context/session-tabs.tsx` v2.0.32 L122–L125) and
acknowledges a seen transition with `POST /api/session/{sessionID}/view`
(L211–L238). The real server records `time.idle` and `outcome` at every
terminal execution transition (`core/src/session/projector.ts` L412–L440);
the bridge never set either, so a Maki session never reads as unread and its
outcome is unknown to the TUI.

## What Changes

- On `session.execution.succeeded`, `failed`, or `interrupted` (not a
  shutdown interrupt) the bridge sets the session's `time.idle` to the
  frame's `created`, strictly advancing, and `outcome`, before the frame is
  sent; session reads return them.
- `POST /api/session/{sessionID}/view` follows the real server: it ignores a
  watermark for no transition, a future one, or one already covered, keeps
  `time.viewed` monotone, and emits `session.viewed`. The route is now
  measured from the journeys, so it joins the reachable set as `served-live`.
- The pilots' post-turn checkpoints wait for the screen to settle: the
  marker is a transient on both sides (it fades once the TUI views the
  session), so an unsettled capture compares timing, not behavior.
- The pilots' title and bash-result differences are accepted with reasons
  that say why the Maki screen is correct.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds the session idle-state requirement.

## Impact

`bridge/src/bridge.ts`, `bridge/test/session-idle.test.ts`, the pilot
scripts, `bridge/compat/statuses.json`, `bridge/compat/journeys.json`, journey
evidence, `docs/compatibility.md`. No sandbox, egress, or credential change.
