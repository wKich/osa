# Design

## Context

Roadmap B1.1a. oskhs is the future kiss queue worker (Track B architecture in
`docs/roadmap.md`); this slice builds only its round library: no kiss, no
Mongo. The library drives the gateway through `bin/maki-oss` for the Maki
step and through direct `openshell sandbox` calls for git steps, because
maki-oss assumes "the current directory is the project".

## Explore findings (measured 2026-10-23, OpenShell 0.1.5, Maki 0.6.4)

Spike sandbox `repo-spike` on the local gateway, fixture repo with two
branches, model `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` on the
registered `maki-synthetic` provider.

1. `maki-oss up` with `MAKI_OSS_SANDBOX_NAME` creates the sandbox without
   uploading anything; `maki-oss run` on an existing sandbox never uploads.
   So `run --no-sync` against a pre-seeded sandbox touches no host files.
2. A single-file `openshell sandbox upload <name> <file> <dest-path>` places
   the file at `<dest-path>` (parent directories created). Outside a git work
   tree upload warns and proceeds unfiltered; oskhs passes `--no-git-ignore`
   so the behavior does not depend on where the bundle file lives.
3. `git clone <bundle>` inside the sandbox yields `origin/*` remote-tracking
   refs for every bundled branch; `git worktree add --detach` works under the
   sandbox's Landlock policy (`/sandbox` is writable).
4. Maki writes session state under `/sandbox/.local/state/maki/sessions`, not
   in the worktree: after a round `git status --porcelain --ignored` in the
   worktree is empty.
5. Maki's JSON result is a single stdout line
   `{"type":"result","subtype":"success"|"error","is_error":…,"result":…,
   "session_id":…,"duration_ms":…,"num_turns":…,"usage":{…}}`. A provider
   error (bad model id) is `subtype: "error"`, `is_error: true`, **exit 0**.
   The `session: <id>` line goes to stderr.
6. `openshell sandbox exec --timeout 3 -- sh -c 'sleep 30'` returns 124 after
   3 s **but the remote `sleep` keeps running**. Killing the exec client
   (SIGTERM) likewise leaves the remote process alive. GNU `timeout`
   (coreutils 9.4) is in the image; `pkill` is not.
7. `timeout` alone ends Maki but not its tool commands: a `sleep 120` that
   Maki's shell tool started survived with its own pgid and sid (Maki runs
   tools in a new session). It did inherit an environment variable exported
   before Maki started, and `/proc/<pid>/environ` is readable for the
   sandbox user's own processes.

## Decisions

1. **Stack.** Bun + TypeScript, `oskhs/` beside `bridge/`, same tsconfig and
   test runner. B1.3b needs a Mongo driver, which rules out POSIX sh.
2. **Sandbox layout.** A bare repository at `/sandbox/repo`, filled by
   `git fetch <bundle> '+refs/heads/*:refs/remotes/origin/*'` (plus tags)
   rather than `git clone`: no branch is checked out by the repository
   itself, so any delivered branch can be checked out in a task worktree, no
   working tree is duplicated, and there is no remote URL at all. Task
   worktrees at `/sandbox/tasks/<task-id>`; transfer files under
   `/sandbox/.oskhs/in` and `/sandbox/.oskhs/out`. The seed bundle is
   deleted after the fetch. The host side bundles `--branches --tags` (local
   branches), not `--all`, so a host clone's own remote-tracking refs are not
   shipped twice.
3. **Names.** Project = sanitized basename of the repo directory (lowercase,
   `[a-z0-9-]`); sandbox `repo-<project>`. Task id = `t<unix-ms>-<4 hex>` for
   the CLI; B1.3b replaces it with kiss's task id.
4. **Base.** The round's base defaults to the local repo's current branch,
   delivered as `origin/<branch>` by the seed. `--base` overrides.
5. **Timeout inside the sandbox.** `maki-oss run --timeout SECS` runs the
   exec'd command as `sh -c <wrapper> maki-oss-run <tag> SECS maki …`: the
   wrapper exports `MAKI_OSS_RUN_TAG=<tag>`, runs `timeout --kill-after=10
   SECS`, then kills every process whose environ carries the tag (finding 7),
   so the round and its tools die in the sandbox; exit 124 maps to the `timeout` result. oskhs additionally
   kills its own client after `SECS + 30` as a backstop and reports that as
   `timeout` too. Rationale: finding 6; changing maki-oss keeps one code path
   for Maki's argv.
6. **Seed detection.** `git -C /sandbox/repo rev-parse --git-dir` succeeding
   means seeded. A failed seed removes the partial clone, so detection stays
   binary.
7. **Result type.** `RoundResult = { kind: "answer", text, sessionId,
   durationMs, numTurns, usage } | { kind: "agent-error", message, sessionId }
   | { kind: "timeout", seconds } | { kind: "failed", stage, exitCode,
   stderr }` where `stage ∈ seed | worktree | run | parse`. Discriminated so
   B1.3b maps each kind to a task state without string matching.
8. **Worktree removal.** Always attempted (`git worktree remove --force`, then
   `git worktree prune`), including after failures. B1.2 inserts the bundle
   back before removal.
9. **Command runner seam.** Every external call goes through one
   `run(argv, opts)` function; tests inject a recorder, so the unit suite
   needs no gateway.

## Open questions resolved for this slice

- *Who creates the sandbox and with which providers?* oskhs, via
  `maki-oss up`, with providers from `--provider` / `OSKHS_PROVIDERS`
  (comma-separated); B1.3d replaces this with per-project provider sync.
- *Model?* `--model`, else `OSKHS_MODEL`, else maki-oss's resolved default.
- *Concurrent rounds on one sandbox?* Not handled here; B1.3b adds caps.
  Worktree names are unique per task, so two rounds do not collide on disk.
- *Cancellation?* Out of scope (B1.3b). Recorded for it: the in-sandbox
  process can be found by its worktree path in `ps` args, since `pkill` is
  absent.

## Risks

- Seed uploads the whole history at once; fine for B1's small repos, B5 makes
  it resumable.
- The `--kill-after` grace is fixed at 10 s; Maki may lose an in-flight write.
  Acceptable: a timed-out round's worktree is discarded.
