# oskhs: kiss rounds in OpenShell sandboxes

oskhs is the host-side adapter that will let kiss run its agent tasks in
OpenShell sandboxes (roadmap Track B, [docs/roadmap.md](roadmap.md)). It
lives in [`oskhs/`](../oskhs/) as a Bun + TypeScript subproject and depends on
kiss only through the task document in Mongo — not yet: this page tracks
what exists today, slice by slice.

**Today (B1.1a):** a round library and a `run-round` CLI. No kiss, no Mongo.

## Warm repo sandboxes

Each project gets one long-lived sandbox, `repo-<project>` (project = the
repo directory's basename, lowercased, `[a-z0-9-]` only). Inside it:

| Path | What |
|---|---|
| `/sandbox/repo` | bare repository; delivered branches under `refs/remotes/origin/*`, tags under `refs/tags/*`; no remote URL |
| `/sandbox/tasks/<task-id>` | one detached git worktree per round, removed when the round ends |
| `/sandbox/.oskhs/in`, `/sandbox/.oskhs/out` | transfer files (bundles); empty between rounds |

The first round seeds the repository: oskhs bundles the local clone's
branches and tags (`git bundle create … --branches --tags`), uploads the
bundle with `openshell sandbox upload --no-git-ignore`, fetches it into the
bare repository inside the sandbox, and deletes the bundle. Later rounds
reuse the seed. The sandbox itself is created with `maki-oss up`, which
never uploads a project directory. Nothing crosses through `--env` or a bind
mount; the sandbox has no GitLab or Mongo egress, so `git fetch`/`pull`
there fail by design.

## Running a round

```sh
export OSKHS_PROVIDERS=maki-synthetic
export OSKHS_MODEL=synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
bun oskhs/src/cli.ts run-round ~/src/myrepo "Where is the retry logic?"
```

Options: `--model SPEC`, `--base BRANCH` (default: the local clone's current
branch), `--provider NAME` (repeatable; replaces `OSKHS_PROVIDERS`),
`--timeout SECS` (default 600, or `OSKHS_TIMEOUT`), `--gateway NAME`,
`--task-id ID`. `OPENSHELL_BIN` and `MAKI_OSS_BIN` override the CLIs used.

A round adds `/sandbox/tasks/<task-id>` from `origin/<base>`, runs
`maki-oss run --no-sync --timeout SECS` with `MAKI_OSS_SANDBOX_NAME` and
`MAKI_OSS_WORKDIR` pointing at the sandbox and worktree, and removes the
worktree afterwards, also after a failure. The time limit is enforced inside
the sandbox ([helper reference](helper.md#run)): Maki and every tool process
it started end there.

## Results

stdout carries one JSON object: `taskId`, `sandbox`, and a `kind`:

| kind | fields | exit |
|---|---|---|
| `answer` | `text`, `sessionId`, `durationMs`, `numTurns`, `usage` | 0 |
| `agent-error` | `message`, `sessionId` — Maki reported an error (it exits 0 for provider errors) | 4 |
| `timeout` | `seconds` | 4 |
| `failed` | `stage` (`sandbox`, `seed`, `worktree`, `run`, `parse`), `exitCode`, `stderr` | 3 |

Usage errors exit 1. Progress lines go to stderr with an `oskhs:` prefix.

## Tests

`make test-oskhs` runs the offline suite (a recording command runner, no
gateway). `oskhs/test/make-fixture.sh DIR` builds the two-branch fixture the
live checks use; the recorded live run is in
`openspec/changes/archive/*-add-oskhs-round/evidence/round-live.md`.
