# Tasks

Implementation target: osa helper (`bin/maki-oss`, `lib/oss-core.sh`) and then Conveyor (`/Users/ki/Projects/kontur/conveyor.ai`). Implemented; measurements and live results are in `evidence.md`.

## 1. Contract and spike

- [x] 1.1 Measure the current full `sync-in` on a representative large worktree (file count, bytes, wall time) and a warm build tree. Record the numbers in this change before choosing defaults; do not add a host bind mount.
- [x] 1.2 Define the manifest schema and state path: schema version, path, type, mode, size, content hash, filter mode, completion marker. Verify it contains no prompts or secrets and lives outside the workdir and outside the host state root.
- [x] 1.3 Decide how changed files are staged and moved into the workdir with `openshell sandbox upload` plus a sandbox-side delete list. Verify a path with spaces, a symlink, a binary file, and a deleted file round-trip.
- [x] 1.4 Decide whether the full sync records a manifest (so a developer pass after a read-only full sync can be incremental) without changing the full path's observable behavior. Record the decision in the design.

## 2. Helper implementation

- [x] 2.1 Add `sync-in --incremental` parsing and keep the current full path unchanged. Verify the default path still runs the existing clear script and the new flag is a usage error in managed mode. (`tests/run-tests.sh`)
- [x] 2.2 Implement host manifest generation with the existing upload filter. Verify ignored files are absent from the manifest and uncommitted/untracked-not-ignored files are present.
- [x] 2.3 Implement changed/new upload, host deletion, non-ignored leftover deletion, ignored-artifact preservation, and preservation/recreation of the helper-created `.git` file. Verify each case with a fake `openshell` that records every upload and sandbox command.
- [x] 2.4 Rebuild the baseline from the current host-filtered tree and record the manifest only after success. Verify `collect-patch` returns only post-sync changes and excludes ignored artifacts.
- [x] 2.5 Implement fallback on missing, malformed, version-mismatched, or interrupted manifest. Verify the full path runs and a failed incremental sync leaves no baseline. (`tests/run-tests.sh`)
- [x] 2.6 Update `docs/helper.md` and the caller `sync-in` help text with the new flag, preservation/deletion rules, fallback, and the same-uid limitation.

## 3. Live verification

- [x] 3.1 On a live OpenShell gateway, run two developer passes in one worktree with an unchanged large subtree, a changed file, a deleted file, an untracked file, and an ignored build artifact. Verify the second transfer is smaller, the workdir matches the host, the artifact survives, and `collect-patch` contains only the current run's changes.
- [x] 3.2 Interrupt an incremental sync (kill the helper or the upload) and run again. Verify the next sync falls back to full, the workdir is consistent, and no duplicate patch is applied.
- [x] 3.3 Run a read-only role with a full sync after an incremental developer pass, then a developer pass again. Verify reviewer leftovers are gone and the artifact policy is unchanged.

## 4. Conveyor integration

- [x] 4.1 Pass `--incremental` only for developer rework in an existing binding and after a successful prior sync; use full sync on first create, configuration change, blocked recovery, read-only roles, and explicit reset. Verify the argv and fallback with `MakiOsaRunnerTests`.
- [x] 4.2 Run the full Conveyor suite and a live rework loop; record transfer and wall-clock deltas in Conveyor's `docs/progress.md` and the Maki E2E document.
- [x] 4.3 Update this change's evidence and validate with `openspec validate add-caller-incremental-sync --strict` before archive.
