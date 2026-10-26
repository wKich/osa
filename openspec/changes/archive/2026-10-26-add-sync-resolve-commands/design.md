# Design

## Context

See proposal.md - Why. What exists today:

- **Exit sync** (`lib/oss-core.sh`): `sync_project_back` collects `patch-<stamp>.patch`, then `apply_sandbox_patch` routes to `worktree_apply` (git: apply in a temp worktree at the recorded base, fast-forward only a clean, unmoved host, else keep branch `<program>/<sandbox>-<id>` and worktree) or `plain_apply` (`git apply --check` then `git apply`, or `patch` without git; binary patches without git go to `export_review_files`). Each failure path writes `pending` (`kind = "retained"` or `"parked"`) and prints `recovery_block`.
- **Parked resolution** exists as `upload --discard` (removes the marker, keeps patches) and `rm --discard`. `download` copies files out but never clears the marker.
- **`osa`** is read-only (M0 D1). Full status already dispatches to the owning front-end through the internal `__status-json` command, run in the project folder with `--name <sandbox>`.
- **Concurrency**: none. Two sessions for one sandbox are "not coordinated" (`docs/helper.md`). The idle-stop stamp exists only when idle stop is on, so it cannot serve as a liveness signal.

## Goals / Non-Goals

**Goals:**

- One implementation of each action, in the core, reachable from the terminal and the dashboard.
- Each action either fully succeeds or leaves the project, the marker, and git refs as they were.
- Non-interactive: `osa resolve` never prompts, so a browser-driven call cannot hang.

**Non-Goals:**

- Coordinating two sessions with each other. They stay as uncoordinated as today; only session vs. resolve is excluded.
- Cleaning up review branches or worktrees kept by earlier exit syncs.
- A `--force` that applies a patch whose dry run fails.

## Decisions

### D1: `osa resolve` validates, the front-end acts

`osa` parses `resolve SANDBOX ACTION [--yes] [--json]`, finds `projects/<SANDBOX>.toml` by scanning the registry (the URL-style name is never joined into a path before it matches a registry file name), refuses an orphan, and runs `(cd "$host_path" && <front-end> --name "$SANDBOX" __resolve ACTION [--yes] [--json])`. The front-end loads its own config, resolves the session directory, checks the pending kind, takes the lock, and acts. The tag-to-front-end map stays the one `bin/osa` already has for `__status-json`.

Alternatives: implementing the actions in `bin/osa` itself. `osa` deliberately sources only `lib/osa-state.sh`; the apply code depends on the front-end's config, program name, and the core's baseline readers. Pulling the core into `osa` would make it a fourth front-end. Rejected.

### D2: `apply` is dry-run-then-apply on the working tree, never a commit

1. Reverse check first: if `git apply --reverse --check` (or `patch -R --dry-run`) succeeds, the patch is already in the host; clear the marker, change nothing.
2. With git (repository or not, since `git apply` works outside one): `git apply --check PATCH`, then `git apply PATCH`. No `--index`, no `--3way`: `--3way` can leave conflict markers in files, which breaks "succeeds or changes nothing". `git apply` is atomic per invocation.
3. Without git: text patches use `patch -p1 --dry-run` then `patch -p1`; a binary patch is refused with a pointer to `branch` on a machine with git, or to `maki-oss download`.

The core's `plain_apply` already does steps 2-3 but writes `pending` on failure. Its check-and-apply part is split into a side-effect-free helper that both the exit path and `__resolve` call; the exit path keeps writing `pending` itself.

Alternatives: reuse `worktree_apply`'s fast-forward. It only works while the host is on the recorded commit with no changes, which is the case where exit sync would already have applied, so it would almost never succeed for a retained patch. Rejected.

### D3: `branch` commits on the recorded base in a throwaway worktree

