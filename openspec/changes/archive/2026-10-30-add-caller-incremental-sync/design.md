# Design

## Decisions

### Opt-in flag, full sync stays default

`sync-in --incremental` is explicit. Existing callers and existing sandboxes keep the current clear-and-upload behavior; a caller can recover from any suspected residue with a full sync. This avoids changing the meaning of a command that already backs Conveyor's baseline and patch boundary.

### Host-authoritative mirror with an ignored-artifact exception

The host-filtered file set is the source of truth. The manifest records each path with type, mode, size, and a content hash. The algorithm is:

1. Build the current host manifest with the same `.gitignore` filtering as `sandbox upload`.
2. Read the previous manifest from the sandbox state directory.
3. Upload paths that are new or whose hash/mode changed.
4. Delete paths that were in the previous manifest and are absent from the current host manifest, even if the current filter now ignores them.
5. Delete non-ignored workdir paths that are in neither manifest.
6. Leave paths the filter ignores untouched, so package caches and build outputs survive. This applies only to paths that were never in a host manifest; a previously synced path that became ignored was host content and is still deleted.
7. Re-run the history setup so the helper-created `.git` file points outside the workdir; never treat it as an agent leftover.
8. Record the current manifest and rebuild the `collect-patch` baseline from the current host-filtered tree.

Deleting only host-filtered paths is what keeps a reviewer or agent from smuggling a non-ignored file into the next pass, while ignored artifacts remain reusable. Ignored artifacts are not in the baseline or the patch.

### Manifest and protocol location

The manifest lives in the sandbox caller state directory next to the existing baseline/repository (`/sandbox/<helper-state>/caller/...`), never under the host state root and never in the workdir. Its path is `<caller-key>-manifest`, with `<caller-key>-manifest.dirty` as the in-progress marker.

Schema version 1 is line-oriented and tab-separated:

1. Header: `osa-caller-manifest<TAB>1<TAB><filter><TAB><history>`, where filter is
   `gitignore` (a git worktree, default upload) or `all` (`--no-git-ignore`, or
   a tree the helper treats as non-git, matching the upload filter) and history
   is `git` or `none`.
2. One record per host-filtered path: `<mode><TAB><size><TAB><content-hash><TAB><type><TAB><path>`.
   The hash is the git object hash of the file or symlink target; type and mode
   preserve symlinks and executable bits.
3. Completion marker: `complete<TAB>1`.

The manifest holds only paths, modes, sizes, and content hashes. It carries no
prompts, environment values, credentials, or host state. Paths with tabs or
newlines inherit the existing line-oriented limitation. The helper writes the
host manifest to a temp file, uploads it to the sandbox, and treats the old
manifest as valid only when the header matches, the completion marker is
present, and no dirty marker exists. The new manifest replaces the old only
after uploads, deletions, history setup, and the baseline commit succeed; a
failed sync leaves the old manifest plus the dirty marker, so the next run
falls back to full.

Transfer uses `openshell sandbox upload` for a staged set of changed files (and
a manifest plus a sandbox-side delete list). The staging tree is produced from
the same temporary git index used to build the manifest with
`git checkout-index --prefix`, then uploaded into the workdir. It does not use
host bind mounts or a tar stream on the 4 MiB exec stdin. The staging tree is
temporary and deleted on every exit path. Stub-backed tests cover a path with
spaces, a symlink whose target changes, a binary file, and a deleted file.
[OpenShell sandbox file transfer](https://docs.nvidia.com/openshell/v0.1.5/how-it-works/sandboxes/overview.md)
confirms uploads stream into the sandbox and supports large trees without the
exec stdin limit.

### Fallback and failure modes

The full path is used when: the manifest is missing or unreadable; its schema version differs; the host filter mode changes; the previous sync did not complete; the sandbox workdir has a `.git` or helper marker that does not match; or the caller asks for a reset. A failed incremental sync writes no baseline, so `collect-patch` refuses and the next sync falls back.

### The full sync records a manifest

Decision: a successful full sync also records a manifest. The upload contents,
the baseline, the JSON output, and both exit codes are unchanged; the extra
manifest is internal sandbox state beside the baseline. This lets a developer
pass after a read-only full sync stay incremental, and it avoids a second full
transfer in rework loops. Building the manifest costs one host scan, which is
much cheaper than re-uploading an unchanged tree. If manifest building or
upload fails, the full sync still succeeds with a warning and the next
incremental sync takes the full path again.

### Conveyor selects incremental only for developer rework

Conveyor records `LastSyncSucceededAt` on the workspace binding after every
successful sync. It passes `--incremental` only when all of these hold: the role
is developer, the binding already existed, the previous sync succeeded, the
sandbox was not recreated, and the binding was not blocked before reconciliation.
Read-only and analytical roles, first creation, configuration mismatch, blocked
recovery, and the explicit reset (`Runner:MakiIncrementalSync=false`) stay on
the full path. If the helper itself falls back, the runner does not need a second
call: the helper returns the full-sync result under the same argv contract.

### Read-only roles do not use incremental sync

M2 allows read-only roles to keep their changes in the sandbox and never apply them. Incremental sync would preserve ignored reviewer artifacts and could preserve non-ignored files if a deletion step fails. Until a separate isolation decision, Conveyor SHALL use full sync for read-only roles (or an ephemeral review sandbox) and may use incremental sync only for developer rework in the same worktree.

### Alternatives considered

- **Host bind mount**: forbidden by the repository's security invariant and would make the host directly writable.
- **Keep the workdir with no deletion**: cheap, but stale host files and agent leftovers survive; `collect-patch` would report changes the host does not have.
- **Preserve all sandbox files**: breaks host authority and can carry reviewer/agent leftovers into the next pass.
- **Incremental upload in `maki-oss run`**: the lifecycle already separates `sync-in`; adding transport behavior to `run` would hide the baseline change and make failures harder to name.
- **Git-based fetch/reset**: the host worktree can be dirty and untracked; syncing the filtered files is simpler and already defines the baseline.

## Risks / Trade-offs

- Manifest hashing costs one host scan per sync; it should be much cheaper than uploading unchanged files on a large worktree. The manifest and deletion pass must explicitly account for the helper-created `.git` file and paths that move between host-filtered and ignored.
- Ignored artifacts may include large or stale caches and secrets created inside the sandbox; the mode is per-worktree and opt-in, and a full sync clears them.
- Same-uid agent can tamper with the manifest or baseline; this is operational separation, not an access-control boundary. The host remains authoritative for what is uploaded and patched.
- Conveyor must choose full vs incremental by role and lifecycle state; getting this wrong could preserve review residue. Keep the default full and gate incremental behind explicit evidence.
