# Proposal

## Why

`open-external-editor` (`leader+e`, `/editor`) needs an external editor: the
TUI writes the draft to a temp file, runs `$VISUAL` or `$EDITOR` on it, and
reads the file back (`tui/src/editor.ts` v2.0.32 L14–L42). The journey
environment carries neither variable, so both sides would only show "Set
$VISUAL or $EDITOR to open an external editor" — and taking the host user's
editor would make a journey interactive and host-dependent.

## What Changes

- The journey environment sets `EDITOR` to `harness/editor.sh`, which
  replaces the draft with one fixed prompt and exits.
- Recorded with it, on the prompt area: `open-external-editor`,
  `recall-prompt-history`, `stash-prompt` — all `parity` offline and live.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement names the scripted
  editor.

## Impact

`bridge/test/journeys/harness/{editor.sh,record.ts,record.test.ts}`, three
journeys' scripts, snapshots, and catalog rows. No bridge runtime change; the
editor runs on the host side of the TUI on both sides, as it does in use.
