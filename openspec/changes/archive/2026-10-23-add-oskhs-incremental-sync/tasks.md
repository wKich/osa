# Tasks

## 1. Sync

- [x] 1.1 `oskhs/src/sync.ts`: init the bare repository with the offline
      origin; list sandbox tips; list host refs; compute wanted, changed,
      prune, and rewind sets as a pure function; verify unit tests for each
      set, including an untrusted tip and an unwanted branch
- [x] 1.2 Bundle + upload + fetch with prerequisites, the one retry without
      them, rewinds by `update-ref`, prune by `update-ref -d`, bundle deletion
      in both outcomes; verify with the recording runner
- [x] 1.3 Replace `seedIfNeeded` in `round.ts`; `runRound` returns
      `{ result, sync }`; CLI gains `--branch` (repeatable) and
      `--all-branches` and prints `sync`; verify `make test-oskhs` and
      `bunx tsc --noEmit -p oskhs`

## 2. Live exit

- [x] 2.1 Grow the fixture with a deterministic ~300 KB data file; recreate
      `repo-fx`; run two rounds with one host commit in between; verify the
      second `bundleBytes` is a small fraction of the first and record both
      in `evidence/sync-live.md`
- [x] 2.2 Run a round with `--branch feature` asking the agent to
      `git checkout feature` and read `notes.txt`; verify the answer
- [x] 2.3 Delete `feature` on the host, run a round; verify `pruned`
      lists it and `refs/remotes/origin/feature` is gone in the sandbox
- [x] 2.4 Move `refs/remotes/origin/main` in the sandbox to a commit made
      only in the sandbox (an agent-style commit), run a round; verify it
      succeeds and the ref is reset to the host tip
- [x] 2.5 Verify `git fetch` in a worktree fails without network access

## 3. Docs

- [x] 3.1 Update `docs/oskhs.md` (sync, policy, what the agent sees, stats)
      and mark B1.1b done in `docs/roadmap.md`; verify
      `scripts/check-links.sh docs/oskhs.md docs/roadmap.md` and
      `openspec validate add-oskhs-incremental-sync --strict`
