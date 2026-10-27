# Tasks

## 1. Fixtures and parser

- [x] 1.1 Extend `dashboard/test/stub/openshell` so `logs NAME --since W --source sandbox -n N` prints fixture lines (both real denial shapes, the upstream `[policy:- engine:opa]` shape, an IPv6 destination, a non-denial OCSF line, a `DENIED` line in an unknown layout, ANSI-colored lines, and a host containing markup), records argv, and can fail. Verify with a stub self-test in `openshell.test.ts`.
- [x] 1.2 Add the OCSF shorthand denial parser (design D2) as a pure function. Verify with table-driven tests in a new `egress.test.ts` covering every fixture shape, including IPv6 and unparsed lines.
- [x] 1.3 Add `OpenShellClient.recentLogs(name, window)` with the enum window, `-n 5000`, 20-second timeout, and a `capped` flag. Verify with tests on the recorded argv for each window and on the timeout and missing-CLI errors.

## 2. Grouping, matching, route

- [x] 2.1 Add `src/egress.ts`: grouping by host/port/binary with count, first/last seen, reasons; endpoint text splitting; the match rule from the spec. Verify with tests for host case, missing port, binary mismatch, multiple proposals matching one group, and a malformed endpoint string.
- [x] 2.2 Add `GET /api/sandboxes/:name/denials?window=…&refresh=1` with the token check, 30-second cache per `(name, window)`, and the response shape in design D4. Verify with `server.test.ts` cases: no token (403, stub log shows no `logs` call), read-only with token (200), invalid window (400), cache hit (one `logs` call for two requests), `refresh=1` (second call), gateway failure (error with CLI text).

## 3. UI

- [x] 3.1 In `src/app/rules.js`, add the window selector and Refresh, load denials when the Rules view opens, render matched groups under each pending proposal and the rest under "denied, no proposal", show `capped`, unparsed count and samples, and errors, all through `h()`. Verify with the browser journey in 4.1.
- [x] 3.2 In `src/app/inventory.js` and `src/app/projects.js`, show the unmatched-group count from the last cached read with its age, and nothing when no read exists. Verify with the browser journey in 4.1.

## 4. Journey and docs

- [x] 4.1 Add one egress journey to `scripts/browser-check.ts`: opening Rules shows denials under the matching pending proposal and an unmatched group under "denied, no proposal"; switching to 15 minutes sends `--since 15m`; the inventory badge then shows the unmatched count; the markup host renders as text; no policy-changing control appears in the denial view. Verify with `bun run scripts/browser-check.ts` passing.
- [x] 4.2 Update `dashboard/README.md` (Rules view denials, the window, the token, the shorthand-only limit and why the JSON export is not used, the API table). Verify with `make lint-docs` passing.
- [x] 4.3 Run `cd dashboard && bun test`, the browser check, and `openspec validate dashboard-egress --strict`; then trigger one real denial on this host (`curl https://example.com` in a sandbox) and confirm it appears in the Rules view, recording the result in `docs/verification-log.md`. Verify all pass and the log entry exists.
