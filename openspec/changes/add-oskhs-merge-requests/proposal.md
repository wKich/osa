# Proposal

## Why

Roadmap slice B1.4, the last of B1 before production. A marked task that
asks for a code change is answered like a question today: B1.3c rounds are
read-only and the mirrors are made by hand. kiss users expect a Merge
Request linked in their thread, opened the way kiss opens its own so that
kiss's review tracking (`GitLabMRTaskSource`) and status replies keep working.

## What Changes

- **Mirrors from GitLab.** oskhs keeps a bare mirror per kiss repository at
  `<mirror dir>/<project path>.git`, cloned and fetched over HTTPS with the
  GitLab token passed to git only through the environment (an
  `http.extraHeader` set by `GIT_CONFIG_*`), never in argv, a remote URL, or
  a file. The token comes from `OSKHS_GITLAB_TOKEN` (the oskhs host's own
  secret, like the Mongo URI); the base URL from `OSKHS_GITLAB_URL`.
- **Code rounds.** A task that is not `readOnly` gets kiss's code-or-answer
  instructions and kiss's `[RESULT]` format with Title, Description, Branch,
  Labels, and Reply (contract-tested), and its changes are collected.
- **Publishing.** For every repository the round changed: the commit takes
  the result's Title as its message; the branch is kiss's — the `/branch`
  directive (`taskBranchName`), else the agent's proposed Branch when it is
  free on GitLab, else `kiss-agent/<8 hex>`, sanitized as kiss does; oskhs
  pushes it from the mirror and opens an MR through the GitLab API: kiss's
  title and description (plus the source link), labels with
  `ai_generated`, assigned to the token's user (the bot, which is how
  `GitLabMRTaskSource` finds its MRs), the task author as reviewer when they
  are a project member. An existing MR for the branch is reused.
- **Recording.** As kiss's `mergeRequestsCreated` handler does:
  `taskRepositories[].mrUrl/mrIid/branchName`, `taskDescription`,
  `replyMessage` (the Reply field), and `state: 'review'` (cancel-gated);
  kiss's status sync then posts the MR link in the thread.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `oskhs-worker`: GitLab mirrors, code rounds, MRs, and review state.

## Impact

- New: `oskhs/src/kiss/{gitlab,mirror,publish}.ts`, tests; changed:
  `kiss/{prompt,sandboxRound}.ts`, `collect.ts` (commit message),
  `worker.ts` (review result), CLI; `docs/oskhs.md`, `docs/roadmap.md`.
- Out of scope (B3): follow-up commits to an open MR from review comments
  or thread instructions, MR templates, auto-review, self-review.
- Upstream: GitLab REST API v4 merge requests
  (https://docs.gitlab.com/api/merge_requests/), git `http.extraHeader` and
  `GIT_CONFIG_COUNT` (https://git-scm.com/docs/git-config).
