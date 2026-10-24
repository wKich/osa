## ADDED Requirements

### Requirement: Ask a subagent's permission in its child session
The bridge SHALL file a permission ask raised by a subagent's tool call
under the subagent's child session, with the child's message as its source,
SHALL answer it through the Maki child that asked, and SHALL settle it when
the parent session is interrupted.

#### Scenario: The child session holds the ask
- **WHEN** a subagent's `rm -f probe.txt` asks for permission
- **THEN** `permission.asked` names the child session, the parent's
  permission list is empty, and the TUI offers a reject reason

#### Scenario: Interrupting the parent settles it
- **WHEN** the parent is interrupted while the subagent's ask is open
- **THEN** the ask is replied `reject` in the child session and the
  execution ends interrupted
