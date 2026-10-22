# Spec Delta

## MODIFIED Requirements

### Requirement: Sandbox transport and host exposure
The bridge SHALL run Maki by spawning `openshell sandbox exec` for the project
sandbox with `--no-login-shell`, the configured workdir, Maki's SDK flags
(`-p --input-format stream-json --output-format stream-json
--include-partial-messages`), and the configured model, over a stdin/stdout
pipe that stays open for the session's lifetime. The child SHALL be asked for
partial output so streamed turns reach the transcript incrementally rather
than only at completion. The exec invocation MUST NOT pass any `--env` value.
The Maki child command SHALL be overridable through one environment variable
so a scripted process can replace it. The bridge SHALL listen on loopback only
by default; binding to any other address SHALL require a configured password
and print a warning. Bridge logs MUST NOT contain credential material.

#### Scenario: Exec carries no environment values
- **WHEN** the bridge starts a Maki child for a session
- **THEN** the recorded `openshell sandbox exec` argv contains
  `--input-format stream-json`, `--output-format stream-json`,
  `--include-partial-messages`, `--no-login-shell` and the workdir, and
  contains no `--env` flag

#### Scenario: A scripted child replaces the sandbox transport
- **WHEN** the Maki child override environment variable points at a scripted
  process that speaks the Maki SDK wire
- **THEN** the bridge drives that process exactly as it drives the sandbox
  child, with no other code path difference

#### Scenario: Default bind is loopback
- **WHEN** the bridge starts with no address configured
- **THEN** it listens only on `127.0.0.1` and the startup output states the URL

#### Scenario: Logs are free of credentials
- **WHEN** a full session has run with bridge logging enabled
- **THEN** the request, SSE, and stdout logs match a credential-pattern scan
  with no finding

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
