# Proposal

## Why

In `view-shell-output` the user types `!` and runs a command from the
composer's shell mode. The TUI posts `POST /api/session/{sessionID}/shell`;
the bridge answered from the spec and the command never ran — nothing
appeared in the transcript. OpenCode runs the command in the session's
directory, announces it with `session.shell.started`/`ended`, and briefs the
model on the next turn with a user-shell notice
(`core/src/session/session.ts` v2.0.32 L179–L222, `shell/result.ts`
L36–L81). The Maki side's directory is the sandbox workdir, reachable over
the exec transport the bridge already uses.

## What Changes

- `session.shell` runs `sh -c` with stdout and stderr combined in the sandbox
  workdir (`src/user-shell.ts`), emits `session.shell.started` (event id from
  the client's message id) and `session.shell.ended` with the pinned
  `Shell.Info` and `Output`, and admits OpenCode's notice as a synthetic input
  (no description, so the TUI keeps it out of the transcript) that is
  delivered with the next prompt and prefixed to it for the child.
- The projected history records the shell and synthetic messages.
- Route `served-live`/reachable (feature `user-shell`).

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the user-shell requirement.

## Impact

`bridge/src/{user-shell,bridge,translator,history}.ts`,
`bridge/test/user-shell.test.ts`, statuses, journeys, evidence, the report.
The command runs inside the sandbox through `openshell sandbox exec`, as the
child's own tools do; no new transport, mount, egress, or credential.
