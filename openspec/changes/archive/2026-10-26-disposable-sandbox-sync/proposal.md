# Proposal

## Why

`maki-oss` uploads the project only when it creates a sandbox, then treats a reused sandbox as a peer that may hold unique work. As a result, a session can run on an older tree, the "stale" message recommends an upload even when the sandbox has unpulled changes, and a marker from a sandbox that no longer exists can freeze the first session in a brand-new one. The sandbox workspace should be a disposable replica of the host; the collected patch is the durable output.

## What Changes

- Define the sandbox **workspace** as disposable: the container (Maki sessions, installed dependencies, caches) survives, but the tracked project tree is refreshed from the host at session start when it is safe.
- Split the unresolved sync state into two observable states:
  - **retained**: a patch exists on the host; it does not freeze future sessions.
  - **parked**: there is no durable patch (collection failed or `--no-sync`); the workspace must not be overwritten until the user resolves or discards it.
- On reuse, refresh from the host when the host tree changed since the last sync and the sandbox has no uncollected output. Refresh a `retained` workspace before the next session even when the host is unchanged, and skip the upload when the workspace already matches the host. Announce the refresh.
- Never upload over parked output. `maki-oss upload` becomes the explicit refresh and refuses when parked; `maki-oss rm` refuses or warns when parked; recreating a sandbox clears or archives state from the dead instance.
- Scope sync state to the OpenShell sandbox ID, not just the sandbox name.
- Make a refresh mirror tracked deletions from the host while preserving gitignored sandbox-local artifacts (OpenShell upload is copy-in only).
- `maki-oss status` reports `clean`, `behind`, `retained`, or `parked` and names the next command.
- `--no-sync` parks the workspace instead of leaving an unmarked stale tree.
- `maki-oss up` remains create/start-only; the following session performs the safe refresh, so the pair is coherent.
- Update the helper docs, the verification checklist, and the stub tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `helper-cli`: sandbox lifecycle (`status`, `rm`; `up` stays create/start-only), project transfer (`upload` refresh and mirror semantics), one-command session refresh, session sync-back (`--no-sync` parks), baseline/freshness classification, and fail-closed recovery (retained vs parked).

## Impact

- `lib/oss-core.sh`: workspace refresh and classification, state scoping, upload/rm/status behavior, and exit sync.
- `bin/maki-oss`: help and usage text for the changed `up` and `status` behavior.
- `tests/run-tests.sh` and `tests/stub/openshell`: cases for safe refresh, retained vs parked, instance-scoped state, tracked-file pruning, `--no-sync` parking, `status`, and the `rm` guard.
- `docs/helper.md`, `docs/ai/host-playbook.md`, and `docs/verification.md`: describe the disposable workspace and the new resolution commands; `docs/verification-log.md` records the live pass.
- The in-flight `add-opencode-oss-helper` change shares `lib/oss-core.sh` and inherits this behavior; its own artifacts are not edited here.
- No new network endpoints, no host bind mounts, and no secrets cross the sandbox boundary. All project transfer still uses `openshell sandbox upload` / `download`; the upload remains `.gitignore`-filtered by default.

Upstream behavior this depends on:

- OpenShell sandbox upload is copy-in and `.gitignore`-filtered by default, and `sandbox get` exposes a stable sandbox ID: <https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md>.
