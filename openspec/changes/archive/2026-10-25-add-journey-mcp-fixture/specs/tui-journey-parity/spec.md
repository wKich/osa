## MODIFIED Requirements

### Requirement: Record a journey on both sides from one script
A recorded journey SHALL have one executable script that drives both sides:
the key input, waits on rendered screen content, checkpoint markers whose ids
match the journey's catalog checkpoints, and the model turns the journey
needs. The reference side SHALL run the real OpenCode server and TUI at the
pinned OpenCode version against a local scripted model provider that replays
those turns, in a temporary home and workdir, with no credentials and no
network beyond loopback. The Maki side SHALL run the same TUI against the
bridge, with a scripted Maki child that replays the same turns as Maki wire
frames and runs their commands in the journey workdir, as the pinned child
runs in its sandbox workdir. A model turn SHALL be one of: a text reply, optionally paced chunk by
chunk; a shell call; a tool call spelled per side, carrying the result the
pinned Maki tool returns; or a model-call failure with an HTTP status. Both
sides SHALL run with the TUI's update check disabled, so no run asks the
OpenCode release feed, with `SHELL=/bin/sh`, so no terminal opens the
host user's own shell, and with `EDITOR` set to the harness's scripted
editor, which replaces the draft with a fixed prompt. A script SHALL NOT wait on fixed delays alone: every
step that depends on the TUI reacting SHALL wait for screen content or a
bounded timeout that fails the run.

#### Scenario: One script, two sides
- **WHEN** a journey with a script is recorded
- **THEN** the reference and Maki-side runs consume the same steps and model
  turns, and each produces one snapshot per catalog checkpoint

#### Scenario: Script checkpoints match the catalog
- **WHEN** a journey script names a checkpoint id that the journey's catalog
  row lacks, or misses one it has
- **THEN** the offline suite fails and names the journey

#### Scenario: The reference run needs no credentials
- **WHEN** the reference side runs
- **THEN** it reads no credential, provider key, or user configuration from
  the host, and its only network peer is the loopback scripted provider

#### Scenario: A stalled step fails instead of passing late
- **WHEN** the screen content a step waits for does not appear within its
  timeout
- **THEN** the run fails, names the journey, step, and side, and no snapshot
  or status is written for it

#### Scenario: A paced turn can be interrupted
- **WHEN** a script interrupts a paced text turn mid-stream
- **THEN** the mock provider stops streaming, and the scripted Maki child ends
  the run with the pinned cancelled result and no buffered message

#### Scenario: A failing model call follows each side's retry rule
- **WHEN** a turn answers the model call with 503 and the next turn is text
- **THEN** both sides retry into the text turn, and the scripted Maki child
  emits one `api_retry` worded `Server error (503)`, as the pinned agent words
  a retry

#### Scenario: A rejected model call carries the raw body
- **WHEN** a turn answers the model call with 400
- **THEN** the scripted Maki child ends the run with the result
  `API error (400): <the mock provider's JSON error body>`

#### Scenario: No update check runs
- **WHEN** any journey records
- **THEN** the TUI's environment carries `OPENCODE_DISABLE_AUTOUPDATE=1` and no
  home-screen snapshot shows an update hint

#### Scenario: Scripted commands stay in the workdir
- **WHEN** a scripted tool turn writes a file
- **THEN** the file lands in the journey workdir and nothing is written to
  the directory the scripted child was started from

#### Scenario: A subagent call plays the subagent's turn
- **WHEN** a script's `call` turn sets `subagent: true` and the next turn is
  the text `MARK`
- **THEN** the scripted Maki child streams `MARK` unflagged, as the pinned
  child streams a subagent's deltas, then emits it flagged with the task
  call's `parent_tool_use_id` and answers the task with `MARK`, and the
  reference's subagent consumes the same turn from the mock provider

#### Scenario: A terminal does not open the host user's shell
- **WHEN** a journey opens a terminal on either side
- **THEN** it runs `/bin/sh`, whatever shell the host user logs in with

#### Scenario: The external editor is scripted
- **WHEN** a journey opens the external editor from the composer
- **THEN** the harness editor replaces the draft with
  `Reply with the word EDITED only.` and the TUI returns it to the composer

#### Scenario: Both sides offer the journey's models
- **WHEN** a journey opens the model dialog
- **THEN** the reference lists only the `mock` provider's two models, and the
  Maki side, offline and live, lists `mock/mock-model` and
  `mock/mock-model-2` with no connected integration

#### Scenario: A printed workdir does not wrap
- **WHEN** a journey prints the workdir, such as a move notice or `pwd`
- **THEN** the workdir lies under a short real root (`/tmp/mjr-…`), so the
  line fits the terminal on every side

#### Scenario: An MCP journey runs one server everywhere
- **WHEN** a journey sets `mcp: true`
- **THEN** the reference, the offline Maki side and the live sandbox each
  configure the harness's `journey` MCP server, and its `marker` tool returns
  `MCP-MARKER`

