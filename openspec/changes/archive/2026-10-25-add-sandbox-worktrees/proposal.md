# Proposal

## Why

`manage-workspaces` (`/worktrees`, `ctrl+a`, a name) lists the project's
checkout, creates a git worktree and opens a new session in it on the
reference. On the Maki side the dialog was empty and nothing was created:
the four worktree routes were answered from the contract, and every session
was forced into the workdir. A worktree is plain `git` on the checkout, and
the checkout lives in the sandbox, so the bridge can run it there.

## What Changes

- `bridge/src/worktrees.ts`: the project's worktrees, run over the exec
  transport the way OpenCode's git strategy runs them (core `worktree.ts`
  v2.0.32 L204–L330; `worktree/git.ts` L8–L37; `git.ts` L1251–L1291).
  - list from `git worktree list --porcelain`, with the checkout under the
    name the bridge serves it by;
  - create with `git worktree add --detach` under the sandbox user's data
    directory in OpenCode's layout (`<data>/opencode/worktree/<projectID[0..6]>/<name>`,
    `worktree/strategies.ts` L49–L51), suffixing a taken name;
  - remove; refresh, emitting `worktree.updated`.
- A session opens in a worktree the TUI names, and can move into one; a host
  directory still maps onto the workdir. `/api/vcs` reads the worktree's own
  checkout.
- The routes accept every id the project has been reported under (a client
  that read `global` before the first commit keeps it).
- Routes `served-live`/reachable, feature `worktrees`. `manage-workspaces`:
  recorded, `parity` offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the worktree requirement.

## Impact

`bridge/src/{bridge,worktrees}.ts`, a test, rows. Worktrees are written in
the sandbox user's home under the sandbox policy; no host path, `--env` value
or policy change.
