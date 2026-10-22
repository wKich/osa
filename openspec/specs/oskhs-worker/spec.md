# oskhs-worker Specification

## Purpose
Runs kiss tasks marked for oskhs: claims them from kiss's MongoDB with the
same compare-and-set KHS uses, keeps their heartbeat, honors cancellation,
answers first rounds and thread follow-ups in the fields kiss posts from,
refuses what it cannot run safely, and recovers the tasks it held when it
died — all from the oskhs host process, with the database credential never
entering a sandbox.

## Requirements

### Requirement: Claiming marked tasks
The oskhs worker SHALL claim kiss tasks with a single compare-and-set whose
filter is KHS's claim filter plus `executor: 'oskhs'`, and SHALL set
`runtimeState: 'running'`, its own `agentHostId`, `lastRuntimeHeartbeatAt`,
and `wakeRequestedAt: null`. It SHALL NOT claim while at its global round cap,
and SHALL NOT claim a task whose project is at the per-project cap. The Mongo
connection string SHALL come from the oskhs host's environment and SHALL
never be passed to a sandbox.

#### Scenario: Only marked tasks are claimed
- **WHEN** one marked and one unmarked task are due
- **THEN** the worker claims the marked one and leaves the unmarked one untouched

#### Scenario: Project cap
- **WHEN** a project already has `--max-per-project` rounds running and another of its tasks is due
- **THEN** the worker does not claim it until a round of that project ends

### Requirement: Heartbeat and cancellation
While a claimed task is running, the worker SHALL refresh its heartbeat with
an update filtered on `cancelRequestedAt: null` and a runtime state other
than `stopping`/`idle_stopped`, at an interval well inside kiss's
dead-runtime timeout, and SHALL check for cancellation every few seconds.
On cancellation it SHALL abort the round and finish the cancel by setting
`cancelledAt`, `runtimeState: 'idle_stopped'`, and `wakeRequestedAt: null`,
without writing any result.

#### Scenario: Cancel mid-round
- **WHEN** `cancelRequestedAt` is set while a round is running
- **THEN** the round is aborted within seconds, `cancelledAt` is set, `runtimeState` is `idle_stopped`, and no `replyMessage` is written

#### Scenario: Heartbeat keeps the task alive
- **WHEN** a round runs longer than several heartbeat intervals
- **THEN** `lastRuntimeHeartbeatAt` advances on each interval and reconcile never treats the task as dead

### Requirement: Results in kiss's format
For a claimed task in `state: 'processing'` the worker SHALL run one round
on its prompt and write the answer as `replyMessage` with `state:
'completed'`; a failed or timed-out first round SHALL write `state:
'closed'` with an `errorMessage`. Every pending `thread_instruction` sub-task
SHALL be claimed (`pending → processing`), answered by a round, and set to
`completed` with `reply` (or `error` with `errorMessage`); sub-task types
oskhs does not support SHALL be set to `error` with a message saying so.
Afterwards the worker SHALL set `runtimeState: 'idle_stopped'` and
`idleStoppedAt`. All result writes SHALL be skipped when a cancel arrived.

#### Scenario: Echo reply posted by kiss
- **WHEN** a marked Mattermost task is processed by the echo round
- **THEN** the task ends `completed` with `replyMessage` set and `idle_stopped`, and kiss's status sync posts the reply in the source thread

#### Scenario: Follow-up sub-task
- **WHEN** a marked task is woken with a pending `thread_instruction` sub-task
- **THEN** the sub-task ends `completed` with a reply and the parent's `state` is unchanged

#### Scenario: Unsupported sub-task
- **WHEN** a marked task is woken with a pending `gitlab_review_comment` sub-task
- **THEN** that sub-task ends `error` with a message naming oskhs, and the task is not re-woken by it

### Requirement: Restricted network is refused fail-closed
The worker SHALL refuse a claimed task whose project has a network
restriction profile: `state: 'closed'`, an `errorMessage` stating that
restricted-network tasks are not supported by oskhs, `runtimeState:
'failed'`, `runtimeStartFailures: 4`, and no wake, so it is never claimed
again and the user sees the reason.

