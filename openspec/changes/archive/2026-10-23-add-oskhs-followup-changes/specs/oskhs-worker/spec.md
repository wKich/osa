## MODIFIED Requirements

### Requirement: Code changes land as merge requests
For a task that is not `readOnly`, the round SHALL use kiss's `[RESULT]`
format with Title, Description, Branch, Labels, and Reply, collect the
changes of every repository, and for each changed repository push the
task's branch — `taskBranchName`, else the agent's free proposed Branch,
else `kiss-agent/<8 hex>`, sanitized as kiss does — and open (or reuse) a
merge request into the round's base branch, with kiss's title, description
plus the source link, labels including `ai_generated`, the token's user as
assignee, and the task author as reviewer when they are a project member.
The worker SHALL record `mrUrl`, `mrIid`, and `branchName` on the matching
`taskRepositories` entries, `taskDescription`, and `replyMessage`, and set
`state: 'review'` unless a cancel arrived. Like kiss, MR creation SHALL be
retried on HTTP 400 (a just-pushed branch reaches the MR endpoint late)
with kiss's delays, except for a moved project. A round without changes, or
whose result block reports none (`Status: no_changes`, `Changed: no`, or
`Changed: no; …`), SHALL publish nothing and end `completed` as an answer.

A `thread_instruction` follow-up on such a task SHALL be a code round too,
as in kiss's GitLabAgent: a repository with an MR works on the MR's branch
and the follow-up's commits are force-pushed there; a changed repository
without an MR gets one on the task's branch (an existing MR branch, else
chosen as for a first round). New MRs are recorded on the task, which goes
to `review` with `replyMessage` cleared. The sub-task's reply SHALL end with
kiss's `Commit [<8 hex>](<url>)` links of the pushed heads, and leftover
edits are committed with the Commit field, else Title, else kiss's default
title. When every MR of the task is merged or closed, the follow-up SHALL
push nothing and its reply SHALL end with kiss's warning that the MR is
merged or closed.

#### Scenario: MR linked in the thread
- **WHEN** a marked task in the dev channel asks for a change to one repository
- **THEN** a merge request exists on GitLab from the task's branch, assigned to the bot, the task is in `review` with the MR on its repository entry, and kiss posts the MR link in the thread

#### Scenario: Answer without changes
- **WHEN** a non-read-only task only asks a question
- **THEN** no branch or MR is created and the task ends `completed` with the reply

#### Scenario: Agent reports no changes
- **WHEN** the agent edited files but its result block says `Status: no_changes`
- **THEN** no branch or MR is created

#### Scenario: Follow-up opens the first MR
- **WHEN** a thread follow-up on a completed question task asks to save something to a file
- **THEN** the change lands as a merge request, the task moves to `review` with the MR on its repository entry, and the sub-task's reply is posted in the thread

#### Scenario: Follow-up on an open MR
- **WHEN** a thread follow-up on a task in `review` asks for another change
- **THEN** a commit lands on the MR's branch, no new MR is created, and the reply links the commit

#### Scenario: Follow-up on a merged MR
- **WHEN** a thread follow-up arrives after every MR of the task is merged
- **THEN** nothing is pushed and the reply ends with the warning that the MR is merged

#### Scenario: GitLab sees the pushed branch late
- **WHEN** MR creation right after the push answers 400 because the source branch does not exist yet
- **THEN** oskhs retries with kiss's delays (5, 10, 20, 40, 45 s) and creates the MR once the branch is visible

#### Scenario: Push or API failure
- **WHEN** GitLab rejects the push or the MR creation
- **THEN** the task is closed with an error naming the repository and the failing step
