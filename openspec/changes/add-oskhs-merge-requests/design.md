# Design

## Context

kiss's agent (`GitLabAgent`) publishes changes itself: it commits, picks the
branch (`resolveBranchName`: `/branch` directive, else `kiss-agent/<8 hex>`,
renamed to the agent's proposed `Branch` when free), pushes, and calls
`GitlabService.createMergeRequest` per changed repository with the
`[RESULT]` Title/Description/Labels, the bot as assignee and the task author
as reviewer. `TaskExecutor`'s `mergeRequestsCreated` handler records
`mrUrl`/`mrIid`/`branchName` per repository, `taskDescription`, and moves the
task to `review`; `TaskStatusNotifier.notifyReview` posts the links.

## Explore findings (2026-10-23)

1. The dev stand's `GITLAB_TOKEN` belongs to `svc_kiss` (id 14134), which
   has Developer access (30) to both dev repositories; their default branch
   is `master`.
2. `git ls-remote` over HTTPS succeeds with only
   `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader
   GIT_CONFIG_VALUE_0="Authorization: Basic <base64 oauth2:token>"` in the
   environment: no credential helper, URL userinfo, or config file.
3. A `git clone --mirror` has refspec `+refs/*:refs/*`; a pruning fetch
   deletes refs the remote lacks — including the `refs/heads/oskhs/<task>`
   branch B1.2 collects into. So oskhs pushes and drops that local ref within
   the same round, before the next fetch.
4. kiss's `sanitizeBranchName` and its branch length limit (48 characters
   for agent-proposed names) are small pure functions; ported.

## Decisions

1. **Credentials.** `OSKHS_GITLAB_TOKEN` and `OSKHS_GITLAB_URL` in the oskhs
   host's environment; git gets the token by `GIT_CONFIG_*`, the API by the
   `PRIVATE-TOKEN` header; logs and errors never include it (error bodies
   are tail-trimmed GitLab messages, which do not echo it).
2. **Mirror refresh** at the start of every round that uses the repository:
   `git clone --mirror` when missing, else `remote set-url origin <https
   url>` and `git fetch --prune origin`. Hand-made SSH mirrors from B1.3c are
   switched to HTTPS on first use.
3. **Prompt.** Code tasks: oskhs's instruction lines naming both outcomes
   (code changes vs answer-only) with kiss's `GIT_PUBLISHING_INSTRUCTION`
   and kiss's `RESULT_FORMAT_TASK` verbatim (contract-tested), then kiss's
   task-context block. Read-only tasks keep the B1.3c answer-only prompt.
4. **Branch.** `taskBranchName` → `sanitizeBranchName` (250); else the
   result's `Branch`, sanitized to 48, when no GitLab branch has that name;
   else `kiss-agent/<8 hex>`. One name for all repositories, as in kiss.
5. **Commit message.** The result's Title, else `oskhs: changes from task
   <id>`; agent commits are kept as before.
6. **MR.** Per changed repository: target = the round's base branch;
   reuse an open MR with the same source and target; else create with
   title (Title or the commit message), description (Description, else
   kiss's default "AI-Generated Merge Request" text, plus `Источник задачи:
   <source>`), labels (`Labels` split on commas, plus `ai_generated`),
   `assignee_id` = the token's user, `reviewer_ids` = the author when a
   member.
7. **Recording** in the worker: one cancel-gated update with the per-repo
   MR fields merged into `taskRepositories` by project path,
   `taskDescription`, `replyMessage`, `state: 'review'`; then
   `idle_stopped`. No changes → the answer path (`completed`).
8. **Failure.** Any push or API failure fails the round with a message
   naming the repository and step (task closed with the error, as kiss
   posts a failed task); a branch already pushed stays on GitLab.

## Risks

- A second kiss bot sharing the token (the test stand's) may also see MRs
  assigned to `svc_kiss`; it ignores projects it does not own.
