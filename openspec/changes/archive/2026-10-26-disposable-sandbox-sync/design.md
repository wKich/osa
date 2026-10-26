# Design

## Context

See `proposal.md` - Why. The current helper records a baseline and a host/sandbox tree pair, collects an exit patch, and keeps a single `pending` marker for every unresolved outcome (`lib/oss-core.sh:1032-1118`, `:1188-1253`, `:1300-1410`). The marker's `reason` is written but never read, the state directory is keyed only by sandbox name, and an existing sandbox is never re-uploaded. The new model treats the sandbox workspace as a cache of the host tree and the collected patch as the durable output.

Constraints: POSIX `sh`, no host bind mounts, `openshell sandbox upload` is the only way files enter the sandbox, uploads are `.gitignore`-filtered by default, the host `git` binary is optional, and the stub suite must run offline. OpenShell exposes a stable sandbox `Id` through `openshell sandbox get` and upload is copy-in rather than a mirror: <https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md>.

## Goals / Non-Goals

**Goals:**

- A session starts from the current host tree whenever the sandbox has no output that exists only in the sandbox.
- A collected patch is durable on the host and therefore does not freeze later sessions.
- A workspace with no durable copy is parked and is never overwritten.
- The user can tell from `maki-oss status` which of `clean`, `behind`, `retained`, or `parked` applies and what to run next.
- State from a deleted sandbox cannot block a new sandbox with the same name.
- Keep the container: Maki sessions, installed dependencies, and caches survive.

**Non-Goals:**

- Recreating the sandbox container for every session.
- A general rebase or auto-merge when the host moves during a session; the review branch stays.
- Concurrent sessions on one sandbox. This change documents the limitation; a lock or session-scoped refs are a follow-up.
- Syncing gitignored or generated files.
- A new `maki-oss sync` command. Existing commands gain the minimum resolution flags.
- New network endpoints, mounts, or secret paths.

## Decisions

### D1: The workspace is a cache; the patch is the durable output

A collected patch means the sandbox's output exists on the host, even if the patch has not been applied. The sandbox copy is then disposable. Only an outcome with no durable copy - collection failure or `--no-sync` - parks the workspace.

Alternatives: keep the current "any unresolved outcome blocks everything" rule. It is safe but unpredictable and causes the dead-marker failure in the proposal. Rejected.

### D2: Classify with the recorded tree pair, not one stale bit

The helper records `H0` (host tree at the last refresh/clean apply), `S0` (sandbox tree at the same point), and the current `H` and `S`. It derives:

| H vs H0 | S vs S0 | Durable patch? | State | Action |
|---|---|---|---|---|
| equal | equal | - | `clean` | run, no upload |
| changed | equal | - | `behind` | refresh from host |
| equal or changed | changed | yes, and the marker's result tree matches `S` | `retained` | refresh from host before the next session; keep patch |
| equal or changed | changed | no, or the sandbox changed after collection | `parked` | refuse; download or discard |

If there is no recorded pair (a sandbox created by `up` or an older helper), an empty helper-created workspace is treated as `behind`; a non-empty workspace with no state is treated as `parked` because the helper cannot prove those files are disposable. A migration for state written by an older helper is described below. A retained marker whose `result_tree` no longer matches `S` is an advisory notice: it does not change a `clean` or `behind` classification and does not force an upload.

Alternatives: compare `H` directly with `S`. Rejected because clean filters and submodules hash differently on each side; the recorded pair is what the existing code already uses.

### D3: Scope state to the OpenShell sandbox ID

`openshell sandbox get -o json` returns `Id`; the helper records it in `synced` and `baseline`. On mismatch, the state belongs to a previous instance: archive it under `sessions/<name>/archive-<timestamp>/` and start fresh. Missing IDs (state written by an older helper) are adopted when the recorded pair still matches; otherwise the normal classification runs and the ID is written on the next refresh.

Alternatives: make the state directory name include the sandbox ID. It fixes the same problem but churns every path and makes the name-based `download`/inspection commands less obvious. Rejected for this change.

### D4: Split `pending` into `retained` and `parked`

The existing marker gains fields rather than a second file:

```text
patch=...
sandbox=...
sandbox_id=...
created=...
reason=...
kind=retained|parked
result_tree=...
```

- `retained`: a patch file exists (possibly on a review branch) and its `result_tree` matches the sandbox tree it was collected from. It is informational and does not block sessions. `status` reports it; `upload` warns but proceeds.
- `parked`: no durable patch exists (collection failure, `--no-sync`, or unknown workspace edits), or the sandbox changed after the retained patch was collected. It blocks refresh, session start, and `rm` until the user downloads or explicitly discards.
- A marker without `kind` (old format) is `retained` when its patch path exists and is non-empty; otherwise `parked`. This is the safe inference and unblocks old markers that already have a patch.

A retained marker is cleared automatically when the patch is detected as already applied (best-effort `git apply --reverse --check`, or `patch -R --dry-run` without git). If the check is inconclusive, the marker remains as a reminder. It never blocks.

Alternatives: separate `retained`/`parked` files. Rejected because it doubles the state machine and complicates migration; one marker with a kind is enough.

### D5: Refresh is a mirrored copy-in, then a new baseline

The refresh routine:

