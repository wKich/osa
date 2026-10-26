# oskhs: kiss rounds in OpenShell sandboxes

oskhs is the host-side adapter that will let kiss run its agent tasks in
OpenShell sandboxes (roadmap Track B, [docs/roadmap.md](roadmap.md)). It
lives in [`oskhs/`](../oskhs/) as a Bun + TypeScript subproject and depends on
kiss only through the task document in Mongo — not yet: this page tracks
what exists today, slice by slice.

**Today (B1.1a–B1.4):** a round library with incremental git sync and
changes returned as a host branch (`run-round`), and a kiss queue worker
(`worker`) that answers marked kiss tasks with Maki in the project's warm
sandbox.

## Warm repo sandboxes

Each project gets one long-lived sandbox, `repo-<project>` (project = the
kiss project title, or for `run-round` the repo directory's basename,
lowercased, `[a-z0-9-]` only). OpenShell allows 19 characters, so a project
longer than 14 keeps its first 9 characters plus `-` and four hex
characters of a hash of the whole name (`ascii-minecraft` →
`repo-ascii-min-xxxx`); the project's provider, `oskhs-<project>`, uses the
same fitted part. oskhs drives `maki-oss` in caller-owned workspace mode
(`MAKI_OSS_WORKSPACE=caller`, [helper reference](helper.md#caller-owned-workspace-maki_oss_workspacecaller))
with the idle stop off (`MAKI_OSS_IDLE_STOP=0`): the helper keeps no
session sync, registry entry, or parked marker for these sandboxes, and
does not stop them when idle — their lifecycle is oskhs's (B2). A
repository's `<subdir>` follows kiss:
`worktreeSubdir`, else the project path with `/` → `_`. Inside it:

| Path | What |
|---|---|
| `/sandbox/repos/<subdir>` | one bare repository per repository; delivered branches under `refs/remotes/origin/*`, tags under `refs/tags/*`; `origin` points at `/oskhs-offline`, a path that never exists |
| `/sandbox/tasks/<task-id>/` | the round's workspace: one git worktree per repository at `<subdir>/` on branch `task-<task-id>`, plus an `AGENTS.md` index; Maki runs here; removed when the round ends |
| `/sandbox/.oskhs/in`, `/sandbox/.oskhs/out` | transfer files (bundles); empty between rounds |

## Sync

Before every round oskhs syncs the refs the round needs:

1. It reads the sandbox's tip for every `refs/remotes/origin/*` and
   `refs/tags/*` ref (one exec). The sandbox is the record; nothing is kept
   host-side.
2. *Wanted* refs are the base branch plus every `--branch`, or with
   `--all-branches` every host branch and tag.
3. Wanted refs whose sandbox tip differs travel in one bundle,
   `git bundle create … <refs> --not <tips>`, where only tips the host also
   has count as prerequisites — a tip the agent moved or invented can make
   the bundle larger, never wrong. If the fetch still fails, oskhs retries
   once with a full bundle (`full: true`). A ref rewound to a commit the
   sandbox already has moves with `git update-ref`, no bundle.
4. Branches deleted on the host are removed from the sandbox
   (`git update-ref -d`); tags too in `--all-branches` mode. A branch that
   still exists but is not wanted this round is left alone.

A fresh sandbox is just the case with no tips: the first round sends the
full history of its wanted refs. The sandbox is created with `maki-oss up`,
which never uploads a project directory. Bundles land in
`/sandbox/.oskhs/in/<task-id>-<subdir>.bundle` and are deleted after the
fetch.
Nothing crosses through `--env` or a bind mount.

Measured on the fixture: first round 115 375 bytes, the next after one
commit 1 040 bytes.

## What the agent sees

- Full local history of every delivered ref: `log`, `blame`, `diff`,
  `show origin/<b>:<path>`.
- `git checkout <b>` of a delivered branch works (git creates a local branch
  tracking `origin/<b>`). git refuses a branch another task's worktree has
  checked out; detach or branch off instead.
- `git fetch` / `pull` fail: `origin` is `/oskhs-offline`, and the sandbox
  has no GitLab egress anyway.
- Worktrees share one ref store. oskhs owns `refs/remotes/origin/*` and
  `refs/tags/*` (force-reset on the next sync) and, when a round's worktree
  is removed (after its changes were collected), deletes every local branch
  no remaining worktree has checked out, so the next task never checks out
  a stale copy.

## Changes back

After a round that answered, oskhs collects what the agent changed before
removing the worktree:

1. In the worktree: `git add -A` (`.gitignore` applies) and, if anything is
   staged, one commit `oskhs: uncommitted changes from task <id>` on the
   current HEAD. Commits the agent made itself are kept as they are. The
   sandbox repository's identity is `Maki (oskhs) <maki@oskhs.invalid>`.
2. `task-<id>` is pointed at the worktree's final HEAD — whatever branch the
   agent ended on.
3. If that differs from the base, the sandbox bundles `task-<id>` with the
   host's own synced object ids as prerequisites; oskhs downloads it,
   checks it (`git bundle verify`, exactly one advertised ref), and fetches
   it with `fetch.fsckObjects` into the host repository as
   `refs/heads/oskhs/<task-id>`. A head the host already has (the agent only
   checked out a delivered commit) is set directly, without a bundle.

Bundles carry deletions and renames, unlike `maki-oss download`, which
merges files and would bring deleted ones back. Anything unexpected fails
the round with stage `collect` and leaves the host's refs as they were.
Rounds that did not answer collect nothing; `--no-changes` disables
collection for read-only rounds.

## Running a round

```sh
export OSKHS_PROVIDERS=maki-synthetic
export OSKHS_MODEL=synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
bun oskhs/src/cli.ts run-round ~/src/myrepo "Where is the retry logic?"
```

Options: `--model SPEC`, `--base BRANCH` (default: the local clone's current
branch), `--branch NAME` (repeatable: the task's own branches, delivered with
the base), `--all-branches` (every branch and tag), `--no-changes` (discard the
worktree's changes), `--provider NAME` (repeatable; replaces `OSKHS_PROVIDERS`),
`--timeout SECS` (default 600, or `OSKHS_TIMEOUT`), `--gateway NAME`,
`--task-id ID`. `OPENSHELL_BIN` and `MAKI_OSS_BIN` override the CLIs used.

A round syncs, adds `/sandbox/tasks/<task-id>` from `origin/<base>`, runs
`maki-oss run --timeout SECS` in caller mode with `MAKI_OSS_SANDBOX_NAME` and
`MAKI_OSS_WORKDIR` pointing at the sandbox and workspace, and removes the
worktree afterwards, also after a failure. The time limit is enforced inside
the sandbox ([helper reference](helper.md#run)): Maki and every tool process
it started end there.

## Results

stdout carries one JSON object: `taskId`, `sandbox`, `repos` — one entry
per repository with `key`, `sync` (`bundleBytes`, `updated`, `pruned`,
`prerequisites`, `full`, `tips`; absent if the round failed before that
repository synced) and `changes` (`null`, or `branch`, `head`, `base`,
`commits`, `bundleBytes`, and `files` with `added`, `modified`, `deleted`,
`renamed`) — and a `kind`:

| kind | fields | exit |
|---|---|---|
| `answer` | `text`, `sessionId`, `durationMs`, `numTurns`, `usage` | 0 |
| `agent-error` | `message`, `sessionId` — Maki reported an error (it exits 0 for provider errors) | 4 |
| `timeout` | `seconds` | 4 |
| `failed` | `stage` (`sandbox`, `seed`, `sync`, `worktree`, `run`, `parse`, `collect`), `exitCode`, `stderr` | 3 |

Usage errors exit 1. Progress lines go to stderr with an `oskhs:` prefix.

## The kiss worker

`oskhs worker` claims kiss tasks marked `executor: 'oskhs'` (kiss sets the
marker from the Mattermost channel or project; KHS never claims those) and
runs them the way kiss's own task container does. It needs
`OSKHS_MONGO_URI`; that URI stays in the oskhs host process and never
reaches a sandbox.

```sh
OSKHS_MONGO_URI=mongodb://127.0.0.1:27017/kiss-agent bun oskhs/src/cli.ts worker
```

Per claimed task:

1. **Claim** — KHS's claim filter plus `executor: 'oskhs'`: `runtimeState:
   running`, `agentHostId` (`OSKHS_HOST_ID`, default `oskhs-<hostname>`),
   heartbeat, wake cleared. Projects at `--max-per-project` (default 1 — one
   sandbox per project) are skipped; at most `--max-rounds` (default 2) run.
2. **Refuse** a project with a network restriction profile: closed with a
   visible error, never claimed again.
3. **First round** of a `processing` task: the answer becomes `replyMessage`
   with `state: completed`; a failure or timeout (`--round-timeout`, default
   600 s) closes the task with `errorMessage`. kiss's status sync posts
   either into the Mattermost thread.
4. **Follow-ups**: every pending `thread_instruction` sub-task is answered
   (`reply`, `completed`) and kiss posts it; other sub-task types end in
   `error` with a message naming oskhs.
5. **Idle**: `runtimeState: idle_stopped`. The next mention wakes the task
   again.

While a round runs the worker heartbeats every `--heartbeat-sec` (20 s;
kiss treats a runtime as dead after 10 minutes) and checks for a cancel
every `--cancel-poll-sec` (3 s). A cancel aborts the round and finishes the
cancel as kiss's `markCancelFinished` does; no result is written.

**Recovery.** On start the worker requeues every task it still holds as
`running` (a crash or `kill -9` left it there); the third loss closes the
task with an error instead. SIGINT/SIGTERM abort rounds and requeue their
tasks without counting a loss. If oskhs stays down, kiss's reconcile
requeues its stale tasks after 10 minutes and they wait for oskhs.

**Logs.** `${XDG_STATE_HOME:-~/.local/state}/oskhs/tasks/<task-id>.jsonl`,
one event per line (`claimed`, `round-start`, `round-end`, `cancelled`,
`refused`, `recovered`, `requeued`, `idle`, …).

### The sandbox round

`--round sandbox` (the default) answers each task with Maki in the
project's warm sandbox:

- **Repositories** come from the task's `taskRepositories`, synced from
  bare mirrors at `<mirror dir>/<project path>.git` (`--mirror-dir` or
  `OSKHS_MIRROR_DIR`); each worktree starts from the repository's
  `branchName` when the task continues one, else the mirror's default
  branch. A missing mirror closes the task with an error naming the path.
  With `OSKHS_GITLAB_URL` and `OSKHS_GITLAB_TOKEN` set, oskhs clones a
  missing mirror and fetches it (with pruning) before every round, over
  HTTPS; without them it uses whatever mirrors exist and rounds stay
  read-only.
- **Prompt**: answer-only instructions with kiss's no-changes `[RESULT]`
  format, then kiss's task-context block — repositories, source URL, thread
  root and discussion, thread URL, the author's task line — byte for byte
  what kiss's own `generateTaskPrompt` renders (a contract test compares).
  A follow-up uses the prompt kiss built for the sub-task.
- **Reply**: the `Reply` field of Maki's `[RESULT]` block, parsed as kiss
  parses it; the whole answer if there is none.
- **Code requests**: see *Merge requests* below; read-only tasks
  (`readOnly`) collect nothing.
- **Model**: from the task's kiss `modelProvider` — see below; `--model` /
  `--provider` only serve a task without one.
- **Cancel**: the round runs under `maki-oss run --timeout` with the run tag
  `oskhs-<task-id>`; a cancel creates `/tmp/maki-oss-stop/<tag>` in the
  sandbox, the wrapper stops Maki and its tools, and the workspace is
  removed before the task is released (`--abort-grace-sec`, 30 s).

The sandbox holds only the provider stand-in; its effective policy allows
the model endpoint for the `maki` binary and nothing else, so neither the
kiss database nor GitLab is reachable from it.

```sh
export OSKHS_MONGO_URI=mongodb://127.0.0.1:27017/kiss-agent
export OSKHS_GITLAB_URL=https://git.example.com OSKHS_GITLAB_TOKEN=…   # the bot's token
bun oskhs/src/cli.ts worker --mirror-dir ~/oskhs-mirrors --internal-models --agent-name svc_kiss
```

### Merge requests

A first round of a task that is not `readOnly`, on a worker with GitLab
configured, is a code round: kiss's code-or-answer instructions and its
`[RESULT]` format (Title, Description, Branch, Labels, Reply) — the same
text kiss gives its agent, contract-tested. If Maki changed a repository:

1. Its leftovers are committed with the result's Title as the message and
   collected as in *Changes back*.
2. The branch is kiss's: the `/branch` directive, else the agent's proposed
   Branch if no GitLab branch has that name, else `kiss-agent/<8 hex>`,
   sanitized as kiss does. oskhs pushes it from the mirror and drops its
   local `oskhs/<task-id>` ref.
3. An MR into the round's base branch is opened (or an open one reused):
   kiss's title and description plus `Источник задачи: <source>`, labels
   with `ai_generated`, assigned to the token's user — the bot, which is how
   kiss's `GitLabMRTaskSource` tracks its MRs — and the task author as
   reviewer when they are a project member.
4. The task gets `mrUrl`, `mrIid`, `branchName` on its repository entries,
   `taskDescription`, `replyMessage`, and `state: review`; kiss's status
   sync posts the MR link in the thread.

MR creation retries an HTTP 400 with kiss's delays (5, 10, 20, 40, 45 s):
GitLab's MR endpoint can miss a branch pushed a moment earlier. A moved
project is not retried.

A round without changes is an answer (`completed`), and so is one whose
`[RESULT]` reports none (`Status: no_changes`, `Changed: no`): its edits are
dropped, as kiss drops them.

Thread follow-ups (`thread_instruction`) are code rounds too, as in kiss:

- A repository with an MR works on the MR's branch; the follow-up's commits
  are force-pushed there, and the reply ends with kiss's
  `Commit <8 hex> (<url>)` links. Leftover edits are committed with the
  `Commit` field, else `Title`, else kiss's default title.
- A changed repository without an MR gets one on the task's branch — so a
  follow-up after a question round opens the task's first MR; the task goes
  to `review` with `replyMessage` cleared (the sub-task carries the reply).
- When every MR is merged or closed, the follow-up only answers, ending
  with kiss's "MR уже влит/закрыт" warning.

MR review comments and other sub-task types are not handled by oskhs yet
(B3): they end in `error` with a message naming oskhs. Commits carry
oskhs's author, not the requester as co-author (kiss sets `--author`).

The GitLab token is the oskhs host's secret, like the Mongo URI: git gets
it only through the environment (`GIT_CONFIG_*` → `http.extraHeader`), the
API as a header; it is in no argv, remote URL, file, or log.

### Model and credentials

Every sandbox round derives its model from the task's kiss `modelProvider`
(`providerType` `openai` or `anthropic`, `baseUrl`, model `id`, `apiKey`,
`isExternal`):

| What | Name | Content |
|---|---|---|
| OpenShell profile, one per protocol and base URL | `oskhs-<protocol>-<host>-<hash>` | `protocol: rest`, `enforcement: enforce`, inference-only rules — OpenAI `POST <base>/chat/completions`, `GET <base>/models`; Anthropic `POST <base>/v1/messages`, `GET <base>/v1/models` — credential `OSKHS_MODEL_API_KEY`, binary `/usr/local/bin/maki` |
| OpenShell provider, one per project | `oskhs-<project>` | the key, created or updated with `--credential OSKHS_MODEL_API_KEY`: the value is in the CLI's environment only, never its argv |
| Sandbox providers | `repo-<project>` | exactly `oskhs-<project>`; anything else attached is detached |
| Maki config | `/sandbox/.config/maki/providers.toml` | custom slug `kiss`: protocol, base URL, `api_key_env = "OSKHS_MODEL_API_KEY"`, the model; Maki runs `--model kiss/<id>` |

oskhs remembers each provider's type and a truncated hash of the key in
`<state dir>/oskhs/providers.json` (mode 0600) and re-syncs when kiss's
record changes: a new key updates the provider, a new protocol or URL
re-creates it. The sandbox sees only the gateway's stand-in; requests to any
other path of the provider API are refused by the profile's rules.
OpenShell 0.1.5 has no `--secret-material-env`; `--credential KEY` reading
the value from the environment is its equivalent.

A model with `isExternal: false` (kiss's internal models) runs only on a
worker started with `--internal-models`, meaning its gateway reaches the
internal network; elsewhere the task is closed with an error saying so.

`--round echo` keeps B1.3b's echo (`--fake-delay SECS` makes it slow, for
cancel and kill checks).

## Tests

`make test-oskhs` runs the offline suite: a recording command runner for
argv shape, and a local-sandbox runner that executes the in-sandbox git
scripts with real git against a temp directory, so sync semantics (deltas,
prunes, rewinds, untrusted tips, the full-bundle fallback) are tested
without a gateway. `core.test.ts` runs oskhs's `up` and `run` calls through
the real `bin/maki-oss` against the stub `openshell`, so a helper-core change
that would block a later round fails here. `oskhs/test/make-fixture.sh DIR` builds the two-branch fixture the
live checks use, and `oskhs/test/live/devstand.ts` writes kiss-shaped tasks,
cancels, and follow-ups into the kiss local stack. `kiss-contract.test.ts`
validates every document the worker writes against kiss's own mongoose
schemas (`KISS_REPO`, default the sibling checkout; skipped without it), and
`OSKHS_TEST_MONGO_URI=mongodb://127.0.0.1:27017` runs the store tests against
a real MongoDB (an ephemeral database). The recorded live runs are in
`openspec/changes/archive/*-add-oskhs-round/evidence/round-live.md`,
`openspec/changes/archive/*-add-oskhs-incremental-sync/evidence/sync-live.md`,
`openspec/changes/archive/*-add-oskhs-commits-back/evidence/collect-live.md`,
`openspec/changes/archive/*-add-oskhs-task-worker/evidence/worker-live.md`,
`openspec/changes/archive/*-add-oskhs-sandbox-round/evidence/sandbox-round-live.md`,
`openspec/changes/archive/*-add-oskhs-model-credentials/evidence/model-live.md`,
and `openspec/changes/archive/*-add-oskhs-merge-requests/evidence/mr-live.md`.
