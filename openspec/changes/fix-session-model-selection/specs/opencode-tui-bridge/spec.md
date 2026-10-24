## ADDED Requirements

### Requirement: Keep the session's model choice durable
The bridge SHALL start a session's Maki child on the model the session was
created with when Maki's catalog lists it, and SHALL report a model switch
that Maki acknowledged as a durable `session.model.selected` event and a
`model-switched` history row.

#### Scenario: The composer keeps the picked model
- **WHEN** the user picks the second model and sends a prompt
- **THEN** the reply and the composer both name the second model, and no
  `set_model` is sent for the re-posted selection

#### Scenario: A mid-session switch is recorded
- **WHEN** Maki acks a `set_model`
- **THEN** `session.model.selected` names the new and previous models, and
  the session's history lists a `model-switched` message
