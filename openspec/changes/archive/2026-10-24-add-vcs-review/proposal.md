# Proposal

## Why

`view-session-diff` opens the diff viewer (`/diff`) after the agent changes a
committed file. The viewer reads `GET /api/vcs/diff` and `GET /api/vcs/base`,
which the bridge answered from the spec: the Maki side showed a phantom
`sample` file against a `sample` base. The footer also lacked the checkout's
`:main` branch, because the bridge read the project identity once at boot,
before the agent created the repository. OpenCode reviews the checkout with
its git provider (`core/src/plugin/vcs/git.ts` v2.0.32) and resolves the
project when a client opens the location.

## What Changes

- `vcs.diff` (`working`, `branch`, `committed`), `vcs.base`, and `vcs.status`
  port the git provider's rules — fixed git config, merge base with the
  default branch (remote HEAD, `init.defaultBranch`, `main`, `master`),
  untracked files through `--no-index`, whole-file context unless `context`
  is given, sorted files, per-file and total byte caps, reflog-or-default
  base — and run as batched git commands in the sandbox
  (`bridge/src/vcs.ts`). Provider errors are the pinned 503; a missing mode
  is 400.
- `GET /api/project` and `GET /api/location` read the project identity
  again, so a repository made mid-run is reported.
- Routes `served-live`/reachable (feature `vcs-review`).

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the review requirement.

## Impact

`bridge/src/{vcs,bridge}.ts`, `bridge/test/vcs-review.test.ts`, statuses,
journeys, evidence, the report. Reads run in the sandbox over the existing
exec transport; no host path is read.
