# Proposal

## Why

The Projects view (M1) shows retained patches and parked workspaces but can only point at the terminal to resolve them. `add-sync-resolve-commands` adds `osa resolve`, one checked command for every resolution. This change puts it behind buttons, which makes the dashboard write to the host for the first time: into project working trees, git refs, and the state root. That needs its own guard rules and a rewritten threat model, not just new buttons.

## What Changes

- Add **resolve actions** to the Projects view and the patch viewer:
  - for a retained patch: **Apply to working tree**, **Commit on a branch**, **Drop**;
  - for a parked workspace: **Rescue a copy**, **Discard sandbox changes**.
- Add `POST /api/projects/:sandbox/resolve` with body `{ "action": … }`. It runs `osa resolve <sandbox> <action> --json` (with `--yes` for `drop` and `discard`) and nothing else. It uses the mutation guard every other write uses: session token in `X-Dashboard-Token`, and 403 in read-only mode.
- **Drop** and **Discard** require typing the sandbox name, like sandbox delete. **Apply** shows which files the patch touches before it runs.
- Show the outcome on the row: what changed (files, branch name, rescue folder), "nothing changed" for a refusal, or the error text. Refresh the row's badges right away instead of waiting for the next poll.
- Disable the actions while the project is busy (a live session or resolve), and show why.
- **Rewrite the README threat model** for host writes: what the dashboard can now change, the guards, and what read-only mode still guarantees.

Out of scope: deleting a registered sandbox through `rm --discard` from the Projects view, merging or cherry-picking a branch, and editing a patch before applying it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboard`: RENAMED and MODIFIED "Project data stays read-only" → "Project writes go through osa resolve" (the only host writes are `osa resolve` runs, behind the mutation guard; everything else stays read-only). MODIFIED "Read-only patch viewer" (it gains the retained-patch actions; the patch text itself stays read-only). ADDED "Sync resolve actions".

## Impact

- `dashboard/src/projects.ts`: argv allowlist gains `resolve <sandbox> <action> --json [--yes]`; a `resolve()` service method; host-change cache invalidation for that path.
- `dashboard/src/server.ts`: `POST /api/projects/:sandbox/resolve` behind `guardMutation`; every other project route stays GET-only.
- `dashboard/src/app/projects.js`, `dashboard/src/app/patch.js`: action buttons, typed confirmations, touched-file preview, outcome display, busy state.
- `dashboard/test/stub/osa`, `projects.test.ts`, `server.test.ts`, `scripts/browser-check.ts`: resolve fixtures and one resolve journey.
- `dashboard/README.md`: API table and the threat model rewrite.
- Depends on `add-sync-resolve-commands` (the `osa resolve` command, its JSON shape and exit codes, and `busy` in quick status). It must land second.
- No new network endpoints, bind mounts, or secret paths.
