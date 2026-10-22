# Design

## Context

B1.1a's `seedIfNeeded` fetches one bundle of every local branch and tag into
a bare repository at `/sandbox/repo` (refs under `refs/remotes/origin/*`)
and is skipped once the repository exists. This change keeps the layout and
makes the transfer incremental and per round.

## Explore findings (measured 2026-10-23, git 2.x host and sandbox)

1. In a worktree of a bare repository with no `remote.origin.*` config,
   `git checkout feature` fails (`pathspec 'feature' did not match`) even
   though `refs/remotes/origin/feature` exists. With
   `remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*` and any URL, the
   DWIM works: `branch 'feature' set up to track 'origin/feature'`.
2. With that URL set to a dead local name, `git fetch` and `git pull` fail
   with "does not appear to be a git repository … and the repository
   exists" — no network attempt.
3. `git bundle create … main --not <main's own tip>` fails: `Refusing to
   create empty bundle.` A ref whose new tip is already in the sandbox (a
   rewind to an ancestor) cannot travel by bundle.
4. A bundle whose prerequisite the receiver lacks fails the fetch with
   `Repository lacks these prerequisite commits` and exit 1, leaving refs
   unchanged.

## Decisions

1. **Tips come from the sandbox, per ref.** Before each sync oskhs lists
   `refs/remotes/origin/*` and `refs/tags/*` inside the sandbox. The roadmap
   says "records"; reading them where they live is the same per-ref
   bookkeeping without a second copy that can drift (a restarted oskhs, two
   oskhs hosts, a sandbox recreated by hand all stay correct).
2. **The sandbox is untrusted input.** A tip read from the sandbox is used as
   a `--not` prerequisite only if the host has that commit (`git cat-file
   --batch-check`); an agent-moved or invented tip can only make the next
   bundle larger. If the fetch still fails (finding 4: objects missing), oskhs
   retries once with no prerequisites and reports `full: true`.
3. **Ref mapping.** Host `refs/heads/<b>` → sandbox
   `refs/remotes/origin/<b>`; host `refs/tags/<t>` → sandbox `refs/tags/<t>`.
   Fetch uses `+` refspecs, so a ref the agent moved is force-reset. oskhs
   owns these two namespaces in the sandbox; `refs/heads/*` belongs to tasks
   (B1.2 takes back `task-<id>`).
4. **Policy.** `wanted` = base + `--branch` names (each must exist on the
   host, else a `sync` usage failure), or with `--all-branches` every host
   branch and tag. Only wanted refs whose sandbox tip differs are bundled.
5. **Pruning.** Any sandbox `refs/remotes/origin/<b>` whose host branch no
   longer exists, and (in `--all-branches` mode) any sandbox tag the host
   lacks, is deleted with `git update-ref -d`. A branch that exists upstream
   but is not wanted this round is left alone.
6. **Rewinds.** A wanted ref whose new tip the sandbox already has (finding
   3) is moved with `git update-ref <ref> <sha>` after checking the object
   exists there (`git cat-file -e`); otherwise it goes into the bundle with
   no prerequisites.
7. **Offline origin.** The sandbox repository's `remote.origin.url` is
   `oskhs-offline` (a relative path that never exists) and its fetch refspec
   is the standard one (findings 1–2). This replaces B1.1a's "no remote URL"
   requirement; there is still no network endpoint.
8. **Upload hygiene.** Bundles go to `/sandbox/.oskhs/in/<task-id>.bundle` and
   are deleted after the fetch whether it succeeded or not.
9. **No stale local branches.** Found live (evidence, 2.2): the agent's
   `git checkout feature` DWIM created `refs/heads/feature`, which outlives
   the worktree; once upstream moves, the next task's `git checkout feature`
   would silently get the old copy. Worktree removal therefore also deletes
   every `refs/heads/*` that no remaining worktree has checked out. A branch
   another live task has checked out is kept; one it created and then left
   is not (its commits stay reachable from that worktree's HEAD). B1.2 takes
   `task-<id>` back before the worktree is removed.
10. **Statistics.** `SyncStats = { bundleBytes, updated[], pruned[],
   prerequisites, full }`; `runRound` returns `{ result, sync }` and the CLI
   prints `sync` next to the result.

## Open questions resolved for this slice

- *Should tags travel per task?* No: only in `--all-branches` mode, where the
  agent is meant to explore. A per-task round sees branches only.
- *Concurrent syncs into one sandbox?* git's ref locks make concurrent
  fetches of different refs safe; the same ref racing is last-writer-wins
  with identical content. Caps arrive in B1.3b.
- *Garbage collection in the sandbox?* Out of scope; `git gc` there is
  harmless to the protocol because tips are re-read each time.

## Risks

- A sandbox with a very large ref count makes the tip listing slower; one
  exec per sync, acceptable for B1.
