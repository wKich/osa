# Design

## Context

After B1.1b a round syncs refs into `/sandbox/repo` (bare), adds a detached
worktree, runs Maki, and removes the worktree together with every local
branch no other worktree has checked out.

## Explore findings (measured 2026-10-23)

1. `openshell sandbox download <name> <file> <dir>/` writes `<dir>/<file
   basename>`; a non-existent destination path renames the file.
2. The sandbox repository has no `user.name`/`user.email`: `git commit` in a
   worktree fails with "Author identity unknown". Maki's own commits would
   fail the same way.
3. Worktree removal already deletes local branches no remaining worktree
   holds (B1.1b decision 9), so `task-<id>` must be bundled before removal.

## Decisions

1. **Branch per task.** `git worktree add -b task-<id> <path>
   refs/remotes/origin/<base>`. If `task-<id>` exists (a re-run of the same
   task id), it is reset (`-B`): a task's branch is defined by its latest
   round.
2. **The result is the worktree's final HEAD.** The agent may commit, switch
   branches, or detach. After an `answer`, oskhs runs `git add -A` and, if
   anything is staged, commits it on the current HEAD with the message
   `oskhs: uncommitted changes from task <id>`; then `git update-ref
   refs/heads/task-<id> HEAD`. Rounds that did not answer collect nothing.
3. **Identity.** Repository config `user.name = Maki (oskhs)`,
   `user.email = maki@oskhs.invalid`, set on every sync (finding 2). B1.4
   decides the identity kiss's MRs need.
4. **No changes.** `git rev-list --count <base-tip>..task-<id>` = 0 and an
   equal tree means `changes: null`; nothing is bundled.
5. **Prerequisites are host-known.** The bundle's `--not` list is the host
   object ids of the refs this round synced (passed in from the sync, not
   read back from the sandbox), so the host always has every prerequisite
   even if the agent moved `origin/*` refs during the round.
6. **Untrusted bundle.** The bundle is downloaded into a fresh temp dir,
   checked with `git bundle verify` against the host repo and
   `git bundle list-heads` (exactly `refs/heads/task-<id>`), then fetched
   with `-c fetch.fsckObjects=true` and the single refspec
   `+refs/heads/task-<id>:refs/heads/oskhs/<task-id>`. Anything else is a
   `collect` failure; the host repo is unchanged.
7. **Host ref name.** `refs/heads/oskhs/<task-id>`: namespaced so it never
   collides with a user branch in the B1.1/B1.2 local clone. B1.4 pushes it
   under kiss's naming.
8. **Statistics.** `changes = { branch, head, base, commits, files:
   { added, modified, deleted, renamed } , bundleBytes }`, computed host-side
   with `git diff --name-status -M base..head`.

## Open questions resolved for this slice

- *Partial work on timeout?* Discarded for now: only an `answer` round is
  collected. B2's session continuity revisits this.
- *File size limits on the way back?* None yet; B4 (LFS) owns large files.
- *Should Maki be told to commit?* No: auto-commit covers both cases, and
  telling the agent is kiss's prompt shape (B1.3c/B1.4).
