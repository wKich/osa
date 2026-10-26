# Proposal

## Why

M1 (`dashboard-project-view`) shows which projects have a retained patch or a parked workspace, but resolving one still means reading a recovery block and typing `git apply`, `git cherry-pick`, `maki-oss download`, or `maki-oss upload --discard` by hand in the right folder. The dashboard cannot offer those actions without reimplementing the exit-sync safety checks, which is exactly the project logic the M0 plan keeps out of the UI. M2 needs one agent-neutral command that resolves pending work with the same checks the session exit uses, so the dashboard (`dashboard-sync-actions`) and the terminal share one code path.

## What Changes

- Add **`osa resolve SANDBOX ACTION`**, the first `osa` command that writes. It looks up the registry entry, refuses an orphan, and hands the action to the owning front-end through an internal command, so the logic stays in `lib/oss-core.sh` and works for every agent (`mk`, `oc`, `cc`, and later tags).
- Retained patch actions:
  - `apply`: apply the patch to the host working tree only after `git apply --check` (or `patch --dry-run` without git) passes; never commit, never move `HEAD`. An already-applied patch just clears the marker.
  - `branch`: commit the patch on a new branch at the session's recorded base commit, through a temporary worktree, without touching the working tree, the index, or `HEAD`.
  - `drop`: clear the marker and move the patch to `dropped/` in the session directory, so it can still be recovered.
- Parked workspace actions:
  - `rescue`: download the sandbox workspace into a new folder under the session directory (`rescue-<stamp>/`). The workspace stays parked.
  - `discard`: the same as `upload --discard`: replace the parked output with the host tree and clear the marker.
- `drop` and `discard` require `--yes`. Every action supports `--json` and reports what it changed.
- Add a **per-sandbox lock** shared by sessions and `resolve`, so a resolve never runs while a session for that sandbox is live, and a session never starts while a resolve runs. `osa status --quick --json` reports `busy` from it.
- Update `docs/helper.md` (the recovery block now names `osa resolve`), `fish/completions/osa.fish`, and the glossary.

Out of scope: dashboard buttons (`dashboard-sync-actions`), deleting a sandbox from `osa` (`maki-oss rm --discard` stays the way to delete a parked one), re-collecting a parked workspace into a patch, and merging a kept review branch into the host branch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `osa-project-layer`: MODIFIED "osa entry point is read-only" (it becomes "osa entry point" and allows `resolve` as the only writing command). ADDED "osa resolves retained patches", "osa resolves parked workspaces", and "Session and resolve exclusion". MODIFIED "osa status reports a project across agents" (quick JSON gains `busy`).
- `helper-cli`: MODIFIED "Fail-closed recovery" (the recovery block names the `osa resolve` command for the pending kind, and the retained patch can be dropped as well as applied).

## Impact

- `bin/osa`: `resolve` parsing, registry lookup, front-end dispatch, `busy` in quick status.
- `lib/oss-core.sh`: an internal `__resolve` command, reusing `plain_apply`'s checks and `worktree_apply`'s worktree code; the session lock taken in the session path and in `__resolve`; recovery block text.
- `lib/osa-state.sh`: lock helpers (internal file, not part of the contract).
- `bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`: route `__resolve` (and `bin/codex-oss` when `add-codex-oss` lands first).
- `tests/run-tests.sh`, `tests/stub/openshell`: resolve actions, refusals, lock behavior across front-ends.
- `docs/helper.md`, `docs/glossary.md`, `fish/completions/osa.fish`.
- No new network endpoints, bind mounts, or secret paths. Host writes are limited to the project working tree (`apply`), the project's git refs and objects (`branch`), and the session directory (`drop`, `rescue`, `discard`).
- Overlaps `add-codex-oss`, which also edits `bin/osa` and the `osa-project-layer` spec; whichever lands second rebases its delta.
