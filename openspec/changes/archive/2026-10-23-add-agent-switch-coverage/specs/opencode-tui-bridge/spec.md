# Spec Delta

## ADDED Requirements

### Requirement: Record mid-session agent selection without retasking the child
The bridge SHALL accept the OpenCode agent-selection route for an open session
and report the selected agent consistently: on the session object, on the
session list, and on the `agent` field of every `session.step.started` frame
emitted for that session after the selection. The bridge MUST answer `404`
`SessionNotFoundError` for an unknown session instead of recording a
selection. Because the pinned Maki wire exposes no inbound `set_agent`
subtype, the bridge MUST NOT claim to have re-tasked the child: the child
keeps the agent it started with, and no agent-control frame is sent as a
result of the selection.

#### Scenario: Selection is reported on the session and its next turn
- **WHEN** the TUI posts an agent to an open session and then submits a prompt
- **THEN** the route answers `204`, the session read and session list report
  the selected agent, and the next `session.step.started` carries that agent

#### Scenario: The child is not re-tasked
- **WHEN** an agent selection is recorded for an open session
- **THEN** the bridge sends the Maki child no agent-control frame and the
  transcript makes no claim that the running agent changed

#### Scenario: An unknown session is not a silent success
- **WHEN** the agent route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and records no
  selection
