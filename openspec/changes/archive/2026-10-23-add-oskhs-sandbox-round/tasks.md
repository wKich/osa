# Tasks

## 1. Multi-repo workspace

- [x] 1.1 `names.ts`: `repoDir(subdir)`, `workspacePath(taskId)`,
      `worktreePath(taskId, subdir)`, `repoSubdir(projectPath, worktreeSubdir?)`
      with validation; verify unit tests
- [x] 1.2 Sync and collect take the repository dir and a per-repository
      bundle name; `runRound` loops repositories (sync, worktree, collect),
      writes `AGENTS.md`, removes leftovers before and everything after;
      outcome `{ result, repos: [{ key, sync, changes }] }`; CLI prints
      `repos`; verify the existing suites adapted plus a two-repository
      local-sandbox test and a leftover-workspace test

## 2. kiss round

- [x] 2.1 `kiss/prompt.ts` (task-context port + answer-only instructions)
      and `kiss/result.ts` (Reply parser); verify unit tests and a contract
      test against kiss's `generateTaskPrompt`, `RESULT_FORMAT_TASK_NO_CHANGES`
      and `parsePromptResult` (skipped without `KISS_REPO`)
- [x] 2.2 `kiss/sandboxRound.ts`: task → round spec (sandbox name from the
      project title, repositories and bases from mirrors, prompt, read-only)
      → `RoundReply`; store returns the project title; verify with the
      local-sandbox runner (answer, missing mirror, agent error)
- [x] 2.3 Worker CLI: `--round sandbox|echo` (default sandbox), `--mirror-dir`,
      `--model`, `--provider`, `--gateway`; verify `make test-oskhs` and
      `bunx tsc --noEmit -p oskhs`

## 3. Live exit

- [x] 3.1 Create bare mirrors of the dev project's two repositories; delete
      the old-layout `repo-kiss-local` sandbox if any; insert a marked task
      asking about a file in one repository; run the worker; verify Maki's
      answer is the `replyMessage` and kiss posts it; record in
      `evidence/sandbox-round-live.md`
- [x] 3.2 Verify the sandbox environment (credential-like variables are
      stand-ins only; no Mongo/GitLab variables) and that TCP to the kiss
      MongoDB from the sandbox fails (host gateway address and the
      `kiss-mongo` container address); record

## 4. Docs

- [x] 4.1 `docs/oskhs.md` (workspace layout, kiss round, prompt and reply,
      mirrors, flags) and roadmap B1.3c done; verify
      `scripts/check-links.sh docs/oskhs.md docs/roadmap.md` and
      `openspec validate add-oskhs-sandbox-round --strict`
