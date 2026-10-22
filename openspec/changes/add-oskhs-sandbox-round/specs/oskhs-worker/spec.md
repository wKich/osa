# Spec Delta

## ADDED Requirements

### Requirement: Sandbox round for kiss tasks
The worker's default round SHALL run Maki in the project's warm sandbox
(`repo-<project title>`) with one worktree per entry of the task's
`taskRepositories`, synced from the host's bare mirror
`<mirror dir>/<project path>.git`, each on the repository's `branchName`
when set, else the mirror's default branch, with the model and providers the
worker is configured with. The round SHALL be read-only: no changes are
collected. A missing mirror SHALL fail the round with a message naming the
expected path. The Mongo URI and every other worker credential SHALL stay out
of the sandbox.

#### Scenario: Question answered from the repositories
- **WHEN** a marked task asks about a file in one of the project's repositories
- **THEN** Maki answers in the sandbox from that repository's worktree and the answer becomes the task's `replyMessage`

#### Scenario: Missing mirror
- **WHEN** a task names a repository with no mirror under the mirror dir
- **THEN** the task is closed with an error naming the missing mirror path, and no Maki run starts

#### Scenario: Sandbox holds no secrets and cannot reach Mongo
- **WHEN** a sandbox round has run
- **THEN** the sandbox environment holds only provider stand-ins, no Mongo or GitLab variable, and a TCP connection from the sandbox to the kiss MongoDB fails

### Requirement: Task prompt in kiss's shape
The prompt of a first round SHALL end with kiss's task-context block for the
task — repository context, source URL, thread root and discussion, thread
URL with kiss's delivery instruction, and the author's task line — identical
to what kiss's `generateTaskPrompt` renders for the same task, preceded by
answer-only instructions that require kiss's no-changes `[RESULT]` block. A
follow-up round SHALL use the sub-task's prompt unchanged.

#### Scenario: Context matches kiss
- **WHEN** the contract test renders kiss's `generateTaskPrompt` and oskhs's prompt for the same task with two repositories, a thread, and an author
- **THEN** the text from `**Task context:**` to the end is identical

### Requirement: Reply from the result block
The reply written to kiss SHALL be the `Reply` field of the last `[RESULT]`
block of Maki's answer, parsed as kiss's `parsePromptResult` parses it, and
the whole answer when there is no such block.

#### Scenario: Reply field extracted
- **WHEN** Maki answers with prose followed by `[RESULT]` … `Reply: <text>` … `[/RESULT]`
- **THEN** `replyMessage` is `<text>`

#### Scenario: No result block
- **WHEN** Maki answers without a `[RESULT]` block
- **THEN** `replyMessage` is the whole answer