#### Scenario: Restricted project
- **WHEN** a marked task's project has `networkRestrictionProfileId` set
- **THEN** no round runs and the task is closed with that error

### Requirement: Round limits and task logs
Every round SHALL have a time limit (`--round-timeout`, default 600 s); a
round that exceeds it SHALL be aborted and reported as a timeout. The worker
SHALL write one JSON-lines log per task id under its state directory,
recording claim, round start and end, cancel, refusal, recovery, and idle
events, and SHALL never write a credential there.

#### Scenario: Round timeout
- **WHEN** a round takes longer than its limit
- **THEN** it is aborted and the task is closed with an error naming the timeout

#### Scenario: Log by task id
- **WHEN** a task was processed
- **THEN** `<state dir>/oskhs/tasks/<task-id>.jsonl` holds its events in order

### Requirement: Recovery of the worker's own tasks
On start the worker SHALL find tasks marked `oskhs` that it holds as
`running` (its `agentHostId`) and SHALL requeue each (`runtimeState:
'failed'`, a wake, `runtimeStartFailures` incremented, its `processing`
sub-tasks back to `pending`), or — after the task already lost two rounds —
close it with a visible error. On SIGINT/SIGTERM the worker SHALL abort its
rounds and requeue their tasks without counting a failure.

#### Scenario: Killed mid-round, restarted
- **WHEN** the worker is killed during a round and started again
- **THEN** the task is requeued, claimed again, and completed; it never stays `running` without a live worker

#### Scenario: Repeated losses end visibly
- **WHEN** a task was lost mid-round three times
- **THEN** it is closed with an error instead of being requeued again

### Requirement: Contract with kiss's schema
oskhs's tests SHALL validate every document shape the worker writes against
kiss's own mongoose schemas when the kiss repository is available, and SHALL
skip with a message otherwise.

#### Scenario: Schema drift is caught
- **WHEN** kiss renames a runtime state oskhs writes
- **THEN** the contract test fails

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

### Requirement: Project model from kiss's ModelProvider
For each sandbox round the worker SHALL derive the model and its credential
from the task's `modelProvider`: a custom OpenShell profile per provider
protocol and base URL with `protocol: rest`, enforced inference-only rules
(OpenAI: `POST <base>/chat/completions`, `GET <base>/models`; Anthropic:
`POST <base>/v1/messages`, `GET <base>/v1/models`) and `/usr/local/bin/maki`
as the only binary; a provider instance per project created or updated with
`--credential OSKHS_MODEL_API_KEY` so the key never appears in a command
line; that provider as the only one attached to `repo-<project>`; and a Maki
custom provider `kiss` with the same base URL, so Maki runs with `--model
kiss/<model id>`. A changed key, type, or base URL SHALL be re-synced before
the next round.

#### Scenario: Two projects, two models
- **WHEN** two marked projects whose providers differ in protocol, base URL, and model each get a question
- **THEN** each answers in its own sandbox through its own provider instance and model

#### Scenario: Only placeholders in the sandbox
- **WHEN** a round has run
- **THEN** the sandbox environment's credential variable holds the gateway's stand-in, not the key, and no other credential variable exists

#### Scenario: Non-inference path refused
- **WHEN** a request carrying the stand-in goes from the sandbox to a non-inference path of the provider API
- **THEN** OpenShell refuses it with a policy denial

#### Scenario: Key rotation
- **WHEN** the provider's key changes in kiss between two rounds
- **THEN** the next round updates the provider instance before Maki starts, and no command line carries the key

### Requirement: Internal models stay on internal gateways
A task whose model provider is internal (`isExternal: false`) SHALL run only
on a worker started with `--internal-models`; any other worker SHALL fail
the round before contacting the sandbox, with a message naming the model.

#### Scenario: Internal model on an external gateway
- **WHEN** a worker without `--internal-models` claims a task with an internal model
- **THEN** the task is closed with an error naming the model and the flag, and no provider or sandbox call is made

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
