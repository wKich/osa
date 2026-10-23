## Why

A live test in the dev channel showed a follow-up (`thread_instruction`)
asking Maki to save a roadmap to a file: Maki wrote the file and replied
"saved", but oskhs ran every follow-up read-only and threw the workspace
away. kiss itself treats such a follow-up as code work: while a task has no
MR yet (a Q&A first round), a thread instruction's changes open the task's
first MR. oskhs also ignored an agent's `Status: no_changes` /
`Changed: no` on first rounds, which kiss honours by discarding the changes.

## What Changes

- A `thread_instruction` follow-up on a non-read-only task that has no MR
  yet runs as a code round: changes are collected and published as in a
  first round, the task's repository entries get the MR, the task goes to
  `review`, and its `replyMessage` is cleared (kiss: the sub-task carries
  the reply; the MR link is posted by status sync).
- A round whose result block reports no changes (`Status: no_changes`,
  `Changed: no`, or `Changed: no; …`) publishes nothing even if files
  changed — kiss's rule.
- A follow-up on a task with an open MR commits onto the MR's branch and
  force-pushes it (kiss's `pushChangesToAllRepos`); the reply links the
  commits. A changed repository without an MR gets one on the task branch.
  When every MR is merged or closed, the follow-up only answers, with
  kiss's warning. (Pulled forward from B3: thread instructions on an MR.)

- MR creation retries a 400 with kiss's delays (5–45 s), as kiss's
  `GitlabService.createMergeRequest` does: the live run hit GitLab's
  "source_branch does not exist" right after a successful push.

## Impact

- `oskhs/src/kiss/sandboxRound.ts`, `oskhs/src/kiss/result.ts`,
  `oskhs/src/worker.ts`, `oskhs/src/kiss/protocol.ts`; tests; `docs/oskhs.md`.
- Spec: `oskhs-worker` — "Code changes land as merge requests" modified.
