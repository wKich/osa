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
frames. A model turn SHALL be one of: a text reply, optionally paced chunk by
chunk; a shell call; a tool call spelled per side, carrying the result the
pinned Maki tool returns; or a model-call failure with an HTTP status. Both
sides SHALL run with the TUI's update check disabled, so no run asks the
OpenCode release feed. A script SHALL NOT wait on fixed delays alone: every
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
  emits one `api_retry` naming `API error (503): <message>`

#### Scenario: No update check runs
- **WHEN** any journey records
- **THEN** the TUI's environment carries `OPENCODE_DISABLE_AUTOUPDATE=1` and no
  home-screen snapshot shows an update hint

