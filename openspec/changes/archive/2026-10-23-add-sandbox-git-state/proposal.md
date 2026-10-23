# Proposal

## Why

Discovery pass 6 linked `GET /api/vcs` to `vcs-branch-live`, and
`GET /api/project` and `GET /api/location` to `project-identity-live`. The
footer showed `…:sample` as the branch, and every project and session carried
the project id `sample`. Both values exist in the sandbox checkout, which the
bridge can reach over the exec transport `fix-fs-list-sandbox` introduced.

## What Changes

- `readGitState` (`bridge/src/sandbox.ts`) reads the branch, origin's default
  branch and the first root commit in one fixed `sh -c` exec in the workdir.
- `GET /api/vcs` answers the live branch on every read.
- The project id is read once at boot: the root commit, else `global`. The
  project list, location and session objects all carry it. The project also
  carries `name` (workdir basename) and `vcs`.
- `bridge/test/sandbox-git.test.ts` covers both features. Both become
  `verified`, and their three routes become `served-live`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the requirement "Answer workspace routes from
  the sandbox checkout".

## Impact

`bridge/src/sandbox.ts`, `bridge/src/bridge.ts`, a new test, statuses and the
report. The only command run in the sandbox is `git`, which is in the image.
