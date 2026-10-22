# oskhs: kiss rounds in OpenShell sandboxes

oskhs is the host-side adapter that will let kiss run its agent tasks in
OpenShell sandboxes (roadmap Track B, [docs/roadmap.md](roadmap.md)). It
lives in [`oskhs/`](../oskhs/) as a Bun + TypeScript subproject and depends on
kiss only through the task document in Mongo — not yet: this page tracks
what exists today, slice by slice.

**Today (B1.1a–B1.1b):** a round library with incremental git sync and a
`run-round` CLI. No kiss, no Mongo.

## Warm repo sandboxes

Each project gets one long-lived sandbox, `repo-<project>` (project = the
repo directory's basename, lowercased, `[a-z0-9-]` only). Inside it:

| Path | What |
|---|---|
| `/sandbox/repo` | bare repository; delivered branches under `refs/remotes/origin/*`, tags under `refs/tags/*`; `origin` points at `/oskhs-offline`, a path that never exists |
| `/sandbox/tasks/<task-id>` | one detached git worktree per round, removed when the round ends |
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
`/sandbox/.oskhs/in/<task-id>.bundle` and are deleted after the fetch.
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
  is removed, deletes every local branch no remaining worktree has checked
  out, so the next task never checks out a stale copy.

## Running a round

```sh
export OSKHS_PROVIDERS=maki-synthetic
export OSKHS_MODEL=synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
bun oskhs/src/cli.ts run-round ~/src/myrepo "Where is the retry logic?"
```

Options: `--model SPEC`, `--base BRANCH` (default: the local clone's current
branch), `--branch NAME` (repeatable: the task's own branches, delivered with
the base), `--all-branches` (every branch and tag), `--provider NAME` (repeatable; replaces `OSKHS_PROVIDERS`),
`--timeout SECS` (default 600, or `OSKHS_TIMEOUT`), `--gateway NAME`,
`--task-id ID`. `OPENSHELL_BIN` and `MAKI_OSS_BIN` override the CLIs used.

A round syncs, adds `/sandbox/tasks/<task-id>` from `origin/<base>`, runs
`maki-oss run --no-sync --timeout SECS` with `MAKI_OSS_SANDBOX_NAME` and
`MAKI_OSS_WORKDIR` pointing at the sandbox and worktree, and removes the
worktree afterwards, also after a failure. The time limit is enforced inside
the sandbox ([helper reference](helper.md#run)): Maki and every tool process
it started end there.

## Results

stdout carries one JSON object: `taskId`, `sandbox`, `sync` (`bundleBytes`,
`updated`, `pruned`, `prerequisites`, `full`; absent if the round failed
before the sync finished), and a `kind`:

| kind | fields | exit |
|---|---|---|
| `answer` | `text`, `sessionId`, `durationMs`, `numTurns`, `usage` | 0 |
| `agent-error` | `message`, `sessionId` — Maki reported an error (it exits 0 for provider errors) | 4 |
| `timeout` | `seconds` | 4 |
| `failed` | `stage` (`sandbox`, `seed`, `sync`, `worktree`, `run`, `parse`), `exitCode`, `stderr` | 3 |

Usage errors exit 1. Progress lines go to stderr with an `oskhs:` prefix.

## Tests

`make test-oskhs` runs the offline suite: a recording command runner for
argv shape, and a local-sandbox runner that executes the in-sandbox git
scripts with real git against a temp directory, so sync semantics (deltas,
prunes, rewinds, untrusted tips, the full-bundle fallback) are tested
without a gateway. `oskhs/test/make-fixture.sh DIR` builds the two-branch fixture the
live checks use; the recorded live runs are in
`openspec/changes/archive/*-add-oskhs-round/evidence/round-live.md` and
`openspec/changes/archive/*-add-oskhs-incremental-sync/evidence/sync-live.md`.
