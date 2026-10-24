## MODIFIED Requirements

### Requirement: Translate the prompt into an OpenCode transcript
The bridge SHALL accept a prompt on the OpenCode prompt endpoint and emit SSE
event frames covering reasoning, text, tool, step, and execution boundaries as
Maki reports them, for both streamed and non-streamed Maki output. Streamed
parts SHALL be rendered from the child's `stream_event` frames as they arrive,
whether the delta variant is carried on the frame itself or nested in a
`content_block_delta` wrapper with its own `delta.type` (the captured wire
shape). The transcript SHALL be causally ordered: a frame representing the
user's prompt precedes every assistant frame the prompt caused, within a turn
and across turns.

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
  finish status, and `session.execution.succeeded` or `session.execution.failed`;
  the step's tokens are the usage of the turn's last `assistant` frame (one
  model call), falling back to the `result` usage only when no assistant frame
  carried usage

#### Scenario: A failed turn reports the failure, not success
- **WHEN** the `result` frame carries the pinned error subtype
  `error_during_execution` (`is_error: true`, its `result` field carrying the
  failure message)
- **THEN** the turn's parts still render, `session.step.failed` carries the
  wire's message as `{type: "Error", message}`, and `session.execution.failed`
  carries the same message — with no `session.step.ended` and no
  `session.execution.succeeded` for that turn

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
- **WHEN** a recorded Maki turn replays whose parts arrive as `stream_event`
  frames (`content_block_start`, then `content_block_delta` frames carrying
  `text_delta` / `thinking_delta` / `input_json_delta` on `event.delta.type`,
  then `content_block_stop`) followed by the buffered `assistant` message
  carrying the same parts
- **THEN** the projected transcript emits each part's `started`, one delta
  frame per streamed chunk, and `ended` carrying the full text — and the
  buffered message adds no duplicate part frames, with `message_*` frames
  emitting nothing

#### Scenario: The authored delta spelling still renders
- **WHEN** a fixture replays the same parts with the delta variant on the frame
  itself (`subtype`) and a flat `delta` string
- **THEN** the projected transcript emits the same started/delta/ended sequence,
  so neither accepted spelling depends on the other

#### Scenario: Deltas reach the stream through the shipped bridge
- **WHEN** a child that emits `stream_event` frames is run behind the bridge
  with the SDK flags the bridge passes
- **THEN** the SSE stream carries `session.text.delta` frames for the chunks
  before the buffered message, the buffered message adds no duplicate part
  frames, and removing the partial-message request from the child's flags
  fails this scenario

#### Scenario: A multi-call turn reports its last call's tokens
- **WHEN** a turn makes two model calls whose `assistant` frames each carry
  `{input_tokens: 1, output_tokens: 1}` and the `result` carries the run total
  `{input_tokens: 2, output_tokens: 2}`
- **THEN** `session.step.ended` carries `tokens.input: 1` and
  `tokens.output: 1`, and the TUI context counter shows `2`

#### Scenario: A retried attempt reads like OpenCode's
- **WHEN** Maki announces `api_retry` with `attempt: 1` and `retry_delay_ms:
  1000`, then streams the reply
- **THEN** `session.retry.scheduled` names `attempt: 2` and an `at` one second
  ahead, and the reply's first frame is preceded by `session.step.started` on
  the same assistant message, so the TUI's retry row clears

