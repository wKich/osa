# Design

## Context

See proposal.md - Why. Pieces in place:

- **Dashboard (M1).** `ProjectService` in `src/projects.ts` reads the registry, caches quick status per `host_path` for 60 s, and spawns `osa` only through `isAllowedOsaArgv` (today: `status PATH --json`, `status PATH --quick --json`). `src/server.ts` routes `/api/projects…` through `handleProjects`, which refuses every non-GET with 405; mutations elsewhere use `guardMutation` (token header plus read-only 403). The patch viewer (`src/app/patch.js`) fetches `/api/projects/:sandbox/patch` with the token.
- **`osa resolve`** (from `add-sync-resolve-commands`): `osa resolve SANDBOX ACTION [--yes] --json` prints one `{ sandbox, action, ok, changed, message }` object; exit `0` success, `2` refused with nothing changed, `3` failed after cleanup. It never prompts. Quick status reports `busy`.

## Goals / Non-Goals

**Goals:**

- The browser can trigger only the five `osa resolve` actions, for registered sandboxes, through the existing mutation guard.
- A user sees the patch before Apply or Branch can be pressed.

**Non-Goals:**

- Undo. Drop and Rescue are recoverable by design in `osa`; Apply and Branch are undone with git.
- Server-side confirmation state. Typed confirmation is a UI guard, as for sandbox delete; the token is the security guard.

## Decisions

### D1: One POST route, a fixed argv per action

`POST /api/projects/:sandbox/resolve` with JSON `{ "action": "apply" | "branch" | "drop" | "rescue" | "discard" }`. The server checks, in order: `guardMutation` (403), body parses and action is in the set (400), `:sandbox` matches a registry entry (404), no resolve already running for that sandbox (409). Then it spawns `osa resolve <sandbox> <action> --json`, adding `--yes` for `drop` and `discard`. `isAllowedOsaArgv` gains exactly that shape and stays the single gate. The response is `osa`'s JSON object plus `exitCode`; HTTP status is 200 for exit 0, 409 for exit 2 (refused, nothing changed), and 502 for exit 3 or unparsable output, with stderr in `detail`.

`--yes` is passed by the server, not the client: the typed confirmation is the user's "yes", and the client never controls argv.

Alternatives: one route per action. Five near-identical routes for one argv difference. Rejected.

### D2: In-flight guard per sandbox

A `Set<string>` of sandboxes with a running resolve. A second request for the same sandbox gets 409 before spawning. This is a courtesy for double clicks; `osa`'s own lock (exit 2 with "busy") is what protects against sessions and other terminals. Timeout: 120 s for `rescue` (a download), 60 s for the rest, reported as a `timeout` error.

### D3: Retained actions live in the patch viewer; parked actions on the row

A retained row gets a **Review patch** button only; Apply, Branch, and Drop are in the patch viewer, under the diff, so the patch is on screen before any of them is pressed. Parked rows get **Rescue** and **Discard** directly, since there is no patch to read. Orphans and clean rows get nothing.

The "files the patch touches" list for Apply is parsed client-side from the patch text already loaded: `diff --git a/<path> b/<path>` headers, falling back to `+++ b/<path>`. When the patch was truncated at 2 MiB, the list is marked incomplete and Apply's confirmation says so.

### D4: Outcome and refresh

The outcome renders on the row (and in the viewer when the action ran there) through `h()`: `changed` entries as a list of text items, `message` as text. After any response, the client calls `GET /api/projects?refresh=1` restricted to that path, so the badge reflects the new marker at once. To support that, the list route gains an optional `path=` filter for refresh, and the server drops the cache entry for that `host_path` after every resolve, so the next quick status runs fresh.

### D5: Busy state comes from quick status

The row disables its actions while the last quick status says `busy: true`, showing "a session is running". Quick status may be up to 60 s old, so the button can be enabled while a session just started; `osa` then refuses with exit 2 and the row shows the refusal. No extra polling.

### D6: Threat model rewrite

The README section is rewritten around three assets: the gateway (unchanged), host project trees and git refs (new), and the state root (new). The new write paths are listed with their guards: token header, read-only 403, fixed argv, registry-only sandbox names, `osa`'s dry-run and lock checks. It states what read-only mode guarantees (no host writes at all) and what a holder of the token can now do (the five actions, nothing else on the host). DNS rebinding and cross-site POST are covered by the existing token header rule; the section says so explicitly for the new route.

## Risks / Trade-offs

- [A token leak now allows host writes] → The writes are limited to five checked actions, Apply only after a clean dry run and Drop/Discard recoverable or backed by an explicit confirmation. `--read-only` removes them entirely; the README recommends it for any shared or non-loopback use.
- [Stale busy state] → `osa`'s lock is authoritative (D5).
- [Apply into a working tree the user is editing in an IDE] → The confirmation lists the files; `osa` refuses if the dry run fails. Editors reload changed files; nothing is overwritten outside the patch's hunks.
- [Rescue copies grow silently] → The outcome shows the folder path and its location in the session directory.

## Migration Plan

Lands after `add-sync-resolve-commands`. Rollback: revert; the dashboard returns to M1 read-only behavior and nothing on disk depends on it.