The base is `bl_base` from the session's `baseline` file: the recorded commit for a clean baseline, or the synthetic snapshot commit (tree = the dirty working tree at upload, parent = `HEAD`) for a dirty one. The synthetic commit is in the host's object database because exit sync and upload created it there; if `git cat-file -e` fails (garbage-collected), `branch` is refused and suggests `apply`. The worktree is created under the session directory's `worktrees/`, the patch applied with `git apply`, falling back to `--3way` (conflicts are allowed to fail here, since the worktree is discarded), the result committed with the same `osa` author identity exit sync uses, `git branch osa/<sandbox>-<YYYYmmddHHMMSS> <commit>` created, and the worktree removed. On any failure the worktree and any created branch are removed. `HEAD`, the index, and the working tree of the main checkout are never touched, which the tests check by comparing `git status --porcelain=v1 -z` and `git rev-parse HEAD` before and after.

Alternatives: `git commit-tree` on a tree built with `git apply --cached` against a temporary index file. It avoids a worktree, but the three-way fallback needs a worktree anyway. Rejected for one code path.

### D4: `drop` moves, never deletes

`drop --yes` moves the patch to `sessions/<sandbox>/dropped/<file>` and removes the marker. `rm` archives the whole session directory later, so dropped patches end up in the archive like retained ones. Recovery is a `git apply` of the moved file.

### D5: `rescue` downloads into the session directory

`rescue` runs `openshell sandbox download <sandbox> <workdir> <session-dir>/rescue-<stamp>/`. If the sandbox is not `Ready`, it is started first, as `download` does through the front-end's existing `require_sandbox` path, and the output says so. The marker stays `parked`: a rescue copy is a backup, and the user still decides between `discard` and a later session. Rescue copies count against the session directory and move into the archive on `rm`.

### D6: `discard` is `upload --discard`

`__resolve discard --yes` calls the existing `cmd_upload` path with `opt_discard=1` and no paths, so it inherits the baseline and `synced` recording and the "existing patch files are kept" rule. No new upload code.

### D7: Session/resolve exclusion with a two-sided lock

Files under `sessions/<sandbox>/locks/` (internal, not contract):

- A session writes `session.<pid>` before its ensure step and removes it in the exit trap after sync, then checks for `resolve.d`; if `resolve.d` exists and its `pid` file names a live process, it removes its own file and refuses.
- A resolve creates `resolve.d` with `mkdir` (atomic), writes `pid` in it, then checks every `session.*` file; if any names a live process, it removes `resolve.d` and refuses. It removes `resolve.d` on exit.
- Liveness is `kill -0 <pid>`. A dead holder's file is removed by whoever finds it.

Each side announces itself before checking the other, so at least one of two concurrent starters sees the other. Sessions never check each other, which keeps today's behavior for two sessions. `osa status --quick` reports `busy` when any live holder exists.

Alternatives: one exclusive lock for sessions too. It would change today's "two sessions are allowed" behavior as a side effect. Rejected. `flock(1)`: not available on stock macOS. Rejected.

### D8: Output and exit codes

Without `--json`, `osa resolve` prints what it did and the next useful command, like other `osa` commands. With `--json` it prints exactly one object `{ "sandbox", "action", "ok", "changed": [..], "message" }` on stdout; the front-end's notes go to stderr. Exit codes: `0` success, `1` usage error, `2` refused before any change (wrong kind, orphan, missing `--yes`, busy, dry run failed), `3` failed during the action after cleanup. The dashboard maps `2` to "nothing changed" and `3` to an error that includes stderr.

## Risks / Trade-offs

- [`apply` writes into a dirty working tree] → Only after a clean dry run against the current tree, with no `--3way`; touched files keep any edits outside the patch's hunks. `branch` is the option that never touches the working tree, and the error for a failed dry run says so.
- [PID reuse makes a dead lock look live] → The refusal names the PID and the lock path; deleting `locks/` is documented as the manual override. A false "busy" refuses safely.
- [A session started by an older helper takes no lock] → Only this repository's front-ends exist and they upgrade together; noted in `docs/helper.md`.
- [Dirty-baseline branches include the user's then-uncommitted work in their parent] → Documented in the `branch` output: the branch's base is a snapshot commit, so `git cherry-pick <branch>` is the way to take only the agent's change.
- [Rescue copies fill the disk] → They live in the session directory, are listed by path in the output, and are archived with the session on `rm`.

## Migration Plan

None for data. Existing retained and parked markers are resolvable as soon as the change lands. Rollback: revert; markers written before or after stay valid for the previous helper.
