# Proposal

## Why

`manage-workspaces` opens a session in a new worktree, and the footer prints
its path: `<data>/opencode/worktree/<projectID[0..6]>/<name>` (core
`worktree/strategies.ts` v2.0.32 L49–L51). The data directory is each
side's (a temp XDG home, a sandbox home), each pane elides it differently,
and the project id comes from the first commit's hash, new every run. The
path therefore differed on every side for harness reasons only.

## What Changes

- `…opencode/worktree/<6 hex>/` normalizes to `<WORKTREES>/`, keeping the
  worktree's name.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the comparison requirement names the worktree root.

## Impact

`bridge/test/journeys/harness/normalize.ts` and its test. No committed
snapshot names a worktree yet.
