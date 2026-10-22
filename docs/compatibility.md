# OpenCode TUI bridge — compatibility

Generated from `bridge/compat/statuses.json` and `bridge/defects.json` by `scripts/gen-compat.ts`. Do not edit by hand — run `make compat` to regenerate and `make compat-drift` to check the pinned contract against the installed OpenCode.

## Served routes

Statuses: `served-live` (real state behind the route), `served-faked` (answered from the pinned spec with synthesized values), `deferred` (spec-valid minimal answer, surface not implemented), `unhandled` (outside the pinned contract: answered 404).

| Route | Status | Evidence |
| --- | --- | --- |
| `GET /api/event` | `served-live` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `POST /api/session` | `served-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session` | `served-live` | [`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log`](../openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log) |
| `GET /api/session/{sessionID}` | `served-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `DELETE /api/session/{sessionID}` | `served-live` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `POST /api/session/{sessionID}/prompt` | `served-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session/{sessionID}/permission` | `served-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `POST /api/session/{sessionID}/permission/{requestID}/reply` | `served-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `POST /api/session/{sessionID}/model` | `served-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `POST /api/session/{sessionID}/agent` | `served-live` | [`bridge/src/bridge.ts`](../bridge/src/bridge.ts) |
| `GET /api/info` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/model` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/agent` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/project` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/location` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/fs/list` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/config` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/command` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/reference` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/skill` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/provider` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/integration` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/mcp` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/mcp/resource` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/plugin` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/vcs` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/shell` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/form` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/experimental/migration/v1` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session/active` | `served-faked` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session/{sessionID}/form` | `deferred` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session/{sessionID}/terminal` | `deferred` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session/{sessionID}/message` | `deferred` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/session/{sessionID}/inbox` | `deferred` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/fork` | `deferred` | [`bridge/src/bridge.ts`](../bridge/src/bridge.ts) |

## Wire features

Statuses: `verified` (an offline test or committed fixture proves it), `degraded` (works, with a limitation recorded in the evidence), `unverified` (no evidence yet), `buggy` (an open inventory entry in `bridge/defects.json` forces this status until the fix flips it).

| Feature | Status | Evidence |
| --- | --- | --- |
| SSE stream starts with server.connected | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| SSE frames are bare data: lines (no event:/id: lines) | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| SSE stream survives idle gaps: the TUI does not auto-reconnect mid-session | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| Minted ids match the OpenCode patterns (evt_/ses_/msg_/per_) | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| Durable events carry a complete durable envelope keyed to the session | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| Response bodies validate against the vendored OpenAPI 2.0.32 | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| Session create/read/list/delete with child teardown (no orphan processes) | `verified` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| Recorded Maki turns translate to the committed golden frames | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) |
| Failing and permission-denied tools map to session.tool.failed | `verified` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| Permission ask/reply round trip runs offline over the child seam | `verified` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| A reply of `always` is honored once; the next gated call asks again | `degraded` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| stream_event deltas translate into part delta frames | `degraded` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) |
| User prompts render before the assistant output they caused | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) |
| Session events carry Maki's real model name | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) |
| The location model list refreshes when the child announces, so its model stays selectable | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| System api_retry frames are tolerated without disturbing the transcript | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) |
| Interrupt round trip via control_cancel_request and the interrupt route | `unverified` | [`openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md`](../openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md) |
| Mid-session model switch forwards set_model / the model POST route | `unverified` | [`openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md`](../openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md) |
| Mid-turn steering via an inbound user prompt while the agent runs | `unverified` | [`openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md`](../openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md) |
| SDK control handshake (initialize / set_permission_mode) is sent to the child | `unverified` | [`openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md`](../openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/cross-map.md) |
| Subagent transcript nesting via parent_tool_use_id | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) |

## Version matrix

| Component | Pinned | Evidence |
| --- | --- | --- |
| OpenCode (pinned contract) | 2.0.32 | [`bridge/src/openapi-2.0.32.json`](../bridge/src/openapi-2.0.32.json) |
| Maki SDK (wire) | 0.6.4 | [`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/e2e-note.md`](../openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/e2e-note.md) |
| Sandbox transport | OpenShell sandbox exec (stdio), non-root sandbox user, no secrets via --env; bridge binds 127.0.0.1 | [`bin/maki-oss`](../bin/maki-oss) |
