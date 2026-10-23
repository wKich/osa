# Discovery pass 6: the route queue

## The passes

| Pass | Command | Result |
| --- | --- | --- |
| API discovery | `bun bridge/test/discovery.ts` | 5 scenarios, 5 clean, 0 known defects deduped, **0 appended** |
| TUI discovery | `make test-ui` (real `opencode v2.0.32`) | PASS: 37 requests served without 404, PONG rendered, permission round-tripped; normalized route set (28 routes) identical to the committed capture |
| Pin drift | `bun scripts/compat-drift.ts` | opencode v2.0.32 / maki 0.6.4; 119 routes / 293 schemas; no drift |
| Offline suite | `cd bridge && bun test` | 82 pass, 0 fail, 745 expectations |
| Report consistency | `bun scripts/gen-compat.ts --check` | matches (before this change's edits) |

## Enumeration

Unchanged at the pins: 143 operations = 143 route rows; 51/51 session events;
every wire kind recorded. New this pass: the sandbox-side sources in
`maki-sdk-wire-features.md` (model catalog, MCP config, skills, custom
commands) and the TUI consumers of the 21 untriaged reachable fakes
(`cross-map.md`, iteration-6 findings and triage).

## Recorded

- `bridge/defects.json`: 3 entries appended by hand from the committed TUI
  capture (`fs-list-reads-host-directory`, `boot-lists-phantom-rows`,
  `info-advertises-terminals`), each with its own `captures/defect-*.jsonl`.
- `bridge/compat/statuses.json`: 9 feature rows added (8 `unverified`
  `blockedBy: none`, 1 `unverified` `blockedBy: pin`); 12 reachable routes
  linked to a feature; 3 accepted with a `fakeReason`.

## Scoreboard after recording

Reachable routes: 11 `served-live`, 21 `served-faked`, 1 `deferred`,
0 `unhandled`; untriaged reachable routes 21 → 6 (`agent`, `plugin`,
`reference`, `shell`, `mcp/resource`, `terminal` — each decided in the triage
table, applied by the fix change that empties its payload). Reachable
features: 26 `verified`, 4 `degraded` (pin), 9 `unverified` (1 pin). Open
defects: 3.

## Hand-off

1. `fix-boot-surface-truth` — `boot-lists-phantom-rows`, `info-advertises-terminals`
2. `fix-fs-list-sandbox` — `fs-list-reads-host-directory`
3. capability slices, one change each: `vcs-branch-live`,
   `project-identity-live`, `session-active-live`, `mcp-server-status`,
   `skill-list-live`, `model-catalog-live`
