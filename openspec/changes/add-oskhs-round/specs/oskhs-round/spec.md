# Spec Delta

## ADDED Requirements

### Requirement: Warm repo sandbox seeding
oskhs SHALL keep one sandbox per project named `repo-<project>`, where
`<project>` is the repo directory's basename lowercased with every character
outside `[a-z0-9-]` replaced by `-`. When the sandbox is missing, oskhs SHALL
create it through `maki-oss up` with the configured providers and SHALL NOT
upload a project directory. When the sandbox holds no clone at
`/sandbox/repo`, oskhs SHALL create a full git bundle of the local repo
(`--all`), upload it with `openshell sandbox upload --no-git-ignore`, clone
it inside the sandbox, and delete the uploaded bundle. A failed seed SHALL
leave no partial clone behind. Seeding MUST NOT pass any `--env` value and
MUST NOT use a bind mount.

#### Scenario: First round seeds the sandbox
- **WHEN** `run-round <repo> "<prompt>"` runs and no `repo-<project>` sandbox exists
- **THEN** the recorded calls create the sandbox with `maki-oss up`, upload a bundle, run `git clone` inside the sandbox, and remove the uploaded bundle, before any worktree is added

#### Scenario: Seeded sandbox is reused
- **WHEN** `repo-<project>` exists and `/sandbox/repo` is a git repository
- **THEN** no bundle is created or uploaded

#### Scenario: Failed clone leaves nothing behind
- **WHEN** the in-sandbox `git clone` fails
- **THEN** the result is `failed` with stage `seed`, and oskhs removes `/sandbox/repo` so the next round seeds again

### Requirement: Round in a fresh task worktree
For every round oskhs SHALL add a detached worktree at
`/sandbox/tasks/<task-id>` from the round's base (default: the local repo's
current branch, as `origin/<branch>`), run Maki through
`maki-oss run --no-sync --timeout <secs>` with `MAKI_OSS_SANDBOX_NAME` set to
the sandbox and `MAKI_OSS_WORKDIR` set to the worktree, and remove the
worktree afterwards, including when the round failed.

#### Scenario: Round runs in its own worktree
- **WHEN** a round runs
- **THEN** the `maki-oss run` call carries `--no-sync`, `--timeout`, `MAKI_OSS_WORKDIR=/sandbox/tasks/<task-id>`, and `MAKI_OSS_SANDBOX_NAME=repo-<project>`, and a `git worktree remove` for that path follows it

#### Scenario: Live round answers from the repo
- **WHEN** `run-round` runs on a small repo against the local gateway with a prompt that asks about a file's contents
- **THEN** it prints the answer Maki produced from the worktree and exits 0, and the worktree no longer exists afterwards

### Requirement: Typed round results
oskhs SHALL parse Maki's JSON result line into exactly one of: `answer`
(text, session id, duration, turns, usage) when `is_error` is false;
`agent-error` (message, session id) when `is_error` is true, regardless of
the exit code; `timeout` when the round exceeded its time limit;
`failed` (stage, exit code, stderr tail) for any seed, worktree, helper, or
parse failure. The CLI SHALL print the result as one JSON object on stdout
and exit 0 only for `answer`.

#### Scenario: Agent error with exit 0
- **WHEN** Maki exits 0 and prints a result with `is_error: true`
- **THEN** the result kind is `agent-error` carrying Maki's message

#### Scenario: Unparseable output
- **WHEN** the helper exits 0 but stdout holds no result line
- **THEN** the result kind is `failed` with stage `parse`

#### Scenario: Timeout
- **WHEN** the helper exits 124
- **THEN** the result kind is `timeout` with the configured seconds
