# Tasks

## 1. Check records

- [x] 1.1 Refactor `cmd_doctor` and each front-end's `agent_doctor_extra` to append check records and render them as today's text (design D1). Verify with the existing doctor tests passing unchanged under `make test`.
- [x] 1.2 Refactor `mcp_readiness_report` / `cmd_mcp_status` the same way. Verify with the existing MCP readiness tests passing unchanged.

## 2. Idle state

- [x] 2.1 Add `idle_state` to `lib/osa-state.sh` (design D2), converting log times to ISO 8601 UTC. Verify with tests over constructed `idle`/`idle.log` files for every state, including the estimated case and `TZ=Asia/Yekaterinburg`.
- [x] 2.2 Add `idle` to `osa status --quick --json`. Verify with a test that a session closed 10 minutes ago with `secs=3600` reports `counting` and a deadline 50 minutes ahead (±5 s), with an empty gateway stub log.

## 3. osa health

- [x] 3.1 Add `__health-json` to the core and route it in `bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`, and `bin/codex-oss`; MCP is `unsupported` where the front-end has no `mcp status`, and a stopped sandbox gives an MCP error without a start call. Verify with tests per front-end that parse the JSON and compare gates and checks with the text commands' output for the same fixture.
- [x] 3.2 Add `osa health SANDBOX [--json]` to `bin/osa` with registry lookup, the orphan path (idle only), text rendering, `usage()`, the unknown-command list, and `fish/completions/osa.fish`. Verify with tests for a registered sandbox, an unregistered one (usage error), an orphan, a gateway failure (MCP error, doctor gateway `fail`, idle present), and a scan that no credential value from the provider fixture appears in stdout.
- [x] 3.3 Extend the "osa never changes a sandbox" test to include `osa health`. Verify with `make test`.

## 4. Dashboard

- [x] 4.1 Extend `dashboard/test/stub/osa` with `health SANDBOX --json` fixtures (all sections ok, failing MCP gate, unsupported MCP, partial error, markup in a detail) and `idle` in quick status. Verify with a stub self-test.
- [x] 4.2 Add `health <sandbox> --json` to `isAllowedOsaArgv` and `GET /api/projects/:sandbox/health` (design D4). Verify with tests: allowed and rejected argv shapes, 404 for an unregistered sandbox, timeout, and that `/api/projects` polling never spawns `health` (stub log).
- [x] 4.3 Add `src/app/health.js` and wire it from the project row and the registered sandbox detail view; add the idle cell with a 1-second client-side countdown and the "stop due" state; link the header status per design D5. Verify with the browser journey in 5.1.

## 5. Journey and docs

- [x] 5.1 Add one health journey to `scripts/browser-check.ts`: a counting row's countdown decreases over 2 seconds with no new request; opening Health shows a failing MCP gate with its fix, an `unsupported` MCP section for another agent, and a partial error with the other sections present; the markup detail renders as text; no configuration control is present. Verify with `bun run scripts/browser-check.ts` passing.
- [x] 5.2 Document `osa health` and the quick-status `idle` field in `docs/helper.md`, and the Health panel and countdown in `dashboard/README.md`. Verify with `make lint-docs` passing.
- [x] 5.3 Run `make test`, `cd dashboard && bun test`, the browser check, and `openspec validate dashboard-health --strict`; then end a real session on this host and watch its countdown in the dashboard, recording the result in `docs/verification-log.md`. Verify all pass and the log entry exists.
