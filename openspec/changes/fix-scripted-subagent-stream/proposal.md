# Proposal

## Why

The first live run of `open-subagent-session` showed the subagent's reply
`MARK` in the parent's transcript, which the offline run did not. With
partial messages on, the pinned child streams a subagent's text and tool
calls as `stream_event` frames with no subagent flag — its `TextDelta`,
`ThinkingDelta`, and `ToolStart` arms ignore `envelope.subagent`
(`src/sdk_mode.rs` v0.6.4 L1022–L1050) — and flags only the buffered
frames. The scripted child emitted the buffered frames alone, and with no
model beat, so the offline run could neither reproduce the leak nor time the
subagent's turn.

## What Changes

- The scripted child streams each subagent call unflagged before its flagged
  buffered frame, and waits the mock provider's model beat (300 ms) before
  each subagent call.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the subagent-call scenario names the unflagged
  stream.

## Impact

`bridge/test/fake-maki.ts`, the scripted-child test. No bridge runtime
change; the bridge's routing of those frames is its own change.
