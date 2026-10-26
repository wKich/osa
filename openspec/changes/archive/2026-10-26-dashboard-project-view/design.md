# Design

## Context

See proposal.md - Why. The pieces this change stands on:

- **Contract (M0).** `$XDG_STATE_HOME/osa/projects/<sandbox>.toml` registry entries and `sessions/<sandbox>/pending` markers are flat TOML, `version = "1"`, keys only added within a version (`openspec/specs/osa-project-layer/spec.md`). Everything else under the root (`baseline`, `synced`, archives) is internal. Patches are written as `sessions/<sandbox>/patch-<stamp>.patch` and named by the marker's `patch` key.
- **`osa` (M0).** `osa status [PATH] --quick --json` adds `fingerprint_result` to each entry and never contacts the gateway. `osa status [PATH] --json` adds a `status` object from the owning front-end's `__status-json` (`phase`, `providers`, `sync`, `patch`, `next`), which queries the gateway and may run the read-only workspace probe. Both return one object per agent registered at that path.
- **Agents.** `mk`, `oc`, and `cc` are registered today; `add-codex-oss` (in flight) adds `cx`. The dashboard must not hard-code the set.
- **Dashboard today.** Bun + TypeScript server, zero npm dependencies, no build step. `src/server.ts` routes `/`, `/app.js`, `/api/*`, `/events/logs`. GET API routes need no token; mutations need `X-Dashboard-Token`; the log stream needs `?token=`. The frontend is one 884-line IIFE, `src/app.js`, whose DOM writes all go through `h()` / `textContent`; a test asserts no HTML sink appears in the served script. CSP is `script-src 'self'`. Tests use `test/stub/openshell` via `DASHBOARD_OPENSHELL_BIN`; `scripts/browser-check.ts` drives headless Chrome over CDP.

## Goals / Non-Goals

**Goals:**

- The project list costs no process spawns per poll tick: it is file reads only.
- Every computed value (host fingerprint, sync classification) comes from `osa`, so the dashboard holds no copy of project logic.
- The module split is a pure move: the existing views behave the same and the existing browser journeys pass unchanged.

**Non-Goals:**

- Joining projects to rule proposals or egress denials (M3).
- Watching the state root with file-system events. Polling at the existing interval is enough for one user.
- Caching anything across server restarts.

## Decisions

### D1: Read the contract files directly; call `osa` only for computed values

`GET /api/projects` scans `projects/*.toml`, parses each with `Bun.TOML.parse`, reads the matching `sessions/<sandbox_name>/pending`, and checks `host_path` with `stat`. It never calls the gateway. The client joins `sandbox_name` against the `/api/sandboxes` inventory it already polls, so "not on gateway" costs no extra CLI call; while that inventory is unavailable, the column shows "gateway unknown" instead. This is what M0 D5/D7 designed the contract for: clients read files to poll and call `osa --json` for computed values.

The pending kind follows the contract: `kind` is a required v1 key. A marker with no `kind` is reported as `parked`, and the row carries a note; the dashboard does not reproduce `pending_kind`'s patch-size fallback, which exists only for pre-contract markers.

Alternatives: spawn `osa projects --json` on every tick. It is correct by construction but costs a shell, `awk` per field, and a `stat` per entry every 3 seconds, and it would make the contract pointless for its first client. Rejected. A conformance test runs the real `bin/osa projects --json` against the same fixture and compares the fields, so the two readers cannot drift silently.

### D2: Host-change results are cached per host path for 60 seconds

`osa status --quick` runs `git status` and `git diff HEAD` in the project, so it is not run per tick (M0 risk: "never per poll tick; clients cache"). The server keeps a map `host_path -> { at, result }` and serves `GET /api/projects` with whatever results it has, plus a `checkedAt` per row. When a result is missing or older than 60 seconds, the server schedules one `osa status <path> --quick --json` call for it in the background, with at most 2 running at once, and a later poll picks the result up. `?refresh=1` drops the cache for every path. The cache is keyed by `host_path`, not sandbox, because one call answers every agent registered at that path. Orphans are never checked: they are `unknown` by definition.

Alternatives: compute in the request path. With 20 projects that delays the list by 20 `git status` calls. Rejected. Per-row on-demand only: hides the most useful badge behind a click. Rejected.

### D3: Full status is on demand and never cached

`GET /api/projects/:sandbox/status` looks up the entry's `host_path`, runs `osa status <host_path> --json`, and returns the object whose `sandbox_name` matches. It talks to the gateway and may run the workspace probe in a sandbox, so it runs only when the user clicks "Check", with a 30-second timeout. The result is shown on the row until the next click or reload.

