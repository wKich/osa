## ADDED Requirements

### Requirement: Open persistent terminals in the sandbox
When a project sandbox exists the bridge SHALL report
`capabilities.persistentPty: true` and SHALL serve the pinned persistent-PTY
routes: a terminal created for a session SHALL run the sandbox user's shell,
or the requested command, through `openshell sandbox exec --tty` in the
session's sandbox workdir with no `--env` value, and its output SHALL stream
over the attach socket after an `attached` frame and the replay from the
requested cursor; interaction frames SHALL write input and resize the
terminal; `persistent-pty.added` and `persistent-pty.removed` SHALL announce
creation and removal. A connect token SHALL require the pinned ticket header.

#### Scenario: A command runs in the sandbox terminal
- **WHEN** the user opens a terminal with `leader+t` and runs
  `echo tmark-$((40+2))`
- **THEN** the pane shows the sandbox shell's prompt, the command, and
  `tmark-42`

#### Scenario: A resize reaches the shell
- **WHEN** the controlling attachment sends an interaction frame with a new
  size
- **THEN** the bridge resizes the PTY, reports the size on the terminal, and
  sends `resized` to its attachments
