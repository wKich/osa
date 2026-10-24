# Proposal

## Why

Scripting `see-failed-turn-error` and `see-provider-retry` (with the
`extend-journey-turns` failure turns) exposed three gaps in how the bridge
maps a failing or retried model call:

- `failed-step-not-failed`: a failed run ended its step with
  `session.step.ended` (finish `error`), so the TUI showed no `Error:` line
  under the turn. OpenCode fails the step with `session.step.failed`
  carrying the error (`client/src/solid/data.ts` v2.0.32 L933–L945; the
  footer renders it, `tui/src/routes/session/index.tsx` L1905–L1909).
- `retry-scheduled-attempt-and-time`: `session.retry.scheduled` carried
  Maki's failure count and the current time; the pinned event names the
  upcoming attempt and when it runs (`core/src/session/runner/retry.ts`
  L67–L110), so the TUI read `Retry due · attempt 1` instead of
  `Retrying in 1s · attempt 2`.
- `retry-row-never-clears`: after the retry the reply rendered under a stale
  `Retry due` row. OpenCode starts each retried attempt with
  `session.step.started` on the same message, which clears the row
  (`client/src/solid/data.ts` L881–L895).

## What Changes

- A failed (non-interrupted) run emits `session.step.failed` with
  `{type: "Error", message}` and then `session.execution.failed`.
- `session.retry.scheduled` names `attempt` = Maki's count + 1 and `at` = now +
  `retry_delay_ms` (Maki counts failures and names its backoff,
  `maki-agent/src/agent/streaming.rs` v0.6.4 L214–L325).
- The first frame of the attempt after a retry (or a further retry) restarts
  the step on the same assistant message.
- The three defects close; both journeys are recorded offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the transcript requirement's failed-turn scenario
  and a retry scenario.

## Impact

`bridge/src/translator.ts`, `bridge/test/{tool-frames,golden}.test.ts`,
goldens, defects, statuses, journeys and evidence, the report. No sandbox,
egress, or credential change.
