# Proposal

## Why

M0 (`add-oss-project-layer`, archived 2026-10-26) put every front-end's projects into one state root and published a versioned TOML contract for them, but nothing visual reads it yet. The dashboard still shows only gateway sandboxes. It cannot tell which folder a sandbox belongs to, which agent runs there, or that a session left a retained patch or a parked workspace waiting on the host. M1 is the first web UI on top of the contract. It is read-only, so it adds no new host writes and no new trust decisions before M2.

## What Changes

- Add a **Projects view** to the dashboard. It lists every registry entry across agents (`mk`, `oc`, `cc`, and any later tag) with project, host path, agent, sandbox name, and whether that sandbox exists on the gateway. Each row links to the existing sandbox detail view.
- Show **sync badges** on each row: the pending kind (`retained`, `parked`) and orphan state from the contract files, and the host change since the last sync (`changed`, `unchanged`, `unknown`) from `osa status --quick --json`. A per-project full check (`osa status --json`) shows the authoritative sync state (`clean`, `behind`, `retained`, `parked`) and the next command the front-end suggests.
- Show an **attention counter** in the page header: the number of projects with a retained patch, a parked workspace, or a missing folder.
- Add a **read-only patch viewer** for a retained patch: the diff text with added and removed lines marked. It has no apply, branch, or drop controls (those come in M2). The patch route requires the session token, because a patch carries host source code.
- **Split `app.js` into ES modules** served from a fixed allowlist, so later milestones add views without growing one 900-line file. Behavior of the existing views does not change.
- Update the dashboard spec's **Purpose** to cover projects alongside sandboxes, and add a paragraph to the README threat model about patch contents.
- Extend the offline test fixtures (a state root fixture and a stub `osa`) and add one `browser-check.ts` journey for the Projects view.

Out of scope: any write to the state root or to a host project, resolving pending work (M2), egress and health panels (M3), setup (M4), and new `osa` commands. The dashboard reads the contract files and calls the existing `osa` read commands only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboard`: ADDED "Project list", "Project sync badges", "Attention counter", "Read-only patch viewer", and "Project data stays read-only". The Purpose line is updated to name projects (Purpose is not a requirement, so it is edited when the spec is synced).

## Impact

- `dashboard/src/projects.ts` (new): reads `projects/*.toml` and each session's `pending` marker with `Bun.TOML.parse`, and runs `osa` for computed values.
- `dashboard/src/server.ts`: `GET /api/projects`, `GET /api/projects/:sandbox/status`, `GET /api/projects/:sandbox/patch`, and static serving of the module allowlist.
- `dashboard/src/page.ts`: module entry script, Projects/Sandboxes navigation, attention counter slot.
- `dashboard/src/app.js` → `dashboard/src/app/*.js` (ES modules).
- `dashboard/src/main.ts`, `dashboard/README.md`: the `DASHBOARD_OSA_BIN` setting, the Projects view, and the threat model note.
- `dashboard/test/`: a state-root fixture, `test/stub/osa`, `projects.test.ts`, server route tests; `dashboard/scripts/browser-check.ts`: one Projects journey.
- `openspec/specs/dashboard/spec.md`: Purpose and new requirements on sync.
- No new network endpoints, host bind mounts, sandbox calls, or secret paths. The dashboard reads files under `$XDG_STATE_HOME/osa/` that the user already owns, and never writes them.

Upstream behavior this depends on: none beyond M0's contract (`openspec/specs/osa-project-layer/spec.md`) and Bun's built-in TOML parser (<https://bun.sh/docs/runtime/bun-apis>).
