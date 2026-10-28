# Proposal

## Why

The dashboard can delete a sandbox, but it cannot remove a project. Its sandbox Delete calls `openshell sandbox delete` only, so the project's registry entry (`projects/<sandbox>.toml`) and session directory stay behind, and the Projects view keeps a "not on gateway" row forever (seen with `cc-osa-cb62`). The only command that cleans these up is the front-end's `rm`, and it refuses a sandbox the gateway no longer lists. No command removes the entry once the sandbox is gone, and the spec says orphans are never deleted automatically. Users have to delete files under the state root by hand.

## What Changes

- Add **`osa remove SANDBOX --yes [--json]`**. It removes one registered project: it deletes the sandbox on the gateway when the gateway still lists it, archives `sessions/<sandbox>/` the same way `rm` does, and deletes the registry entry. A sandbox the gateway no longer lists, and an orphan whose folder is gone, can be removed too. It refuses, changing nothing:
  - while a retained patch or a parked workspace is pending (the user resolves it first with `osa resolve`);
  - while a session or resolve holds the sandbox;
  - without `--yes`;
  - when the gateway cannot be listed.

  Its JSON result has the same shape as `osa resolve`'s, and so do its exit codes.
- Each front-end (`maki-oss`, `opencode-oss`, `claude-oss`, `codex-oss`) gains an internal `__remove` verb that `osa remove` runs. The gateway delete uses that front-end's own gateway configuration.
- **Relax the osa invariant.** "No `osa` command deletes a sandbox" becomes "only `osa remove` deletes a sandbox".
- Add a **Remove** action to every row of the dashboard's Projects view. It requires typing the sandbox name. It says whether the sandbox will be deleted on the gateway or only forgotten. It is disabled, with the reason shown, while work is pending or a session is running. It runs exactly one `osa remove SANDBOX --yes --json` through a new token-guarded `POST /api/projects/:sandbox/remove` route, refused in read-only mode. The row disappears and the inventory refreshes after a successful removal.
- Document the command in `docs/helper.md` and the route and action in `dashboard/README.md`.

Out of scope:
- Changing the inventory's sandbox Delete, which still only deletes the sandbox on the gateway.
- Removing a project that has pending work.
- Deleting the archived session directory.
- Bulk removal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `osa-project-layer`: ADDED "osa removes a project". MODIFIED "osa entry point" (adds `remove` and makes it the only command that may delete a sandbox), "Project registry" (`osa remove` also removes an entry, orphans included), and "Session and resolve exclusion" (a remove holds the same lock as a resolve).
- `dashboard`: ADDED "Project removal". MODIFIED "Project writes go through osa resolve" (also allows `osa remove SANDBOX --yes --json`, and adds the remove route as a second POST-only project route).

## Impact

- `bin/osa`: `remove` command, usage text, argument parsing.
- `lib/oss-core.sh`: `__remove` verb. It reuses `sandbox_phase`, `pending_kind`, the resolve lock, `archive_state_dir`, and `registry_remove`.
- `lib/osa-state.sh`: unchanged. The state contract version stays `"1"` because no key changes.
- `dashboard/src/projects.ts`, `dashboard/src/server.ts`, `dashboard/src/app/projects.js`: the remove argv, the route, and the row action.
- `dashboard/test/` (stub `osa`, `projects.test.ts`, `server.test.ts`) and `tests/` for the shell side; `dashboard/scripts/browser-check.ts`: one remove journey.
- `docs/helper.md`, `dashboard/README.md`.
- No new network endpoints, bind mounts, or secret paths. The only gateway call added is `openshell sandbox delete`, which the front-ends' `rm` already makes ([OpenShell CLI](https://github.com/NVIDIA/OpenShell)).