1. Read the sandbox ID and phase; start the sandbox if needed through the existing ensure path.
2. Capture the host baseline with the existing clean/dirty/untracked logic.
3. Probe the sandbox baseline tree.
4. Load `synced`, `baseline`, and `pending`; handle an ID mismatch or a missing ID.
5. Classify. If `parked`, stop and print the recovery commands. If `clean`, skip the upload and record the session baseline. Otherwise refresh.
6. Otherwise compute the prune set: paths in the previous host tree that are absent from the current upload set. On a git host, use `git ls-tree` on `H0` and the current `git ls-files --cached --others --exclude-standard` set. For a plain directory, use a `manifest` written at the previous refresh. Remove only those paths inside the sandbox; skipped gitlinks and ignored sandbox artifacts are left alone.
7. Upload the host tree with `openshell sandbox upload` (default `.gitignore` filtering).
8. Re-run `SANDBOX_INIT_SCRIPT` to commit the refreshed workspace as the new sandbox baseline, then write `synced` with the sandbox ID and the new host/sandbox tree pair.

`maki-oss upload` uses the same routine for the project workspace. A subpath upload (`upload ./dist /sandbox/project/dist`) remains plain copy-in and re-records the sandbox baseline without pruning, because the host does not describe the injected content.

Alternatives: delete `/sandbox/project` and re-upload. Simpler, but it destroys ignored caches (`node_modules`, `.venv`) that make reuse useful. Rejected. Another alternative is an OpenShell mirror flag; the CLI has none.

### D6: Retained workspaces always refresh before the next session

Even when the host tree is unchanged, a `retained` workspace is refreshed before Maki launches. The agent therefore never starts on output the host has not accepted; the retained patch stays on the host for review. If a prior refresh already cleared the retained result, the workspace is `clean` or `behind`; the retained patch is only an advisory notice and does not force an upload. When the host already contains the retained change (`git apply --reverse --check`), the notice is cleared and the patch file is kept; the sandbox base advances if its tree already matches the host, otherwise the next refresh realigns it. On apply success the baseline advances and the marker is cleared. On apply failure the patch is retained and the sandbox baseline is not advanced; the next refresh re-initializes it from the host.

Alternatives: let a session continue on the retained result. It would make the exit patch relative to an unaccepted tree and blur what the agent sees. Rejected.

### D7: Resolution stays in the existing commands

- `upload` refuses `parked`; `upload --discard` explicitly discards parked output and refreshes. It warns on `retained` and keeps the patch.
- `rm` refuses `parked`; `rm --discard` explicitly deletes the sandbox and its unique output. On any delete, archive the state directory rather than deleting patch history.
- `status` reads the state and reports the next command.
- `--no-sync` writes a `parked` marker with no patch and prints the `download` and `--discard` commands.
- `up` stays create/start-only; its next-step hint changes from `upload` to a normal session, which refreshes.

Alternatives: a new `sync` subcommand. It is the cleaner long-term surface, but this change can resolve the current failure without adding a command family; a future change can consolidate.

### D8: Migration

- Old `baseline`/`synced` files without `sandbox_id`: adopt the current ID when the recorded host/sandbox pair still matches; otherwise classify from the trees and record the ID on the next refresh.
- Old `pending` without `kind`: retained if the patch file exists and is non-empty, parked otherwise.
- Old state whose sandbox ID no longer matches: archive it on the first session after the upgrade.
- Patch files are never deleted by migration; archive and recovery paths remain readable.

### D9: Non-goals that stay visible

- Concurrent sessions share the baseline and can still produce overlapping patches. The design keeps the idle watcher behavior unchanged and adds a docs note; the fix is a follow-up lock or session-scoped refs.
- A host that moves during a session keeps the current review-branch path. The next session refreshes from the new host and leaves the retained patch for review.
- Paths containing tabs or newlines keep the existing no-git manifest limitation (`lib/oss-core.sh:872-875`).

## Risks / Trade-offs

- **Pruning can remove the wrong file** -> prune only paths present in the previous host tree and absent from the current upload set; never touch ignored or unknown paths. Cover it with a stub test for a tracked deletion and a preserved `node_modules`.
- **Sandbox ID may change on stop/start** -> verify with the real gateway in the live pass; if it does, use the gateway's creation identity instead of treating every ID change as a new instance.
- **A synthetic baseline tree may be garbage-collected** -> write a `manifest` at every refresh and fall back to it for pruning.
- **`git apply --reverse --check` can mis-detect an applied patch** -> treat it as best-effort; a false positive only clears an advisory retained marker, never host data.
- **Full upload on every host change is slow for large projects** -> skip when the pair matches; keep `.gitignore` filtering; document that dependency directories must stay ignored. No incremental upload in this change.
- **Retained patches accumulate** -> `status` shows them and `rm` archives them; a future cleanup command can prune them.
- **State is only as durable as `~/.local/state`** -> retained patches are the durable copy; `download` remains the escape hatch. Document the state path in the recovery output.
- **Submodules and symlinks** -> skip gitlinks in the prune set and document the limitation; the existing patch path already handles their tree hashes conservatively.

## Migration Plan

Ship the additive state fields and inference rules in one release. Existing retained patches become non-blocking on the first session; existing collection-failure markers stay parked. `status` reports the classified state immediately. Rollback is safe: old code reads the same `pending` file and treats it as blocking, and ignores the new fields; no patch is deleted. The operator steps are in `docs/helper.md` under "Migration, rollback, and concurrency".

## Open Questions

- Should concurrent sessions be rejected with a lock, or given session-scoped refs? Defer to a follow-up; this change documents the current limitation.
- Should `up` eventually refresh too? Defer; the session refresh already makes `up` followed by a session coherent.
- Should host-moved patches auto-3way onto the new host? Defer; the review branch remains the safety surface.
