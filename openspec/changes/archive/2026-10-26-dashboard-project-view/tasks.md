# Tasks

## 1. Baseline

- [x] 1.1 Record the current state: `cd dashboard && bun test` and `bun run scripts/browser-check.ts` both pass (or the browser check skips for want of Chrome; note which). Verify by pasting the pass counts into the apply notes; every later group must keep them passing.

## 2. Split app.js into ES modules (no behavior change)

- [x] 2.1 Move `src/app.js` into `src/app/` as `main.js`, `state.js`, `dom.js`, `api.js`, `banner.js`, `inventory.js`, `detail.js`, `logs.js`, `policy.js`, and `rules.js`, with views importing `state.js` rather than `main.js` (design D6). Delete `src/app.js`. Verify that `src/app.js` is gone, `grep -l "from \"./main.js\"" src/app/*.js` prints nothing, and the page loads with no console errors in the browser check run in 2.4.
- [x] 2.2 In `src/server.ts`, build the module allowlist at startup from `src/app/` names matching `^[a-z-]+\.js$`, serve them at `/app/<name>` with `JS_HEADERS`, and 404 everything else under `/app/`, including `/app.js`, `/app/../server.ts`, and `/app/%2e%2e%2fserver.ts`. In `src/page.ts`, load `<script type="module" src="/app/main.js">`. Verify with new `server.test.ts` cases for an allowed module, each refused path, and the page referencing `/app/main.js`.
- [x] 2.3 Update the existing no-HTML-sink test to check every served module, not only `app.js`. Verify by temporarily adding `innerHTML` to one module and seeing the test fail, then removing it.
- [x] 2.4 Verify the split as a pure move: `bun test` passes and `bun run scripts/browser-check.ts` passes with no edits to its existing journeys.

## 3. Contract reader

- [x] 3.1 Add a state-root fixture builder under `dashboard/test/` that writes, into a temp `XDG_STATE_HOME`, registry entries for `mk`, `oc`, `cc`, and an unknown tag `zz`; a retained marker with a patch file; a parked marker; a marker without `kind`; an orphan (missing `host_path`); a `host_path` containing spaces and quotes; an invalid TOML file; and a `version = "2"` entry. Verify with a self-check test that the fixture's files parse (or fail) as intended.
- [x] 3.2 Add `src/projects.ts`: resolve the state root (`$XDG_STATE_HOME/osa`, else `$HOME/.local/state/osa`), list registry entries with `Bun.TOML.parse`, read each `pending` marker, set `orphan` from `stat`, and report parse failures and unsupported versions as noted rows (design D1, D8). Verify with `projects.test.ts` cases for every fixture row and for a missing registry directory returning an empty list.
- [x] 3.3 Add a conformance test that runs the real `../bin/osa projects --json` against the same fixture and asserts the dashboard reader returns the same `agent`, `host_path`, `project`, `sandbox_name`, `pending`, and `orphan` for every v1 entry with a `kind`. Verify with `bun test` (the test skips with a message when `/bin/sh` or `awk` is missing).

## 4. osa runner and caching

- [x] 4.1 Add `test/stub/osa`: it answers `status PATH --quick --json` and `status PATH --json` from a JSON fixture keyed by path, logs each argv line to a file named by an env var, and can be told to fail, hang, or print invalid JSON. Verify with a stub self-test in `projects.test.ts`.
- [x] 4.2 Add the `osa` runner in `src/projects.ts`: binary from `DASHBOARD_OSA_BIN`, else `../bin/osa` relative to the dashboard when present, else `osa` (design D4); argv spawn with no shell; error normalization to `missing_cli`, `exit`, `timeout`, `invalid_json`; a guard that only `status … --json` and `status … --quick --json` argv shapes can be spawned. Verify with tests for each error kind and for the guard rejecting `projects` and `up`.
- [x] 4.3 Add the host-change cache keyed by `host_path`: 60-second freshness, background refresh with at most 2 concurrent calls, scheduling only from within a `/api/projects` request, no checks for orphans, and a full drop on `refresh=1` (design D2). Verify with tests that read the stub's argv log: repeated list calls within 60 s spawn one quick status per path; two agents at one path share one call; `refresh=1` spawns again; orphans spawn nothing.

## 5. Project API routes

