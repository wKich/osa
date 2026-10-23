# Discovery pass 7: closing check after the route-queue burndown

## The passes

| Pass | Command | Result |
| --- | --- | --- |
| API discovery | `bun bridge/test/discovery.ts` | 5 scenarios, 5 clean, 0 known defects deduped, **0 appended** |
| TUI discovery | `make test-ui` (real `opencode v2.0.32`, scripted child and scripted sandbox) | PASS: 36 requests served without 404, all matched; PONG rendered; permission round-tripped |
| Pin drift | `bun scripts/compat-drift.ts` | opencode v2.0.32 / maki 0.6.4; no drift |
| Offline suite | `cd bridge && bun test` | 106 pass, 0 fail, 871 expectations |
| Report consistency | `bun scripts/gen-compat.ts --check` | matches |

## Enumeration

Unchanged at the pins: 143 operations = 143 route rows. Every route in the
TUI capture has a reachable row. The normalized TUI route set is the
iteration-6 set minus `GET /api/experimental/session/{sessionID}/terminal`,
which the TUI stops polling once `persistentPty` is `false`. That route stays
reachable through `bridge/test/fixtures/bridge-requests.jsonl`.

## Scoreboard

Reachable routes: 22 `served-live`, 4 `deferred`, 7 `served-faked`,
0 `unhandled`. Every faked route has a decision: 6 accepted, 1 pin-blocked.
There are 0 untriaged reachable routes.

Reachable features: 34 `verified`, 5 `degraded` (all `blockedBy: pin`),
0 `unverified`. Open defects: 0 (6 entries, all `fixed`). Rows added to
`statuses.json` in this pass: 0.

## Changes in the burndown

`rebaseline-compat-iteration-6` → `fix-boot-surface-truth` →
`fix-fs-list-sandbox` → `add-sandbox-git-state` → `add-session-active-state`
→ `add-mcp-server-status` → `add-skill-list` → `add-model-catalog` → this
pass.
