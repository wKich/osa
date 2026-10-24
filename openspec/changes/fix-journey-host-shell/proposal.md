# Proposal

## Why

Scripting `open-terminal-pane` showed both sides opening the host user's
login shell: the reference terminal printed the host user's zsh prompt
(`<user>@<host> journey-work %`), and the offline Maki side's scripted
sandbox inherited the host's `fish`, which stalled 10 s on a terminal query
the TUI's embedded terminal does not answer. A journey's terminal content
then depends on the host's shell and its configuration, not on the journey.
A live sandbox's prompt also names its container id, a value that changes
every run.

## What Changes

- The shared journey environment sets `SHELL=/bin/sh`, so a terminal opened
  on either side starts the same plain shell.
- `sandbox@<container id>` normalizes to `sandbox@<HOST>`.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement names the shell; the
  comparison requirement names the sandbox hostname.

## Impact

`bridge/test/journeys/harness/{record,normalize}.ts` and their tests. A full
`make test-journeys` left every snapshot byte-identical. No bridge runtime
change.
