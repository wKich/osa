# Proposal

## Why

`answer-agent-question` is the permission area's question journey: the agent
asks with its question tool and the TUI shows a form. Recorded, the Maki
side shows `→ Asked 1 question` and the reply, with no form, offline and
live. Real Maki 0.6.4 runs the tool with no UI and dismisses it, and its SDK
wire cannot raise a question to the bridge.

## What Changes

- Record `answer-agent-question` (reference, offline, live; `diverges`).
- `blockedBy: "pin"` with the citation: `plugins/question/question_form.lua`
  L598–L628, `maki-lua/src/api/ui/mod.rs` L749–L755, `src/sdk_mode.rs`
  L1122–L1160 at v0.6.4.
- Feature `agent-questions` (`degraded`, pin).

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: a pin-blocked journey scenario.

## Impact

Catalog rows and the journey's snapshots. No bridge or harness change.
