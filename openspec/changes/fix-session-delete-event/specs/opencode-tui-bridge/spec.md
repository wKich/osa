## MODIFIED Requirements

### Requirement: Maintain one Maki session behind one OpenCode session
The bridge SHALL run one Maki SDK session per OpenCode session — Maki running
inside the project sandbox, reached over `openshell sandbox exec` stdio — and
SHALL mint and map OpenCode-shaped ids (`ses_`, `msg_`, `per_`, `evt_`) to and
from Maki's ids. Concurrent sessions SHALL stay independent: a frame belongs
to the session whose child produced it, an admitted prompt appears only in its
own session's transcript, and each session's child is created and torn down
with that session alone.

#### Scenario: Session lifecycle maps one-to-one
- **WHEN** the TUI lists, reads, creates, or deletes a session
- **THEN** the bridge performs the corresponding operation on the Maki session
  it owns and returns ids that satisfy the OpenCode id patterns

#### Scenario: Minted ids are stable within a session
- **WHEN** the bridge emits multiple event frames for one turn
- **THEN** the assistant message id is the same minted `msg_` in every part
  event for that turn, and each frame carries a distinct `evt_` id

#### Scenario: Concurrent sessions do not share a transcript
- **WHEN** two sessions are open and both receive a prompt while both turns
  are in flight
- **THEN** each prompt is admitted exactly once under its own session id, each
  session's assistant output renders only under that session, and no emitted
  frame names a session the bridge does not know

#### Scenario: Deleting one session spares the others
- **WHEN** one of two open sessions is deleted
- **THEN** only that session's Maki child exits, that session reads back 404,
  and the other session's child stays alive and still runs its next turn

#### Scenario: A delete is announced
- **WHEN** the TUI deletes a session
- **THEN** the bridge emits `session.deleted` (durable version 2) for it, and
  the TUI leaves the deleted session for the home screen

