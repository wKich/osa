# Proposal

## Why

`open-subagent-session` needs the agent to start a subagent whose own model
call is served by the journey's mock provider. On the reference side the
subagent tool runs a child session against the same provider, so the turns
are consumed in order; the scripted Maki child had no way to emit a
subagent's frames, so offline the Maki side could not show one.

## What Changes

- A `call` turn may set `subagent: true`: the turns after it, through the
  first text turn, are the subagent's calls. The scripted child emits them as
  buffered frames flagged with the task call's `parent_tool_use_id`, with no
  stream events, and answers the task with the subagent's final text — the
  shape the captured live fixture `bridge/test/fixtures/maki-subagent-live.jsonl`
  shows; a subagent shell turn runs in the workdir like any other.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement names the subagent call.

## Impact

`bridge/test/journeys/harness/journey.ts`, `bridge/test/fake-maki.ts`, the
scripted-child test. No bridge runtime change.