- [x] 5.1 Add `GET /api/projects` returning the entries with `pending`, `orphan`, `note`, `fingerprintResult`, `checkedAt`, and any per-row `osaError`. Verify with `server.test.ts` using the fixture and stub, including the stub `osa` missing (rows still have pending and orphan badges, `osaError` set) and no call recorded in the `openshell` stub log.
- [x] 5.2 Add `GET /api/projects/:sandbox/status` running `osa status <host_path> --json` with a 30-second timeout and returning the entry whose `sandbox_name` matches; 404 for a sandbox not in the registry (design D3). Verify with tests for a `behind` result, an unknown sandbox, and a timeout.
- [x] 5.3 Add `GET /api/projects/:sandbox/patch`: token required as `X-Dashboard-Token` in read-write and read-only modes; registry lookup; `realpath` confinement to `sessions/<sandbox_name>/`; regular file only; 2 MiB cap with `truncated` (design D5). Verify with tests for no token (403, and a spy shows the file is not opened), wrong token, read-only with token (200), a marker pointing at `/etc/hosts`, a symlink inside the session directory pointing outside it, a directory, a 3 MiB patch, and a sandbox with no marker.
- [x] 5.4 Make every non-GET request to `/api/projects…` return 405 and run nothing. Verify with a test that POSTs to each project route and checks both stub logs stay empty.
- [x] 5.5 Add a read-only invariant test: snapshot every file's content and mtime under the fixture state root and fixture host folders, exercise every project route, and assert nothing changed. Verify with `bun test`.

## 6. Projects UI

- [x] 6.1 Add `src/app/projects.js`: the Projects view table (agent label or raw tag, project, host path, sandbox name with a link when the sandbox is in the polled inventory, "not on gateway" or "gateway unknown" otherwise), pending, orphan, and host-change badges, per-row errors and notes, an empty state naming `maki-oss`, `opencode-oss`, and `claude-oss`, a "Check host changes" button that calls `refresh=1`, and a per-row "Check (contacts gateway)" button showing sync state, phase, and next command. Verify with the browser journey in 7.1.
- [x] 6.2 Add `src/app/patch.js`: a read-only patch view showing file name, size, the truncation notice, and lines classed by their first characters (`+`, `-`, `@@`), all through `h()`; no controls besides Back. Verify with the browser journey in 7.1.
- [x] 6.3 In `src/page.ts` and `main.js`, add the Projects and Sandboxes tabs and the attention counter (retained + parked + orphan; hidden at zero; click opens Projects), make Projects the landing view, and poll `/api/projects` and `/api/sandboxes` from every view (design D7). Verify with the browser journey in 7.1 and a `server.test.ts` check that the page shell contains the tabs and counter slot.

## 7. Browser journey and docs

- [x] 7.1 Add one Projects journey to `scripts/browser-check.ts`, run against the fixture state root and both stubs: the landing view lists every fixture row; the counter shows the expected count and opens Projects from the Sandboxes tab; a new registry file appears within one refresh; the retained patch opens with marked lines and no apply/branch/drop control; a patch line containing `<img src=x onerror=alert(1)>` renders as text with no `img` element; a row's full check shows `behind` and its next command; read-only mode still opens the patch. Verify with `bun run scripts/browser-check.ts` passing.
- [x] 7.2 Update `dashboard/README.md`: the Projects view, `DASHBOARD_OSA_BIN` and the state-root lookup in the flags table, the host-change cache, and a threat-model paragraph saying the token-gated patch route serves host source code read-only and that no project route writes. Update `dashboard/src/main.ts` usage text for `DASHBOARD_OSA_BIN`. Verify with `make lint-docs` (or the repo's doc checker) passing and `bun run start -- --help` showing the variable.
- [x] 7.3 Update the Purpose of `openspec/specs/dashboard/spec.md` to name osa projects alongside sandboxes, for example: "A local web dashboard for osa and OpenShell: the projects every agent front-end has registered with their sync state, plus the gateway's sandboxes, streamed logs, policy inspection, and rule-proposal review, without replacing `openshell term` or the CLIs." Do this together with syncing the delta at archive time. Verify with `openspec validate --specs --strict` passing.
- [x] 7.4 Run the full checks: `cd dashboard && bun test`, `bun run scripts/browser-check.ts`, `make test`, and `openspec validate dashboard-project-view --strict`. Verify all pass and record the counts and the host's Chrome version in `docs/verification-log.md`.
- [x] 7.5 Manually open the dashboard against this host's real state root and confirm every project that `osa projects` lists appears with the same pending and orphan state. Verify by noting the result in `docs/verification-log.md`.

## Apply notes

- 1.1 baseline (2026-10-26, Bun 1.4.2, Google Chrome 155.0.8059.85): `bun test` 55 pass, 0 fail; `bun run scripts/browser-check.ts` 25 passed, 0 failed (ran, not skipped).
- 2.4 after the split: `bun test` 56 pass (the sink test now covers every module, plus a new allowlist test); browser check 25 passed, 0 failed, journeys unedited. `bun build src/app/main.js` links the module graph without unresolved imports.
- 7.1: the Projects landing view means the three existing journeys now click the Sandboxes tab after opening the page; their checks are otherwise unchanged. The CDP client also records page exceptions and console errors, which a final check requires to be empty.
- `scripts/smoke.sh` was updated for the `/app/` modules (it asserted the removed `/app.js`): 47 passed.
- 7.3 is left for archive time, as the task says.
