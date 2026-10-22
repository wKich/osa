# Design

## Context

kiss's in-container agent runs every task — read-only ones included — with
`generateTaskPrompt` (kiss `src/services/prompts.ts`), a workspace with one
subdirectory per repository and an `AGENTS.md` index, and parses the
agent's `[RESULT]` block with `parsePromptResult`; for an answer-only task
the `Reply` field becomes `replyMessage`. Thread follow-ups arrive as
`AgentSubTask.prompt`, a prompt kiss already built.

## Explore findings (2026-10-23)

1. Bun imports kiss's `prompts.ts` directly (it pulls `SecretStore` but no
   network or database): `generateTaskPrompt` and `parsePromptResult` can be
   called from oskhs tests, so a port can be checked byte for byte.
2. The prompt's first half is kiss-internal policy (engineering rules, MR
   and branch rules, `[RESULT]` formats for code changes). The second half,
   from `**Task context:**`, is task data: repository context, source URL,
   thread root and discussion, thread URL with the delivery instruction,
   and the author's task line.
3. The dev project `kiss-local` has two repositories
   (`dmitry.lazarev/kiss`, ~31 MB packed, and
   `dmitry.lazarev/ascii-minecraft-mimo-2.6-pro`); both are reachable over
   the developer's SSH key, so hand-made bare mirrors are possible for this
   slice without the bot's GitLab token.
4. kiss's subdirectory rule: `worktreeSubdir || projectPath.replace(/\//g,
   '_')`.

## Decisions

1. **Layout.** `/sandbox/repos/<subdir>` (bare, offline origin, as before)
   per repository; `/sandbox/tasks/<task-id>/<subdir>` worktrees;
   `/sandbox/tasks/<task-id>/AGENTS.md`; transfer files named
   `<task-id>-<subdir>.bundle`. A subdir must match `[A-Za-z0-9._-]+`.
2. **Round shape.** `RoundSpec.repos: { key, hostRepo, base, branches,
   allBranches }[]`; the outcome reports per repository `{ key, sync,
   changes }`. `run-round` builds one repository whose key is the project
   name.
3. **Prompt.** `buildTaskPrompt(task)` = identity line + answer-only
   instructions ending in kiss's `RESULT_FORMAT_TASK_NO_CHANGES` block +
   kiss's task-context block. The context block is a verbatim port; the
   contract test renders kiss's prompt for the same inputs and compares the
   text from `**Task context:**` on, plus the `[RESULT]` format constant.
   The instructions half is oskhs's own and says the workspace is read-only.
4. **Reply.** Port of `parsePromptResult` restricted to what oskhs reads
   (`Reply`, `Status`): known-field lines outside fenced code start a field,
   YAML block-scalar wrappers are stripped. No `[RESULT]` → the whole answer.
   Contract-tested against kiss's parser on fixed samples.
5. **AGENTS.md.** oskhs's own short index (subdir, project path,
   description, base branch) plus read-only workspace rules; kiss's longer
   index carries MR and publishing rules that do not apply here.
6. **Repositories.** `--mirror-dir` (or `OSKHS_MIRROR_DIR`); a missing
   mirror fails the round with stage `sync` and a message naming the path.
   Base: the repository's `branchName` when set, else the mirror's `HEAD`
   branch. B1.4 replaces hand-made mirrors with GitLab fetches.
7. **Sandbox name.** `repo-<sanitized project title>`, falling back to the
   project id.
8. **Model.** `--model`/`OSKHS_MODEL` and `--provider`/`OSKHS_PROVIDERS`
   (preconfigured on the gateway); B1.3d derives both from kiss's
   `ModelProvider`.
9. **Reply on failure.** `agent-error`, `timeout`, `failed` become the
   worker's round error (kiss posts it as a failure); the message names the
   stage, never a credential.
10. **Leftovers after a lost round.** Before adding a task's worktrees the
    round removes any workspace left at the same path, so a requeued task
    can run again; an orphaned in-sandbox Maki ends at its own
    `maki-oss run --timeout`.

## Risks

- The instructions half is not kiss's; answers may differ in tone from
  KHS's. Accepted for B1; the task data is identical.
