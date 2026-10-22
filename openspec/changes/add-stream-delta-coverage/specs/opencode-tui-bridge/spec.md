# Spec Delta

## MODIFIED Requirements

### Requirement: Translate the prompt into an OpenCode transcript
The bridge SHALL accept a prompt on the OpenCode prompt endpoint and emit SSE
event frames covering reasoning, text, tool, step, and execution boundaries as
Maki reports them, for both streamed and non-streamed Maki output. The
transcript SHALL be causally ordered: a frame representing the user's prompt
precedes every assistant frame the prompt caused, within a turn and across
turns.

#### Scenario: Plain text turn renders
- **WHEN** the user submits a prompt and Maki returns an assistant text part
- **THEN** the bridge emits `session.text.started`, one or more
  `session.text.delta`, and `session.text.ended` carrying the full text

#### Scenario: Reasoning and tool parts render
- **WHEN** the assistant message carries thinking and tool_use parts
- **THEN** the bridge emits the corresponding `session.reasoning.*` and
  `session.tool.input.*`/`session.tool.called` frames, and maps each
  tool_result to `session.tool.success` or `session.tool.failed`

#### Scenario: Turn completion is reported
- **WHEN** Maki emits a `result` frame
- **THEN** the bridge emits the matching `session.step.ended` with usage and
  finish status, and `session.execution.succeeded` or `session.execution.failed`

#### Scenario: Event stream opens correctly
- **WHEN** the TUI connects to the event stream
- **THEN** the first frame is `server.connected` and subsequent frames follow
  the wire format the real server uses

#### Scenario: Prompt renders before its response
- **WHEN** the user submits a prompt and the session produces assistant
  output, across one or more turns
- **THEN** the emitted transcript places a user-role representation of each
  prompt before the assistant frames it caused, so the rendered conversation
  interleaves Q-A-Q-A instead of grouping all answers before all questions

#### Scenario: Streamed deltas render incrementally, once
- **WHEN** a recorded Maki fixture replays a turn whose parts arrive as
  `stream_event` frames (`content_block_start`/`*_delta`/`content_block_stop`
  in the sdk_mode-derived envelope) followed by the buffered `assistant`
  message carrying the same parts
- **THEN** the projected transcript emits each part's `started`, one delta
  frame per streamed chunk, and `ended` carrying the full text — and the
  buffered message adds no duplicate part frames, with `message_*` frames
  emitting nothing
