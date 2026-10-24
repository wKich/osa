# Proposal

## Why

Live, `allow-permission-once` shows the footer context counter `4` where the
reference shows `2`. The TUI's counter is the last assistant step's tokens
(`tui/src/util/session.ts` v2.0.32 L45–L59), and OpenCode reports one step per
model call. The bridge fills `session.step.ended.tokens` from Maki's `result`
usage, which is the run's total across model calls (`Done.usage` =
ledger totals, `maki-agent/src/agent/run.rs` v0.6.4 L868–L882;
`sdk_mode.rs` L1162–L1178). Each `assistant` frame already carries its own
call's usage (`sdk_mode.rs` L151–L158, L1090–L1112). Offline hides the bug:
the scripted child reports per-call usage in its `result`.

## What Changes

- `session.step.ended.tokens` takes the usage of the turn's last `assistant`
  frame; the `result` usage is the fallback.
- Session totals (`GET /api/session/{id}` `tokens`) keep the run total.
- The scripted child puts per-call usage on each `assistant` frame and the
  run total on `result`, as the pinned child does.
- Defect `step-tokens-cumulative` closes; `allow-permission-once` re-records
  offline and live.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: the turn-completion scenario names which usage the
  step carries.

## Impact

`bridge/src/translator.ts`, `bridge/test/fake-maki.ts`, a translator test,
goldens, `bridge/defects.json`, journey evidence, `docs/compatibility.md`. No
sandbox, egress, or credential change.
