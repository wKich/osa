# Proposal

## Why

`interrupt-running-turn` diverged at `interrupted`: the reference footer reads
`Build · <model> · <duration> · interrupted` with no token counter, the Maki
side showed no `interrupted` marker and a counter of `1`. OpenCode fails an
interrupted step with `session.step.failed` and the error
`{type: "aborted", message: "Step interrupted"}` (`core/src/session/runner/step.ts`
v2.0.32 L63, L225; `publish-llm-event.ts` L420–L437), which the footer reads
(`tui/src/routes/session/index.tsx` L1903); the bridge ended the step with
`session.step.ended`, carrying the cancelled result's usage (defect
`interrupted-step-not-failed`).

## What Changes

- A turn whose error result follows a TUI interrupt ends its step with
  `session.step.failed` (`Step interrupted`, no usage), then
  `session.execution.interrupted` as before.
- The defect closes; `interrupt-running-turn` (newly scripted with a paced
  turn) is recorded offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the interrupt requirement names the step frame.

## Impact

`bridge/src/translator.ts`, `bridge/test/interrupt.test.ts`, defects,
statuses, journeys, evidence, the report. No sandbox, egress, or credential
change.
