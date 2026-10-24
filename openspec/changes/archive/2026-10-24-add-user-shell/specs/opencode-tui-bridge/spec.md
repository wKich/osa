## ADDED Requirements

### Requirement: Run the user's shell command in the sandbox
`POST /api/session/{sessionID}/shell` SHALL run the command in the sandbox
workdir with stdout and stderr combined, emit `session.shell.started` and
then `session.shell.ended` with the pinned `Shell.Info` and `Output`, and
deliver OpenCode's user-shell notice to the child as the preamble of the
session's next prompt. An empty command SHALL answer 400.

#### Scenario: The output renders and briefs the next turn
- **WHEN** the user runs `!echo out; echo err 1>&2` and then prompts
- **THEN** the transcript shows the command and both lines, and the child's
  next prompt starts with the notice naming the command and its output
