# Proposal

## Why

Roadmap slice B1.1b. B1.1a seeds a warm repo sandbox once and never updates
it: a commit pushed after the seed is invisible to every later round, and the
only way to refresh is to delete the sandbox and upload the full history
again — not viable for repos of tens of GB over a home uplink. Rounds also
need the branches their task works on (for `GitLabMRTaskSource`, the MR
source branch), not only the branch the host happens to have checked out.

## What Changes

- Replace the one-shot seed with a **sync before every round**: oskhs reads
  the sandbox's tip per delivered ref, bundles only what the sandbox lacks
  (`git bundle create … <refs> --not <tips>`), uploads and fetches it with a
  force refspec, and prunes refs whose branch no longer exists upstream with
  `git update-ref -d`. A fresh sandbox is just the case with no tips (full
  history of the requested refs).
- **Bundle policy.** Per round, required: the base branch plus the task's
  own branches (`--branch`, repeatable). Optional per project: every branch
  and tag (`--all-branches`).
- **What the agent sees.** The sandbox repository gets a remote `origin`
  whose URL is a dead local name and whose fetch refspec maps
  `refs/heads/*` to `refs/remotes/origin/*`, so `git checkout <branch>` of a
  delivered branch works in a task worktree while `git fetch`/`pull` fail.
- Sync statistics (bundle bytes, refs updated, refs pruned, prerequisite
  count, whether it fell back to a full bundle) are part of every round's
  output, so the delta is measured, not assumed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `oskhs-round`: seeding becomes per-round incremental sync with a bundle
  policy, ref pruning, and an offline `origin` remote.

## Impact

- Changed: `oskhs/src/{seed,round,cli}.ts` (sync replaces seed),
  `oskhs/test/*`, `oskhs/test/make-fixture.sh` (a larger data file so
  full-vs-delta is measurable), `docs/oskhs.md`, `docs/roadmap.md`.
- Upstream behavior relied on: `git bundle create … --not`, bundle
  prerequisites on fetch (https://git-scm.com/docs/git-bundle), git's
  checkout DWIM for remote-tracking branches
  (https://git-scm.com/docs/git-checkout).
