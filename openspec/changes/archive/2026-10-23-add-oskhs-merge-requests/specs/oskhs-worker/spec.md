# Spec Delta

## ADDED Requirements

### Requirement: GitLab mirrors
The worker SHALL keep a bare mirror per kiss repository at `<mirror
dir>/<project path>.git`, cloned when missing and fetched with pruning at the
start of every round that uses it, over HTTPS from `OSKHS_GITLAB_URL`, with
the GitLab token given to git only through the environment. The token SHALL
NOT appear in any command line, remote URL, file, or log.

#### Scenario: Missing mirror is cloned
- **WHEN** a task names a repository with no mirror
- **THEN** oskhs clones it as a bare mirror before the round, and every git call's argv is free of the token

#### Scenario: Mirror is refreshed
- **WHEN** a commit was pushed to the repository after the last round
- **THEN** the next round's mirror fetch brings it, and the sandbox sync delivers it

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
`state: 'review'` unless a cancel arrived. A round without changes SHALL end
`completed` as an answer.

#### Scenario: MR linked in the thread
- **WHEN** a marked task in the dev channel asks for a change to one repository
- **THEN** a merge request exists on GitLab from the task's branch, assigned to the bot, the task is in `review` with the MR on its repository entry, and kiss posts the MR link in the thread

#### Scenario: Answer without changes
- **WHEN** a non-read-only task only asks a question
- **THEN** no branch or MR is created and the task ends `completed` with the reply

#### Scenario: Push or API failure
- **WHEN** GitLab rejects the push or the MR creation
- **THEN** the task is closed with an error naming the repository and the failing step
