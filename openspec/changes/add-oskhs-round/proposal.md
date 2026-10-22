# Proposal

## Why

Roadmap slice B1.1a (`docs/roadmap.md`, Track B). Every later oskhs slice —
incremental bundles, commits back, the kiss task protocol — needs one thing
first: a host-side library that runs one Maki round inside a long-lived
per-repo sandbox, in a fresh git worktree, and returns a typed result. Today
`maki-oss run` treats the current directory as the project (upload on create,
merge-download after the run), which cannot scale to warm repo sandboxes and
would resurrect deleted files.

The explore pass for this change (design.md, "Explore findings") also found
that neither `openshell sandbox exec --timeout` nor killing the exec client
stops the remote process (OpenShell v0.1.5, measured 2026-10-23): a timed-out
round keeps running in the sandbox. A round timeout has to be enforced inside
the sandbox.

## What Changes

- New Bun + TypeScript subproject `oskhs/` (same stack and conventions as
  `bridge/`): a round library and a `run-round <repo> "<prompt>"` CLI.
  - *Seed:* ensure the sandbox `repo-<project>` exists (created through
    `maki-oss up`, never with a project upload); if it holds no clone yet,
    upload a full `git bundle --all` of the local repo and `git clone` from it
    inside the sandbox; delete the uploaded bundle afterwards.
  - *Round:* `git worktree add --detach /sandbox/tasks/<task-id> <base>`, run
    `maki-oss run --no-sync --timeout <secs>` with `MAKI_OSS_WORKDIR` set to
    the worktree and `MAKI_OSS_SANDBOX_NAME=repo-<project>`, parse Maki's
    `--output-format json` result into a discriminated union, remove the
    worktree.
  - *Errors:* timeout, agent error (`is_error: true`, which Maki reports with
    exit 0), helper/gateway failure, and unparseable output each map to a
    distinct result kind.
- `maki-oss run --timeout SECS`: the in-sandbox command runs under GNU
  `timeout`, so the round and its children end inside the sandbox; exit 124
  on timeout.
- No kiss, no Mongo. No `--env` values, no bind mounts; the sandbox gets git
  data only through `openshell sandbox upload`.

## Capabilities

### New Capabilities

- `oskhs-round`: seed a warm repo sandbox and run one headless Maki round in a
  task worktree, with typed results and an in-sandbox timeout.

### Modified Capabilities

- `helper-cli`: `maki-oss run` gains `--timeout SECS`.

## Impact

- New: `oskhs/` (src, tests, README), `docs/oskhs.md`.
- Changed: `bin/maki-oss` (`--timeout` for `run`), `tests/run-tests.sh`,
  `docs/helper.md`, `docs/glossary.md`, `Makefile` (`test-oskhs`).
- Upstream behavior relied on: `openshell sandbox upload/exec`
  (https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md), Maki headless
  `--print --output-format json` (https://maki.sh/docs/headless/). Both measured
  against the installed OpenShell 0.1.5 and Maki 0.6.4.
