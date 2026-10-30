# Proposal

## Why

Sandbox reuse currently preserves only the container, provider attachment, Maki config, and conversations. Every `sync-in` empties the workdir and uploads the full host tree, so unchanged files, downloaded dependencies, and build outputs inside the workdir are discarded on every pass. Large worktrees pay that transfer cost again, and rework/review loops cannot reuse a warm build tree.

This change adds an opt-in, host-authoritative incremental mode for caller sync so unchanged worktree files stay in the sandbox while the host tree remains the source of truth.

## What Changes

- Add an explicit incremental mode to caller `sync-in` (working name `--incremental`); the current command remains the default and keeps its full clear-and-upload behavior.
- Keep a versioned manifest of the host-filtered tree in the sandbox state directory. On each incremental sync, upload changed and new files, delete files that were in the previous host manifest but are absent now, and leave unchanged files in place.
- Preserve files under the workdir that the upload filter ignores (for example `node_modules/`, `bin/`, `.cache/`) so build artifacts can be reused. Delete non-ignored files created by an earlier agent that are absent from both manifests.
- Refresh the `collect-patch` baseline against the current host-filtered tree; ignored sandbox artifacts remain outside the baseline and the patch.
- Fall back to a full sync when the manifest is missing, malformed, from another helper version, or when the previous sync did not complete. A failed incremental sync SHALL leave no new baseline and SHALL force a full sync next time.
- Keep read-only roles on full sync (or an explicit reset) until a separate isolation decision, so reviewer leftovers cannot be preserved as ignored artifacts.
- Make Conveyor opt in only after live evidence; the default `maki-osa` path remains full sync until then.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `caller-workspace-sync`: add incremental caller sync with host-authoritative deletion, ignored-artifact preservation, manifest fallback, and unchanged `collect-patch` semantics.

## Impact

- osa: `bin/maki-oss` / `lib/oss-core.sh` caller sync path, helper tests, `docs/helper.md`, and the `caller-workspace-sync` spec.
- Conveyor: optional `sync-in --incremental` argument and a per-role decision; no change to its patch/apply contract.
- Security invariants unchanged: no host bind mounts, no secrets in uploads or manifests, sandbox remains the boundary. The existing same-uid limitation on the baseline and helper state remains; manifests are operational metadata, not an access-control boundary.
- Existing sandboxes and callers keep the current full behavior until they pass the new flag.
