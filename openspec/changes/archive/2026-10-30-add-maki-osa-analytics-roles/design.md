# Design

## Context

See `proposal.md` for motivation and the spec delta for the contract.

Conveyor's analytics flow already prepares a plain host folder under
`Runner:AnalyticsRoot`, checks manual edits by hash, optionally prepares a
read-only product-code worktree, and sends the folder contents back as
`AnalyticsFilesReady` after the run. The Maki OSA host already binds a retained
sandbox to any host directory, and the caller `sync-in` command keeps a git
baseline outside the workdir even when the host tree is not a git repository.

The missing pieces are the analytics role gate, the analytics mode gate, the
outbound file copy, and the product-code decision. No osa helper command or
sandbox policy change is required.

## Goals / Non-Goals

**Goals:**

- Run the four analytics roles in a retained `maki-osa` sandbox.
- Keep the host task folder authoritative for analytics content.
- Reuse the existing folder binding, `sync-in`, `run`, cancellation, and
  termination-confirmation path.
- Keep attachments and manual-edit detection intact.
- Keep the implementation in Conveyor; this change is the osa planning record
  and spec delta.

**Non-Goals:**

- Product-code access for analytics runs. A non-null `CodeWorkspace` is refused
  until a follow-up can copy it into the sandbox and rewrite the prompt path.
- `selfcheck` in the sandbox (M3).
- A synthetic git repository or worktree for the analytics folder.
- A new helper `sync-out` command.
- Changing the existing developer or read-only worktree roles.

## Decisions

### Reuse the existing directory binding without inventing git

`MakiOsaWorkspaceIdentity` already supports an ordinary directory: the
incarnation is derived from the directory, and the repo identity falls back to
a path-based value. `sync-in` already handles a non-git host tree by uploading a
snapshot with no `.git`, no history, and no bundle.

Alternatives rejected:

- **Synthetic git worktree on the host.** Adds state to a folder intentionally
  outside git, interferes with the folder-hash/manual-edit contract, and does
  not provide the file result Conveyor needs.
- **A separate analytics sandbox lifecycle.** Duplicates retention, idle stop,
  cancellation, and recovery for no benefit.

### Download to a temporary directory, then replace analytics files

`maki-oss download` copies the sandbox path to an explicit host destination but
does not prune destination files that are absent in the source. The host
analytics folder may also contain the `.conveyor` attachment service folder,
which must survive.

The sequence is therefore:

1. Download the sandbox workdir into a fresh temporary directory.
2. Read analytics files from the temporary directory with the existing
   `AnalyticsFolder.ReadAsync` filter (text extensions, size limit, no
   dot-prefixed paths).
3. Replace the analytics files in the host task folder: write returned files and
   delete analytics files absent from the download.
4. Delete the temporary directory on every exit path.

Alternatives rejected:

- **Download directly over the host task folder.** It cannot delete files the
  agent removed and can copy sandbox-only artifacts into the folder.
- **Use `collect-patch` and apply the patch.** The host folder is not a git
  repository; a patch is the wrong result shape for spec files.
- **Parse the patch into files.** More complex than the existing download and
  loses the helper's file-copy contract.

### Split analytics roles by write behavior

Two role groups are needed:

- `speceditor`, `contextcollector`: the agent may write analytics files, so the
  runner downloads and replaces the folder after success.
- `specanalyst`, `specreviewer`: the agent returns text; the runner skips the
  download and leaves the prepared folder.

The role gate requires a non-null analytics run spec. The existing read-only
worktree roles and `developer` remain on their current paths. `speceditor` and
`contextcollector` are not added to the worktree read-only set because they do
write files.

### Refuse product-code analytics before the helper starts

The analytics prompt uses the `{{conveyor:code-dir}}` placeholder, which
`RunnerWorker` currently replaces with a host worktree path. Maki runs inside the
sandbox, so that path is meaningless there. Maki OSA also does not pass
`--add-dir` and only syncs one workdir.

Passing the host path through would silently mislead the agent. The host
therefore rejects an analytics run with `CodeWorkspace != null` before `up`,
naming the unsupported product-code copy. A later change can upload the code
copy to a sandbox path and rewrite the prompt placeholder.

### Failure and cancellation rules

- The analytics sandbox may be created and synced even if the download later
  fails; the retained sandbox is not deleted.
- A failed download or replacement fails the run and leaves the host folder as
  prepared. `RunnerWorker`'s existing `finally` still sends
  `AnalyticsFilesReady` from that prepared folder, so the server does not see a
  half-replaced result.
- A stopped or timed-out run performs no download and no replacement.
- Termination confirmation remains mandatory before the folder is read back.

## Risks / Trade-offs

- **Download includes non-analytics files.** The existing `AnalyticsFolder`
  filter keeps only supported text files and excludes dot-prefixed paths;
  binary and oversized files stay in the sandbox. Mitigation: reuse the filter,
  do not raw-copy the download.
- **Stale files after replacement.** A failure between deleting and writing can
  leave a partial folder. Mitigation: replace after the download succeeds, and
  report the run failed; the next run's `PrepareAsync` restores the accepted
  version.
- **Analytics roles can write elsewhere in the sandbox.** The host boundary is
  unaffected because only filtered analytics files are copied back. This matches
  the accepted residual risk of the read-only roles change.
- **Analytics tasks with a product repo remain unsupported.** This is explicit
  and fails early rather than producing a bad prompt. Mitigation: a follow-up
  change for a read-only code copy.
- **No dedicated caller-mode `download` test exists.** Conveyor uses the
  existing helper command with the same caller environment as `sync-in` and
  `run`. Mitigation: assert the exact helper argv and destination in
  `MakiOsaRunnerTests` with a fake helper.

## Migration Plan

No migration. The mode remains opt-in per runner profile, and existing Claude
and Simulated analytics runs keep their behavior. Rollback is a runner-mode
change back to Claude or Simulated; retained Maki sandboxes are not deleted.

## Open Questions

- Should product-code analytics follow as a separate change using a read-only
  copy uploaded outside the workdir, or should it wait for a helper-level extra
  read-only directory?
