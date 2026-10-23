# Spec Delta

## REMOVED Requirements

### Requirement: Accept mid-session model selection without retasking the child
**Reason**: Its premise, that the pinned wire cannot switch the child's model,
is wrong: Maki v0.6.4 defines inbound `control_request`/`set_model`
(`src/sdk_mode.rs` L861–L874). The bridge now forwards the selection.
**Migration**: Replaced by "Forward mid-session model selection to the Maki
child" below; the unknown-session scenario carries over unchanged.

## ADDED Requirements

### Requirement: Forward mid-session model selection to the Maki child
The bridge SHALL answer the OpenCode model-selection route for an open session
with `204` for a selection naming a provider and a model, and `400`
`InvalidRequestError` when either is missing, writing nothing to the child.
When the selection differs from the model the session currently reports, the
bridge MUST write one `control_request` with subtype `set_model` whose `model`
is `<providerID>/<id>`, or the bare `id` when the provider is `maki` (the
bridge's label for ids announced without a provider). Only the child's success
`control_response` SHALL change the model reported on the session object, on
the session list, and on later `session.step.started` frames, and the bridge
SHALL then emit `model.updated` for the session. A refused selection MUST leave
the reported model unchanged. Re-posting the model the session already reports
SHALL send nothing. The bridge MUST answer `404` `SessionNotFoundError` for an
unknown session and record no selection.

#### Scenario: A selection is forwarded and the acked model is reported
- **WHEN** the TUI posts a different model to an open session and the child
  acks `set_model` with success
- **THEN** the route answers `204`, the child received exactly one `set_model`
  naming `<providerID>/<id>`, `model.updated` is emitted, and the session read,
  the session list, and the next `session.step.started` report the new model

#### Scenario: A refused model is never claimed
- **WHEN** the child acks `set_model` with an error
- **THEN** the session keeps reporting the model it reported before, and no
  `model.updated` is emitted for the selection

#### Scenario: Re-posting the current model is not a switch
- **WHEN** the TUI posts the model the session already reports
- **THEN** the route answers `204` and no `set_model` reaches the child

#### Scenario: An unknown session is not a silent success
- **WHEN** the model route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and records no
  selection
