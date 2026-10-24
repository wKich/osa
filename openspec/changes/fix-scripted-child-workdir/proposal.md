# Proposal

## Why

Scripting `view-session-diff` ran `git init … && git commit` through the
agent's shell, and the scripted Maki child ran it in its own process
directory — the repository's `bridge/` — instead of the journey workdir: a
nested `bridge/.git` and `bridge/notes.txt` appeared in the project (removed;
they held only the journey's commit). The child spawned every command with no
`cwd`, inheriting the bridge's; the pinned child runs under
`openshell sandbox exec --workdir <workdir>` (`bridge/src/maki.ts`), so its
commands run in the workdir. Earlier journeys' commands (`rm -f probe.txt`)
had the same flaw without a visible effect.

## What Changes

- The scripted child runs tool commands in `OPENMAKI_CWD` (the workdir the
  bridge passes), in script mode and in its prompt-driven mode.
- A test pins it: a scripted tool turn's file lands in the workdir and not in
  the process directory.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement says where the scripted
  child runs commands.

## Impact

`bridge/test/fake-maki.ts`, `bridge/test/journeys/harness/fake-maki-script.test.ts`.
Re-recording the tool journeys left their snapshots byte-identical. No bridge
runtime change.
