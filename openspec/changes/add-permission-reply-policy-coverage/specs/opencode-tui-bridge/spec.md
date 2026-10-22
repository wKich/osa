# Spec Delta

## MODIFIED Requirements

### Requirement: Round-trip tool permissions
The bridge SHALL forward each Maki `can_use_tool` control request to the TUI as
a permission request, block that tool call until the TUI answers, and map the
TUI's reply onto Maki's `allow`/`deny` wire answer. A reply of `always` SHALL be
honored for that one call only; every later tool call re-prompts. A reply whose
decision is not `once`, `always`, or `reject` SHALL fail closed: the bridge
answers Maki `deny`, drops the pending request, and answers the route 400.

#### Scenario: User allows one call
- **WHEN** Maki requests permission and the user answers "allow once"
- **THEN** the bridge answers Maki `behavior: allow` and the tool executes

#### Scenario: User rejects
- **WHEN** the user rejects the request
- **THEN** the bridge answers Maki `behavior: deny` and Maki reports the call
  as rejected

#### Scenario: Always re-prompts the next call
- **WHEN** the user answers "always" and a later matching tool call requests
  permission
- **THEN** the bridge asks the TUI again rather than auto-allowing

#### Scenario: An invalid reply fails closed
- **WHEN** the TUI replies to a pending permission request with a decision
  outside `once`/`always`/`reject`
- **THEN** the bridge answers Maki `behavior: deny`, answers the route 400,
  clears the pending request, and the target the tool would have touched stays
  untouched
