# Tasks

## 1. GitLab access

- [ ] 1.1 `kiss/gitlab.ts`: API client (current user, user by name, member
      check, branch exists, find open MR, create MR) over `fetch` with
      `PRIVATE-TOKEN`; `gitAuthEnv(token)`; verify unit tests against a
      local fake HTTP server, including that errors never contain the token
- [ ] 1.2 `kiss/mirror.ts`: clone/refresh with auth env; push
      `oskhs/<id>` to the task branch and drop the local ref; verify with
      real git against a local bare "remote" (argv free of the token)

## 2. Code rounds

- [ ] 2.1 Prompt for code tasks (kiss's publishing instruction and
      `RESULT_FORMAT_TASK` verbatim) and branch naming (port of
      `sanitizeBranchName`); contract tests against kiss
- [ ] 2.2 `collect` commit message option; `kiss/publish.ts` (branch
      choice, push, MR create/reuse, labels, assignee/reviewer); sandbox
      round collects for non-read-only tasks and returns MR records; worker
      records them and sets `review`; verify end to end with the local
      sandbox, the local remote, and the fake GitLab
- [ ] 2.3 CLI: `OSKHS_GITLAB_URL`, `OSKHS_GITLAB_TOKEN`; verify
      `make test-oskhs`, `bunx tsc --noEmit -p oskhs`

## 3. Live exit

- [ ] 3.1 Dev stand: a marked task in `kiss-local-test` asking to append a
      line to `README.md` of `ascii-minecraft`; verify the MR on GitLab
      (branch, assignee `svc_kiss`, labels, description with the source),
      the task in `review` with `mrUrl`/`mrIid`, and kiss's review
      notification in the thread; record in `evidence/mr-live.md`
- [ ] 3.2 Verify the mirror refresh (the pushed branch appears in the
      mirror after the next round's fetch) and that no oskhs process
      argument carried the token (`ps` sampled during the round)

## 4. Docs

- [ ] 4.1 `docs/oskhs.md`, roadmap B1.4 done; verify
      `scripts/check-links.sh docs/oskhs.md docs/roadmap.md` and
      `openspec validate add-oskhs-merge-requests --strict`
