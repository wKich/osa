# Proposal

## Why

Roadmap slice B1.3c. The oskhs worker speaks kiss's task protocol but
answers with an echo. A question in a marked channel must be answered by
Maki in the project's warm sandbox, from the project's repositories, with a
prompt carrying the context kiss gives its own agent (repositories, source
link, thread history, author) and a reply in the field kiss posts from.

Two gaps stand in the way. kiss projects are multi-repo (the dev project
has two repositories), while the B1.1 round handles one repository per
sandbox. And the round needs host-side repositories for each kiss project
path; B1.4 fetches them from GitLab, so this slice reads hand-made bare
mirrors.

## What Changes

- **Multi-repo workspace** (`oskhs-round`): one bare repository per kiss
  repository at `/sandbox/repos/<subdir>`; each round gets a workspace
  `/sandbox/tasks/<task-id>/` with one worktree per repository at
  `<subdir>/` (kiss's `worktreeSubdir` rule) and an `AGENTS.md` index at the
  root; Maki runs at the workspace root. Sync and collection run per
  repository; `run-round` is the one-repository case.
- **Sandbox round for the worker** (`oskhs-worker`): `--round sandbox`
  (default) builds the round from the task: sandbox `repo-<project title>`,
  repositories from `taskRepositories` with mirrors at
  `<mirror dir>/<project path>.git`, base = the mirror's default branch (or
  the repository's `branchName` when the task continues one), model and
  providers from worker flags (preconfigured on the gateway by hand).
- **Prompt and reply**: kiss's task-context block (repositories, source URL,
  thread context, author, task line) reproduced byte for byte — a contract
  test renders kiss's own `generateTaskPrompt` and compares — with
  answer-only instructions and kiss's no-changes `[RESULT]` format; the
  reply is the `[RESULT]` `Reply` field, parsed as kiss parses it (also
  contract-tested), falling back to the whole answer.
- Read-only: B1.3c never collects changes; code requests are B1.4.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `oskhs-round`: multi-repo workspace layout, per-repository sync and
  changes.
- `oskhs-worker`: the sandbox round replaces the echo.

## Impact

- Changed: `oskhs/src/{names,sync,round,collect,cli,worker}.ts`; new
  `oskhs/src/kiss/{prompt,result,sandboxRound}.ts`; tests; `docs/oskhs.md`,
  `docs/roadmap.md`.
- Existing warm sandboxes with the B1.1 layout (`/sandbox/repo`) are not
  migrated; delete and re-seed them (dev only so far).
