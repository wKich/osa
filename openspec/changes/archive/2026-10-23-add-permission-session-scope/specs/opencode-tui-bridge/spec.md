# Spec Delta

## REMOVED Requirements

### Requirement: Round-trip tool permissions
**Reason**: Its re-ask policy and bare-answer scenario assumed the Maki wire
has only `allow`/`deny`; the pinned decoder (`src/sdk_mode.rs` v0.6.4
L918–L927) also has a session-scoped allow and a deny with guidance.
**Migration**: Replaced by "Round-trip tool permissions in Maki's answer
vocabulary" below; the allow-once, reject, and invalid-reply scenarios carry
over unchanged.

## ADDED Requirements

### Requirement: Round-trip tool permissions in Maki's answer vocabulary
The bridge SHALL forward each Maki `can_use_tool` control request to the TUI as
a permission request, block that tool call until the TUI answers, and map the
TUI's reply onto the pinned Maki answer. Each answer SHALL be written to the
child exactly once per ask and SHALL name the `request_id` Maki sent. A reply
of `once` SHALL be a bare `allow`. A reply of `always` SHALL be an `allow`
carrying `updatedPermissions`, which Maki applies as a session-scoped rule; the
bridge SHALL NOT cache the decision itself. A reply of `reject` SHALL be a
`deny`, carrying the reply's `message` when it is a non-empty string. The
permission request SHALL list the tool name in `save`, the patterns the TUI
names under "Always allow". A reply whose decision is not `once`, `always`, or
`reject` SHALL fail closed: the bridge answers Maki with a bare `deny`, drops
the pending request, and answers the route 400.

#### Scenario: User allows one call
- **WHEN** Maki requests permission and the user answers "allow once"
- **THEN** the bridge answers Maki `behavior: allow` and the tool executes

#### Scenario: User rejects
- **WHEN** the user rejects the request
- **THEN** the bridge answers Maki `behavior: deny` and Maki reports the call
  as rejected

#### Scenario: Always becomes Maki's session rule
- **WHEN** the user answers "always"
- **THEN** the child receives `behavior: allow` with `updatedPermissions`, a
  later matching call in that Maki session is not asked again, and a gated call
  in another session still reaches the TUI

#### Scenario: A rejection reason reaches the model
- **WHEN** the user rejects with a non-empty `message`
- **THEN** the child receives `behavior: deny` with that `message`; an empty
  or null `message` leaves a bare `deny`

#### Scenario: An invalid reply fails closed
- **WHEN** the TUI replies to a pending permission request with a decision
  outside `once`/`always`/`reject`
- **THEN** the bridge answers Maki `behavior: deny`, answers the route 400,
  clears the pending request, and the target the tool would have touched stays
  untouched

#### Scenario: The wire answer names Maki's request
- **WHEN** the TUI answers a pending permission request
- **THEN** the child receives exactly one `control_response` named by the
  `request_id` Maki sent, with no field outside `request_id`, `behavior`,
  `updatedPermissions`, and `message`
