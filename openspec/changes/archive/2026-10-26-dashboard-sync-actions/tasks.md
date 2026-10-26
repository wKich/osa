# Tasks

## 1. Prerequisite

- [x] 1.1 Confirm `add-sync-resolve-commands` is applied: `osa resolve` exists, prints the JSON object, uses exit codes 0/1/2/3, and quick status reports `busy`. Verify with `bin/osa help` listing `resolve` and `make test` passing.

## 2. Stub and service

- [x] 2.1 Extend `dashboard/test/stub/osa` to answer `resolve SANDBOX ACTION --json [--yes]` from the fixture (success with `changed`, refusal with exit 2, failure with exit 3, invalid JSON, a slow mode), log argv, and report `busy` in quick status when the fixture says so. Verify with a stub self-test in `projects.test.ts`.
- [x] 2.2 Widen `isAllowedOsaArgv` to `resolve <sandbox> <action> --json` plus `--yes` only for `drop` and `discard` (design D1). Verify with tests that accept the five shapes and reject `resolve x rm --json`, `--yes` on `apply`, a leading-dash sandbox, and extra arguments.
- [x] 2.3 Add `ProjectService.resolve(sandbox, action)`: registry lookup (404), in-flight set (409), argv per D1, timeouts per D2, exit-code-to-status mapping, and cache invalidation for the entry's `host_path`. Verify with tests for each status code and that a resolve drops the cached quick status so the next list spawns a fresh one.

## 3. Route and guard

- [x] 3.1 Add `POST /api/projects/:sandbox/resolve` behind `guardMutation`, and keep 405 for non-GET on every other project route. Verify with `server.test.ts` cases: no token (403, stub log empty), read-only with token (403, stub log empty), unknown action (400), unregistered sandbox (404), success (200 with `changed`), refusal (409), failure (502 with `detail`), POST to list/status/patch (405).
- [x] 3.2 Add the `path=` filter to `GET /api/projects` for a single-path refresh (design D4). Verify with a test that `?refresh=1&path=<p>` spawns quick status only for that path.
- [x] 3.3 Update the read-only invariant test: browsing and GET routes still change nothing; a resolve changes only what the stub reports. Verify with `bun test`.

## 4. UI

- [x] 4.1 In `src/app/projects.js`, give retained rows a Review patch button, parked rows Rescue and Discard (Discard behind a typed sandbox name), orphans and clean rows no actions, and disable actions with "a session is running" when `busy`; hide all actions in read-only mode. Verify with the browser journey in 5.1.
- [x] 4.2 In `src/app/patch.js`, add Apply, Branch, and Drop under the diff outside read-only mode; Apply lists touched files parsed from `diff --git` / `+++ b/` headers (marked incomplete when truncated) before sending; Drop needs the typed name. Verify with the browser journey in 5.1.
- [x] 4.3 Render outcomes (changed list, "nothing changed" with osa's message, error text) through `h()` and trigger the single-path refresh after every response. Verify with the browser journey in 5.1.

## 5. Browser journey and docs

- [x] 5.1 Add one resolve journey to `scripts/browser-check.ts` against the fixture and stub: Review patch → Apply lists files → confirm → outcome shows files and the `retained` badge clears; a refusing Apply shows "nothing changed"; Drop without the typed name sends nothing (stub log); Rescue shows the folder and the row stays `parked`; a busy row has disabled actions; read-only mode shows no actions in the row or the viewer; an outcome message containing `<img src=x onerror=alert(1)>` renders as text. Verify with `bun run scripts/browser-check.ts` passing.
- [x] 5.2 Update `dashboard/README.md`: the API table entry for the resolve route, the Projects view actions, and the threat model rewrite (design D6). Verify with `make lint-docs` passing.
- [x] 5.3 Run `cd dashboard && bun test`, `bun run scripts/browser-check.ts`, and `openspec validate dashboard-sync-actions --strict`, then on this host resolve one real parked or retained project from the browser and record it in `docs/verification-log.md`. Verify all pass and the log entry exists.
