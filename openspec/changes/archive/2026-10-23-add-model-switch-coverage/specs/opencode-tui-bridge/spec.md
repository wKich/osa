# Spec Delta

## ADDED Requirements

### Requirement: Accept mid-session model selection without retasking the child
The bridge SHALL accept the OpenCode model-selection route for an open session
and answer `204` for a selection that names a provider and a model. The bridge
MUST answer `404` `SessionNotFoundError` for an unknown session instead of
recording a selection. The model the Maki child announced on `system.init`
SHALL remain the model reported on the session object, on the session list,
and on every `session.step.started` frame emitted after the selection. Because
the pinned Maki wire's inbound `set_model` subtype is not sent by the bridge,
the bridge MUST NOT claim that the switch took effect: the child keeps the
model it started with, and no model-control frame reaches it as a result of
the selection.

#### Scenario: The switch is accepted and the announced model is still reported
- **WHEN** the TUI posts a model to an open session and then submits a prompt
- **THEN** the route answers `204`, the session read and session list still
  report the model the child announced, and the next `session.step.started`
  carries that same model

#### Scenario: The child is not re-tasked
- **WHEN** a model selection is accepted for an open session
- **THEN** the Maki child receives no `set_model` or other model-control frame
  and the transcript makes no claim that the running model changed

#### Scenario: An unknown session is not a silent success
- **WHEN** the model route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and records no
  selection
