# Spec Delta

## ADDED Requirements

### Requirement: Incremental caller sync reuses unchanged workdir files

`sync-in HOST_TREE --incremental` SHALL keep the existing workdir and make every host-filtered path match HOST_TREE without clearing the whole workdir. The helper SHALL compute the same `.gitignore`-filtered file set as the default upload, compare it with a versioned manifest from the previous incremental sync, upload changed and new files, and remove host-filtered files that were in the previous manifest but are absent now. Unchanged files SHALL NOT be uploaded again.

Files in the workdir that the upload filter ignores SHALL be preserved, except a path that was in the previous host manifest: such a path SHALL be removed when the current host-filtered set no longer contains it. Files that are neither in the current host manifest nor in the previous manifest and are not ignored by the filter SHALL be removed as agent leftovers. The helper-created `.git` file and the helper state paths SHALL be maintained by the history setup and SHALL NOT be treated as agent leftovers.

The helper SHALL record the new host manifest and the baseline only after the file operations succeed. It SHALL NOT create a host bind mount and SHALL NOT write the manifest under the host state root.

#### Scenario: Unchanged file is not uploaded

- **WHEN** a file is identical in HOST_TREE and the previous incremental sync
- **THEN** the incremental sync leaves it in the workdir and does not transfer it again

#### Scenario: Changed and new files are uploaded

- **WHEN** HOST_TREE has a modified tracked file and a new untracked file
- **THEN** the workdir receives their current content and the manifest records them

#### Scenario: Host deletion is applied

- **WHEN** a file was in the previous host manifest and is absent from HOST_TREE
- **THEN** the incremental sync removes it from the workdir

#### Scenario: Ignored artifact survives a rework pass

- **WHEN** a previous run created an ignored build output inside the workdir and HOST_TREE still has the same host-filtered files
- **THEN** the incremental sync preserves the build output

#### Scenario: Agent leftover is removed

- **WHEN** an earlier run created a non-ignored file in the workdir that is absent from both the previous and current host manifests
- **THEN** the incremental sync removes it

#### Scenario: Helper git file survives

- **WHEN** HOST_TREE is a git worktree and an incremental sync runs
- **THEN** the helper-created `.git` file remains valid and points outside the workdir; it is not removed as an agent leftover

#### Scenario: Baseline follows the host tree

- **WHEN** an incremental sync succeeds after a host edit
- **THEN** `collect-patch` returns only changes made after that sync, and ignored workdir artifacts do not appear in the patch

### Requirement: Incremental sync falls back safely

The helper SHALL use a full clear-and-upload sync when the incremental manifest is absent, unreadable, from an incompatible version, or when the previous sync did not finish. A failed incremental sync SHALL leave no new baseline and SHALL cause the next `sync-in` to use the full path. The full path SHALL remain the default when `--incremental` is not given.

#### Scenario: Missing manifest

- **WHEN** no previous manifest exists for the workdir
- **THEN** `sync-in --incremental` performs a full sync, records a manifest, and succeeds

#### Scenario: Interrupted sync

- **WHEN** an incremental sync fails before recording its manifest and baseline
- **THEN** the next `sync-in --incremental` performs a full sync instead of trusting the old manifest

#### Scenario: Default stays full

- **WHEN** a caller runs `sync-in HOST_TREE` without the incremental flag
- **THEN** the helper clears and uploads the workdir exactly as before