### D4: `osa` is located like `openshell`

`DASHBOARD_OSA_BIN` wins; otherwise `bin/osa` relative to the repository (`dashboard/../bin/osa`) when it exists; otherwise `osa` on `PATH`. The dashboard lives in the osa repository, so the relative default works without installation. It is spawned with an argv array, no shell, the same as `OpenShellClient.run`, and its errors are normalized to the same `OpenShellError` kinds (`missing_cli`, `exit`, `timeout`, `invalid_json`). The state root is resolved like `osa_state_paths`: `$XDG_STATE_HOME/osa`, else `$HOME/.local/state/osa`. Tests point `XDG_STATE_HOME` at a fixture directory.

### D5: The patch route is token-gated and confined to the session directory

`GET /api/projects/:sandbox/patch` is the first GET route that returns host source code, which is more sensitive than gateway metadata, so it takes the session token as `X-Dashboard-Token`, like a mutation, but is allowed in read-only mode, like the log stream. The server:

1. finds the registry entry by `sandbox_name` (a name not in the registry is a 404, so the URL cannot name an arbitrary session directory);
2. reads `patch` from that sandbox's `pending` marker;
3. resolves both the patch path and `sessions/<sandbox_name>/` with `realpath` and refuses unless the patch is a regular file directly inside that directory;
4. reads at most 2 MiB and returns `{ name, size, truncated, text }`.

The client splits `text` into lines and renders each as a text node with a class from its first character (`+`, `-`, `@@`, other). No syntax highlighting.

Alternatives: no token, like other GETs. Any local process can already read the file, but a token-free route would also hand it to any page that finds the port through DNS rebinding. The token costs nothing since the page already holds it. Rejected.

### D6: ES modules under `src/app/`, served from an allowlist

`src/app.js` becomes `src/app/*.js`: `main.js` (bootstrap, router, polling), `state.js` (the shared state object), `dom.js` (`h`, `clear`, formatting), `api.js` (`request`, `mutate`), `banner.js`, `inventory.js`, `detail.js`, `logs.js`, `policy.js`, `rules.js`, and the new `projects.js` and `patch.js`. The page loads `<script type="module" src="/app/main.js">`. The server builds the allowlist once at startup from the file names in `src/app/` that match `^[a-z-]+\.js$` and serves only those, so `GET /app/<anything else>` is a 404 and no path from the URL reaches the file system. `script-src 'self'` already covers module scripts. The no-HTML-sink test iterates over every served module. Views import `state.js` rather than `main.js`, so modules do not import each other in cycles.

The split is its own task group before any Projects code, and the existing browser journeys must pass after it with no edits, so behavior changes and the move are never mixed in one diff.

Alternatives: keep one file and add 400 more lines. Rejected by the M0 plan. Add a bundler. Breaks "no build step". Rejected.

### D7: Navigation and the counter

The header gains two tabs, **Projects** and **Sandboxes**, and the attention counter next to them. Projects is the landing view, since the dashboard now starts from where the user's work is. The counter is computed by the client from the last `/api/projects` response (`pending !== ""` or `orphan`), so it needs no separate route. The client polls `/api/projects` and `/api/sandboxes` on the same interval from every view, because the counter is always visible and the Projects view needs the inventory for its join.

### D8: Unknown agent tags and versions

Known tags map to labels (`mk` Maki, `oc` OpenCode, `cc` Claude Code, `cx` Codex). Any other tag shows raw. An entry whose `version` is not `"1"` is listed by file name only (see the spec), because a version bump means a key may have changed meaning.

## Risks / Trade-offs

- [The TypeScript reader and `osa` drift on the contract] → The conformance test in D1 runs both over one fixture, including paths with spaces and quotes.
- [Background `git status` on a large repository slows the host] → At most 2 concurrent, at most once per path per minute, and never for orphans. A user who sees load can leave the Projects view closed; nothing runs while no client polls, because scheduling happens only inside `/api/projects` requests.
- [Full status wakes or probes a sandbox] → It is click-only, and M0 limits `osa status` to the read-only probe. The UI labels the button as contacting the gateway.
- [A patch shows host code to anyone with the page] → Token-gated (D5) and loopback by default. The README threat model says so.
- [The module split breaks a view] → It lands first and alone, gated by the existing browser journeys.
- [The registry path in the URL] → Sandbox names are looked up, never joined into a path, and the realpath check is the only gate for file reads.

## Migration Plan

None. The dashboard only reads existing files. Rollback is reverting the change; nothing on disk is touched.
