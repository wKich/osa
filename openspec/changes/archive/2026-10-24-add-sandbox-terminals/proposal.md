# Proposal

## Why

`open-terminal-pane` opens a terminal beside the transcript (`leader+t`),
and the subagent picker of `open-subagent-session` shows a `Terminals` tab.
The bridge answered `capabilities.persistentPty: false`, so the TUI offered
neither. "The bridge serves no PTY" was the reason, not a pin: the sandbox
can run an interactive shell — `openshell sandbox exec --tty` gives the
sandbox user's bash a remote PTY and follows window-size changes (measured
against OpenShell 0.1.5: `stty size` read `24 80`, then `30 100` after a
resize).

## What Changes

- `bridge/src/terminals.ts`: each terminal runs the sandbox user's shell
  (`${SHELL:-/bin/sh} -i`, or the requested command) through
  `openshell sandbox exec --tty --no-login-shell --workdir <session dir>`
  inside a Bun host PTY, retains up to 2 MiB of output with byte offsets,
  and serves the pinned persistent-PTY surface
  (`server/src/handlers/persistent-pty.ts` v2.0.32 L17–L209): list/create
  under the session, get/resize/remove, snapshot (the retained output as the
  checkpoint the client replays; screen text and cursor read from its tail),
  single-use connect tickets, and the attach WebSocket (`attached`, replay,
  `replay_complete`, binary output, interaction frames for input, resize and
  control, `controller_changed`, `resized`, `exited`), with
  `persistent-pty.added`/`removed` frames.
- `GET /api/info` reports `capabilities.persistentPty: true` when a project
  sandbox exists.
- The TUI's `env` and host `cwd` never reach the sandbox: no `--env` value
  is passed, and a host directory maps to the session's sandbox workdir.
- The scripted sandbox passes stdin through so an offline terminal works.
- Routes `served-live`/reachable (feature `sandbox-terminals`).

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the terminal requirement; the server-info
  requirement's capability changes.

## Impact

`bridge/src/{terminals,bridge}.ts`, `bridge/test/{sandbox-terminals,boot-surface}.test.ts`,
`bridge/test/fake-openshell.ts`, statuses, journeys and evidence, the report.
The terminal crosses the same boundary as Maki's own bash tool — the
sandbox — over the existing exec transport; no egress, mount, credential, or
`--env` change.
