# Tasks

## 1. Sync state model

- [x] 1.1 Add `sandbox_id` to the `baseline` and `synced` state, parse it from `openshell sandbox get -o json` with a table fallback, and verify a stub test that a session records the ID and `status` reads it back
- [x] 1.2 Extend the `pending` marker with `kind`, `sandbox_id`, and `result_tree`, infer old markers (patch file present -> retained, otherwise parked), and verify stub tests for both old formats
- [x] 1.3 Implement the `clean` / `behind` / `retained` / `parked` classifier and verify stub tests for all four states plus a sandbox-ID mismatch
- [x] 1.4 Archive instance state on an ID mismatch and on `rm`, and verify a recreated sandbox does not inherit a parked marker (assert the archive path and a clean first session)

## 2. Workspace refresh

- [x] 2.1 Implement the prepare routine (capture host baseline, probe sandbox tree, classify, skip/refresh/refuse) and wire it into the session ensure before Maki; verify a changed host uploads on reuse and an unchanged host does not
- [x] 2.2 Implement the tracked-deletion prune set and sandbox-side removal, with a manifest fallback for plain directories, and verify a deleted tracked file is absent while `node_modules` survives
- [x] 2.3 Re-initialize the sandbox baseline and write the new `synced` pair after a refresh; verify the next unchanged session skips the upload and the baseline records the new trees
- [x] 2.4 Make `upload` use the refresh routine for the workspace, keep subpath copy-in, add `--discard`, and guard a parked workspace; verify stub tests for refusal, explicit discard, and subpath no-prune
- [x] 2.5 Update the reuse/refresh messages and the `up` next-step hint; verify the stderr assertions in the stub suite

## 3. Exit sync and retention

- [x] 3.1 Split exit outcomes: a clean apply clears state, an apply failure or conflict writes retained, and a collection failure or `--no-sync` writes parked; verify a stub test for each
- [x] 3.2 Implement retained auto-clear when the patch is already applied (reverse check) and verify a test where applying the patch then starting a session clears the marker
- [x] 3.3 Ensure a retained workspace refreshes before the next session even when the host tree is unchanged; verify the stub test shows Maki is not launched on the retained tree
- [x] 3.4 Ensure a parked workspace blocks session start, upload, and `rm`, and prints the download/`--discard` commands; verify stub tests for all three refusals

## 4. Lifecycle and status

- [x] 4.1 Extend `status` with the sync state and next command; verify stub output for `clean`, `behind`, `retained`, and `parked`
- [x] 4.2 Add the parked guard and `--discard` to `rm`; verify refusal without `--discard` and deletion with it, including the state archive
- [x] 4.3 Keep `up` create/start-only; verify the stub test records no upload and the updated next-step hint

## 5. Migration and compatibility

- [x] 5.1 Verify the old-state migration with a pre-change session directory (missing `sandbox_id` and `kind`): a marker with a patch becomes retained and non-blocking, and one without a patch stays parked
- [x] 5.2 Verify no code path deletes retained patch files on refresh, discard, or `rm`; assert the patch file exists after each resolution path
- [x] 5.3 Document rollback in the design/docs and verify old code still sees a blocking marker (inspect the state file written by the new code)

## 6. Documentation

- [x] 6.1 Update `docs/helper.md` (safe session sync, upload/status/rm, state table, migration, concurrency limitation) and verify every command in the section appears in `maki-oss help`
- [x] 6.2 Update `docs/ai/host-playbook.md`, `docs/setup-guide.md`, and `README.md` where they say upload happens only on create; verify no stale claim remains with `grep`
- [x] 6.3 Update `docs/verification.md` and record the live pass in `docs/verification-log.md`; verify the commands and expected outputs are present
- [x] 6.4 Add `clean` / `behind` / `retained` / `parked` to `docs/glossary.md`; verify each term is defined once and linked from `docs/helper.md`

## 7. Verification

- [x] 7.1 Run `make test` and verify the full stub suite passes, including the new sync cases
- [x] 7.2 Run `make lint` and `openspec validate disposable-sandbox-sync --strict`; verify both pass
- [x] 7.3 Live pass against the real gateway: fresh create, host-changed refresh, tracked deletion, retained conflict, collection-failure park, `--no-sync` park, recreated sandbox, `status`, and the `rm` guard; record the commands and observed output in `docs/verification-log.md`
- [x] 7.4 Verify `git diff --stat` is limited to the expected paths and no new endpoint, mount, or secret path was added
