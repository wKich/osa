# Design

## Context

- OpenCode v2.0.32:
  - `client/src/solid/data.ts` L1368 reads `vcs.get` on location sync and on
    `server.connected`.
  - `tui/src/component/prompt/index.tsx` L1620 renders `branch.current` in
    the footer.
  - `project.id` keys the project and worktree pickers
    (`tui/src/component/session-tabs.tsx` L587–L592).
  - The real server names a repository's project after its first root
    commit.
- The sandbox image ships `git` (`examples/maki-image/Dockerfile`).

## Decisions

1. **One fixed exec.** `rev-parse --abbrev-ref HEAD`,
   `symbolic-ref --short refs/remotes/origin/HEAD` and
   `rev-list --max-parents=0 --all | sort | head -n 1` run in one `sh -c`,
   with `\036` separators. No client input reaches the script.
2. **Branch per read, project once.** A branch changes when Maki runs
   `git checkout`. The project root does not change for the bridge's
   lifetime. Session creation and every project answer wait for the boot read.
3. **Timestamps are the bridge's.** `created`/`updated` are the boot time and
   `active` is the latest session activity: the bridge keeps no project
   database.

## Non-Goals

- `vcs.branch.updated` events. The TUI re-reads `/api/vcs` on every location
  sync.
- `/api/vcs/status|diff|base|branch` stay out of scope.
