# OpenCode TUI bridge — compatibility

Generated from `bridge/compat/statuses.json`, `bridge/compat/journeys.json` and `bridge/defects.json` by `scripts/gen-compat.ts`. Do not edit by hand — run `make compat` to regenerate and `make compat-drift` to check the pinned contract against the installed OpenCode.

## Burndown

Reachable surface: **37 of 143 routes** (25 `served-live`, 7 `served-faked`, 5 `deferred`, 0 `unhandled`) and **43 of 45 features** (38 `verified`, 0 `unverified`, 5 `degraded` (5 pin-blocked), 0 `buggy`). Out of scope: 106 routes, 2 features. Open defects: **0**.

Untriaged reachable routes: **0**.

## Served routes

Statuses: `served-live` (real state behind the route), `served-faked` (answered from the pinned spec with synthesized values), `deferred` (spec-valid minimal answer, surface not implemented), `unhandled` (outside the pinned contract: answered 404).

### Reachable (37)

| Route | Status | Decision | Evidence |
| --- | --- | --- | --- |
| `GET /api/event` | `served-live` | live | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `POST /api/session` | `served-live` | live | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session` | `served-live` | live | [`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log`](../openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log) |
| `GET /api/session/{sessionID}` | `served-live` | live | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `DELETE /api/session/{sessionID}` | `served-live` | live | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `POST /api/session/{sessionID}/prompt` | `served-live` | live | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/session/{sessionID}/permission` | `served-live` | live | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `POST /api/session/{sessionID}/permission/{requestID}/reply` | `served-live` | live | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `POST /api/session/{sessionID}/model` | `served-live` | live | [`bridge/test/model-switch.test.ts`](../bridge/test/model-switch.test.ts) |
| `POST /api/session/{sessionID}/agent` | `served-live` | live | [`bridge/test/agent-switch.test.ts`](../bridge/test/agent-switch.test.ts) |
| `GET /api/info` | `served-live` | live — `server-info-live` | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/model` | `served-live` | live — `model-catalog-live` | [`bridge/test/model-catalog.test.ts`](../bridge/test/model-catalog.test.ts) |
| `GET /api/project` | `served-live` | live — `project-identity-live` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `GET /api/location` | `served-live` | live — `project-identity-live` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `GET /api/fs/list` | `served-live` | live — `fs-list-sandbox` | [`bridge/test/fs-list.test.ts`](../bridge/test/fs-list.test.ts) |
| `GET /api/skill` | `served-live` | live — `skill-list-live` | [`bridge/test/skill-list.test.ts`](../bridge/test/skill-list.test.ts) |
| `GET /api/provider` | `served-live` | live — `model-catalog-live` | [`bridge/test/model-catalog.test.ts`](../bridge/test/model-catalog.test.ts) |
| `GET /api/integration` | `served-live` | live — `model-catalog-live` | [`bridge/test/model-catalog.test.ts`](../bridge/test/model-catalog.test.ts) |
| `GET /api/mcp` | `served-live` | live — `mcp-server-status` | [`bridge/test/mcp-status.test.ts`](../bridge/test/mcp-status.test.ts) |
| `GET /api/vcs` | `served-live` | live — `vcs-branch-live` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `GET /api/session/active` | `served-live` | live — `session-active-live` | [`bridge/test/session-active.test.ts`](../bridge/test/session-active.test.ts) |
| `PATCH /api/session/{sessionID}` | `served-live` | live — `session-rename` | [`bridge/test/session-title.test.ts`](../bridge/test/session-title.test.ts) |
| `POST /api/session/{sessionID}/interrupt` | `served-live` | live | [`bridge/test/interrupt.test.ts`](../bridge/test/interrupt.test.ts) |
| `POST /api/session/{sessionID}/view` | `served-live` | live — `session-idle-state` | [`bridge/test/session-idle.test.ts`](../bridge/test/session-idle.test.ts) |
| `GET /api/session/{sessionID}/message` | `served-live` | live — `session-message-history` | [`bridge/test/session-history.test.ts`](../bridge/test/session-history.test.ts) |
| `GET /api/agent` | `served-faked` | accept — Maki at v0.6.4 runs one agent and has no named-agent surface — `initialize` ignores `agents` (sdk_mode.rs L828–L839) and there is no `set_agent` (L818–L880) — so one primary `build` entry, Maki's name for its default mode, is the true list; the TUI needs exactly one primary agent to submit (`prompt/index.tsx` v2.0.32 L1159–L1160) | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/config` | `served-faked` | accept — the response is the list of OpenCode config documents (`schema/src/config.ts` v2.0.32 L117–L135) and the bridge loads none — Maki's TOML/Lua config is not one; the TUI reads only the last document's `info.model` as a default (`tui/src/context/local.tsx` L173–L182), and the true default is the child's announced model, so an empty list is correct | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/command` | `served-faked` | pin — `slash-commands` | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/reference` | `served-faked` | accept — references are `@` aliases declared in OpenCode config documents, and the bridge has none (`GET /api/config` is an empty list); Maki has no alias concept at v0.6.4, so the empty list is the true set | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/plugin` | `served-faked` | accept — the list holds OpenCode server plugins (`source`, `features`, `state`) and the bridge loads none; Maki's Lua plugins run inside the child and are not OpenCode plugins, so the empty list is the true set | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/form` | `served-faked` | accept — forms are pending MCP elicitations; the pinned Maki SDK wire has no elicitation message (its only outbound ask is `control_request` `can_use_tool`, `sdk_mode.rs` v0.6.4 L1155), so no global form can ever be pending and the empty list is the true state | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/experimental/migration/v1` | `served-faked` | accept — the bridge keeps no OpenCode data store, so there is no migration to run: `completed` is the true status, and the only one that ends the TUI's 1s poll without a spinner or an error toast (`tui/src/component/migration-overlay.tsx` v2.0.32 L22–L26) | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/mcp/resource` | `deferred` | deferred | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/shell` | `deferred` | deferred | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/experimental/session/{sessionID}/terminal` | `deferred` | deferred | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/session/{sessionID}/form` | `deferred` | deferred | [`bridge/test/deferred-session-surfaces.test.ts`](../bridge/test/deferred-session-surfaces.test.ts) |
| `GET /api/session/{sessionID}/inbox` | `deferred` | deferred | [`bridge/test/deferred-session-surfaces.test.ts`](../bridge/test/deferred-session-surfaces.test.ts) |

### Out of scope (106)

| Route | Status | Evidence |
| --- | --- | --- |
| `DELETE /api/credential/{credentialID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/debug/location` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/experimental/mcp/{server}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/experimental/persistent-pty/{ptyID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/experimental/session/{sessionID}/instructions/entries/{key}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/integration/{integrationID}/connect/command/{attemptID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/integration/{integrationID}/connect/oauth/{attemptID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/permission/saved/{id}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/pty/{ptyID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/session/{sessionID}/form/{formID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/session/{sessionID}/inbox/{inboxID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/session/{sessionID}/revert` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/shell/{id}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `DELETE /api/worktree` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/agent/{agentID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/config/shell` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/credential` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/debug/location` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/persistent-pty/{ptyID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/persistent-pty/{ptyID}/connect` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/persistent-pty/{ptyID}/snapshot` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/session/stats` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/session/{sessionID}/export` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/session/{sessionID}/instructions/entries` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/session/{sessionID}/log` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/experimental/session/{sessionID}/terminal/read` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/fs/find` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/integration/{integrationID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/integration/{integrationID}/connect/command/{attemptID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/integration/{integrationID}/connect/oauth/{attemptID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/model/default` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/permission/request` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/permission/saved` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/provider/{providerID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/pty` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/pty/{ptyID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/pty/{ptyID}/connect` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/session/{sessionID}/context` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/session/{sessionID}/diff` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/session/{sessionID}/form/{formID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/session/{sessionID}/message/{messageID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/session/{sessionID}/permission/{requestID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/shell/{id}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/shell/{id}/output` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/vcs/base` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/vcs/branch` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/vcs/diff` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/vcs/status` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/websearch/provider` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /api/worktree` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PATCH /api/credential/{credentialID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PATCH /api/experimental/config` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PATCH /api/project/{projectID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PATCH /api/session/{sessionID}/inbox/{inboxID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/credential` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/credential/{credentialID}/activate` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/fs/write` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/generate` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/integration/wellknown` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/mcp/{server}/connect` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/mcp/{server}/disconnect` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/persistent-pty/handoff` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/persistent-pty/shutdown` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/persistent-pty/{ptyID}/connect-token` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/session/import` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/session/{sessionID}/skill` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/session/{sessionID}/terminal` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/session/{sessionID}/wait` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/experimental/voice/session` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/integration/{integrationID}/connect/command` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/integration/{integrationID}/connect/external` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/integration/{integrationID}/connect/key` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/integration/{integrationID}/connect/oauth` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/integration/{integrationID}/connect/oauth/{attemptID}/complete` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/location/reload` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/pair` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/plugin/check` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/plugin/update` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/pty` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/pty/{ptyID}/connect-token` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/rpc/{rpcID}/{method}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/background` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/command` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/compact` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/form` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/form/{formID}/reply` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/generate` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/move` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/permission` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/revert/commit` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/revert/stage` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/shell` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/synthetic` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/shell` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/vcs/init` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/websearch` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/worktree` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/worktree/refresh` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PUT /api/experimental/mcp/{server}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PUT /api/experimental/persistent-pty/{ptyID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PUT /api/experimental/session/{sessionID}/instructions/entries/{key}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PUT /api/pty/{ptyID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `PUT /api/session/{sessionID}/environment` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `GET /auth/connect/{code}` | `served-faked` | [`openspec/changes/archive/2026-10-23-rebaseline-compat-iteration-3/evidence/discovery-log.md`](../openspec/changes/archive/2026-10-23-rebaseline-compat-iteration-3/evidence/discovery-log.md) |
| `GET /api/fs/read/*` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
| `POST /api/session/{sessionID}/fork` | `deferred` | [`bridge/src/bridge.ts`](../bridge/src/bridge.ts) |

## Wire features

Statuses: `verified` (an offline test or committed fixture proves it), `degraded` (works, with a limitation recorded in the evidence), `unverified` (no evidence yet), `buggy` (an open inventory entry in `bridge/defects.json` forces this status until the fix flips it). `pin-blocked` marks a gap that needs an upstream wire change. A `verified` row is `journey-verified` only when every reachable journey that lists it is at `parity`; otherwise the journey oracle reports it `unit-verified only`.

### Reachable (43)

| Id | Feature | Status | Journeys | Evidence |
| --- | --- | --- | --- | --- |
| `sse-handshake` | SSE stream starts with server.connected | `verified` | `unit-verified only` — `boot-project-context`, `send-prompt-stream-reply` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `sse-bare-data-frames` | SSE frames are bare data: lines (no event:/id: lines) | `verified` | `journey-verified` — `send-prompt-stream-reply` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `sse-idle-keepalive` | SSE stream survives idle gaps: the TUI does not auto-reconnect mid-session | `verified` | `unit-verified only` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `minted-id-patterns` | Minted ids match the OpenCode patterns (evt_/ses_/msg_/per_) | `verified` | `journey-verified` — `send-prompt-stream-reply` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `durable-envelope` | Durable events carry a complete durable envelope keyed to the session | `verified` | `journey-verified` — `send-prompt-stream-reply` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `openapi-contract` | Response bodies validate against the vendored OpenAPI 2.0.32 | `verified` | `unit-verified only` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `session-crud` | Session create/read/list/delete with child teardown (no orphan processes) | `verified` | `unit-verified only` — `new-session`, `resume-session-history`, `delete-session`, `clear-session` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `session-title` | A session is titled from its first prompt by Maki's rule when its first run ends (generate_title, maki-storage sessions.rs v0.6.4 L677–L695), announced with session.renamed | `verified` | `journey-verified` — `resume-session-history`, `rename-session`, `send-prompt-stream-reply` | [`bridge/test/session-title.test.ts`](../bridge/test/session-title.test.ts) |
| `session-rename` | PATCH /api/session/{sessionID} renames the session (session.renamed), regenerates Maki's first-prompt title for an empty title, and keeps metadata; permission rules are not settable over the pinned SDK (server handlers/session.ts v2.0.32 L259–L281) | `verified` | `journey-verified` — `rename-session` | [`bridge/test/session-title.test.ts`](../bridge/test/session-title.test.ts) |
| `session-idle-state` | A terminal execution transition sets the session's time.idle and outcome, strictly advancing, before the frame the TUI re-reads on; session.view acknowledges it, so the tab's unread marker follows the real server (core session/projector.ts v2.0.32 L412–L440, session.ts L61–L70) | `verified` | `journey-verified` — `send-prompt-stream-reply` | [`bridge/test/session-idle.test.ts`](../bridge/test/session-idle.test.ts) |
| `session-message-history` | GET /api/session/{sessionID}/message answers the transcript the bridge projected from its own frames (user, assistant parts, idle markers), paged like the real handler, so a reopened TUI renders the session's history (server/src/handlers/message.ts v2.0.32 L9–L65) | `verified` | `journey-verified` — `resume-session-history` | [`bridge/test/session-history.test.ts`](../bridge/test/session-history.test.ts) |
| `deferred-session-surface-contract` | Deferred session inbox/form reads, and a session with no turn, answer schema-valid empty lists and 404 unknown sessions, never a phantom row | `verified` | `journey-verified` — `resume-session-history` | [`bridge/test/deferred-session-surfaces.test.ts`](../bridge/test/deferred-session-surfaces.test.ts) |
| `session-isolation` | Concurrent sessions keep their children and transcripts apart | `verified` | `unit-verified only` | [`bridge/test/session-isolation.test.ts`](../bridge/test/session-isolation.test.ts) |
| `prompt-translation` | Recorded Maki turns translate to the committed golden frames | `verified` | `unit-verified only` — `send-prompt-stream-reply`, `see-file-reads-and-searches` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `tool-failure-mapping` | Failing and permission-denied tools map to session.tool.failed | `verified` | `journey-verified` — `allow-permission-once` | [`bridge/test/tool-frames.test.ts`](../bridge/test/tool-frames.test.ts) |
| `turn-failure-mapping` | A failed Maki turn maps to session.execution.failed with the wire's message, never to success | `verified` | `unit-verified only` — `interrupt-running-turn`, `see-failed-turn-error` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `turn-abort-mapping` | A Maki child exiting mid-turn fails the turn exactly once (no success) and later prompts are refused with 503 | `verified` | `unit-verified only` — `interrupt-running-turn` | [`bridge/test/turn-abort.test.ts`](../bridge/test/turn-abort.test.ts) |
| `permission-round-trip` | Permission ask/reply round trip runs offline over the child seam | `verified` | `unit-verified only` — `allow-permission-once`, `reject-permission-with-reason`, `see-file-edit-diff` | [`bridge/test/permission-egress.test.ts`](../bridge/test/permission-egress.test.ts) |
| `stream-deltas` | stream_event deltas translate into part delta frames | `verified` | `journey-verified` — `send-prompt-stream-reply` | [`bridge/test/fixtures/maki-stream-live.jsonl`](../bridge/test/fixtures/maki-stream-live.jsonl) |
| `transcript-order` | User prompts render before the assistant output they caused | `verified` | `unit-verified only` — `resume-session-history`, `jump-to-message`, `send-prompt-stream-reply` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `model-identity` | Session events carry Maki's real model name | `verified` | `journey-verified` — `send-prompt-stream-reply` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `model-list-refresh` | The location model list refreshes when the child announces, so its model stays selectable | `verified` | `unit-verified only` — `switch-model` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `api-retry-tolerance` | System api_retry frames are tolerated without disturbing the transcript | `verified` | `journey-verified` — `send-prompt-stream-reply` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `mid-session-model-switch` | Mid-session model selection is forwarded as `set_model`; the child's success ack moves the reported model (`model.updated`), a refused model leaves the announced one | `verified` | `unit-verified only` — `switch-model` | [`bridge/test/model-switch.test.ts`](../bridge/test/model-switch.test.ts) |
| `interrupt-round-trip` | Interrupt cancels an in-flight turn via `control_request`/`interrupt` and ends it `session.execution.interrupted`; an idle session answers `interrupted:false` | `verified` | `unit-verified only` — `interrupt-running-turn` | [`bridge/test/interrupt.test.ts`](../bridge/test/interrupt.test.ts) |
| `control-response-emission` | Every answered permission ask writes one control_response naming Maki's request id | `verified` | `journey-verified` — `allow-permission-once` | [`bridge/test/permission-egress.test.ts`](../bridge/test/permission-egress.test.ts) |
| `permission-reply-vocabulary` | Permission answers use the pinned vocabulary: `once` → bare allow, `always` → allow + `updatedPermissions` (AllowSession), `reject` → deny, plus `message` as DenyWithGuidance when a reason is given | `verified` | `unit-verified only` — `allow-permission-once`, `allow-permission-always`, `reject-permission-with-reason` | [`bridge/test/permission-egress.test.ts`](../bridge/test/permission-egress.test.ts) |
| `subagent-nesting` | Subagent transcript nesting via parent_tool_use_id | `verified` | `unit-verified only` — `open-subagent-session` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `maki-wire-envelope` | Maki's per-message envelope (top-level session_id + uuid) rides every wire frame; the bridge keeps the child on its OpenCode-minted session instead of rebinding on the envelope id | `verified` | `unit-verified only` — `open-subagent-session`, `send-prompt-stream-reply` | [`bridge/test/envelope.test.ts`](../bridge/test/envelope.test.ts) |
| `retry-scheduled` | Maki `system api_retry` surfaces as the pinned `session.retry.scheduled` event | `verified` | `unit-verified only` — `see-provider-retry` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `server-info-live` | `GET /api/info` reports the bridge's own pid and listen URL with the pinned version, and `capabilities.persistentPty: false` because the bridge serves no persistent PTY (the TUI offers terminals unless it is false: `tui/src/context/session-terminals.tsx` v2.0.32 L62–L77) | `verified` | `unit-verified only` — `boot-project-context`, `view-status`, `open-terminal-pane` | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `fs-list-sandbox` | `GET /api/fs/list` lists the sandbox workdir through the OpenShell exec transport, never a host directory the client names | `verified` | `unit-verified only` — `boot-project-context` | [`bridge/test/fs-list.test.ts`](../bridge/test/fs-list.test.ts) |
| `vcs-branch-live` | `GET /api/vcs` reports the sandbox checkout's current branch (the footer's `dir:branch`, `tui/src/component/prompt/index.tsx` v2.0.32 L1620) through the exec transport | `verified` | `unit-verified only` — `boot-project-context` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `project-identity-live` | `GET /api/project` and `GET /api/location` name one project id read from the sandbox checkout (its root commit, else `global`) and the project's name and vcs, instead of `sample` | `verified` | `unit-verified only` — `boot-project-context`, `change-working-directory` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `session-active-live` | `GET /api/session/active` maps every session with a turn in flight to `running` (server `handlers/session.ts` v2.0.32 L182–L188), so a reconnecting TUI shows the busy state | `verified` | `unit-verified only` — `boot-project-context`, `switch-session-tab` | [`bridge/test/session-active.test.ts`](../bridge/test/session-active.test.ts) |
| `mcp-server-status` | `GET /api/mcp` lists the MCP servers in the sandbox's Maki `mcp.toml` files (`maki-agent/src/mcp/config.rs` v0.6.4 L13) with their status — disabled, or connected/failed by whether the child advertises their tools — since `system.init.mcp_servers` is hardcoded `[]` (`sdk_mode.rs` v0.6.4 L623) | `verified` | `unit-verified only` — `boot-project-context`, `manage-mcp-servers` | [`bridge/test/mcp-status.test.ts`](../bridge/test/mcp-status.test.ts) |
| `skill-list-live` | `GET /api/skill` lists the skills the child's skill plugin discovers in the sandbox (`plugins/skill/init.lua` v0.6.4 L11–L30, L98–L130) | `verified` | `unit-verified only` — `boot-project-context`, `mention-skill-in-prompt` | [`bridge/test/skill-list.test.ts`](../bridge/test/skill-list.test.ts) |
| `model-catalog-live` | `GET /api/model`, `/api/provider` and `/api/integration` describe the models and providers `maki models` reports in the sandbox (`src/cmd/subcmd.rs` v0.6.4 L601–L630), with the child's announced model first and providers connected through their OpenShell profile | `verified` | `unit-verified only` — `boot-project-context`, `switch-model` | [`bridge/test/model-catalog.test.ts`](../bridge/test/model-catalog.test.ts) |
| `permission-reask` | `always` becomes Maki's session-scoped allow (the bridge caches nothing); it is not saved for the project as the TUI's copy says — the pinned SDK decoder has no project/global answer (sdk_mode.rs v0.6.4 L918–L927) | `degraded` · pin-blocked | — | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `agent-switch-state` | Session agent selection is recorded and reported while the Maki child is not re-tasked — the pinned inbound control subtypes are `initialize`, `interrupt`, `set_permission_mode`, `set_model`, with no `set_agent` (sdk_mode.rs v0.6.4 L818–L880) | `degraded` · pin-blocked | — | [`bridge/test/agent-switch.test.ts`](../bridge/test/agent-switch.test.ts) |
| `mid-turn-steering` | A prompt sent while a turn runs is admitted and queued: its turn starts after the running turn's result, and a `steer` is reported as `queue` (`session.inbox.delivery.changed`) — the pinned SDK sends each stdin `user` to the session's input queue, answered by its own later run, never into the running one (sdk_mode.rs v0.6.4 L682–L702, L763) | `degraded` · pin-blocked | — | [`bridge/test/steering.test.ts`](../bridge/test/steering.test.ts) |
| `prompt-attachments` | Image attachments (`data:image/png\|jpeg\|gif\|webp`) reach the child as base64 image blocks and are reported as inline files; PDF and other data URIs are dropped — the pinned inbound `user` decodes only text and image blocks (sdk_mode.rs v0.6.4 L786–L816) | `degraded` · pin-blocked | — | [`bridge/test/prompt-attachments.test.ts`](../bridge/test/prompt-attachments.test.ts) |
| `slash-commands` | Server slash commands stay empty: the pinned SDK mode announces `slash_commands: []` and discovers no custom commands (`sdk_mode.rs` v0.6.4 L624; `SdkParams` L542–L557 has no commands field), so a listed command would POST `session.command` for a command the child cannot run | `degraded` · pin-blocked | — | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |

### Out of scope (2)

| Id | Feature | Status | Journeys | Evidence |
| --- | --- | --- | --- | --- |
| `sdk-control-handshake` | SDK control handshake (`initialize` / `set_permission_mode`) is not sent: the pinned child serves control requests without it (sdk_mode.rs v0.6.4 L818–L827) and no TUI behavior depends on it — record, don't build | `unverified` | — | [`openspec/changes/archive/2026-10-23-add-interrupt-forwarding/evidence/cross-map.md`](../openspec/changes/archive/2026-10-23-add-interrupt-forwarding/evidence/cross-map.md) |
| `prompt-file-mentions` | `file://` attachments (@-mentions) are not read or forwarded: the bridge reads no host path on a client's behalf; the mention stays in the prompt text and Maki reads its own sandbox workdir | `unverified` | — | [`bridge/test/prompt-attachments.test.ts`](../bridge/test/prompt-attachments.test.ts) |

### Fixture provenance

Rows citing these notes are proved against fixtures that were authored or spliced from the pinned source, not captured whole from a live run.

1. `maki-error.jsonl` is mixed (assistant output is captured; the error_during_execution result shape is source-derived (sdk_mode.rs v0.6.4 L995-L1000)); `maki-retry.jsonl` is mixed (the two spliced frames are source-derived (error is a plain string per the pin); the surrounding turn is captured); wire shape source-derived: `maki-stream.jsonl` is authored (never captured from a live streaming provider; see the shortcut note in bridge/src/translator.ts); wire shape source-derived: `maki-subagent.jsonl` is authored (never captured from a live subagent turn)

## Journeys

Statuses: `unrecorded` (no reference recording yet), `referenced` (a reference recording of real OpenCode exists, the Maki side is not yet compared), `parity` (both sides match at every checkpoint), `diverges` (the journey completes with at least one differing checkpoint), `broken` (the Maki side cannot complete it).

Reachable journeys: **61 of 67** (55 `unrecorded`, 0 `referenced`, 6 `parity`, 0 `diverges`, 0 `broken`). Native parity score: **9.8%** (6 of 61 reachable journeys at `parity`).

### Reachable (61)

| Slug | Journey | Area | Status | Live | Evidence | Accepted differences |
| --- | --- | --- | --- | --- | --- | --- |
| `boot-project-context` | Boot and see the project context | navigation | `unrecorded` | — | — | — |
| `show-command-palette` | Find and run a command from the palette | navigation | `unrecorded` | — | — | — |
| `open-recent-session-or-project` | Open a recent session or project | navigation | `unrecorded` | — | — | — |
| `toggle-sidebar` | Toggle the session sidebar | navigation | `unrecorded` | — | — | — |
| `scroll-transcript` | Scroll through a long transcript | navigation | `unrecorded` | — | — | — |
| `open-help` | Open the help dialog | navigation | `unrecorded` | — | — | — |
| `view-status` | View the server and session status | navigation | `unrecorded` | — | — | — |
| `switch-theme` | Switch the theme | navigation | `unrecorded` | — | — | — |
| `open-settings` | Open settings | navigation | `unrecorded` | — | — | — |
| `view-debug-info` | View debug information | navigation | `unrecorded` | — | — | — |
| `view-usage-statistics` | View usage statistics | navigation | `unrecorded` | — | — | — |
| `exit-application` | Exit the application | navigation | `unrecorded` | — | — | — |
| `switch-session-tab` | Switch between open sessions | session | `unrecorded` | — | — | — |
| `close-reopen-session-tab` | Close a session tab and reopen it | navigation | `unrecorded` | — | — | — |
| `pin-session` | Pin a session in the list | session | `unrecorded` | — | — | — |
| `clear-session` | Clear the current session | session | `unrecorded` | — | — | — |
| `fork-session-from-message` | Fork a session from a message | session | `unrecorded` | — | — | — |
| `jump-to-message` | Jump to a message in the transcript | session | `unrecorded` | — | — | — |
| `interrupt-running-turn` | Interrupt a running turn | session | `unrecorded` | — | — | — |
| `queue-prompt-while-running` | Queue a prompt while a turn runs | session | `unrecorded` | — | — | — |
| `manage-queued-prompts` | Manage queued prompts | session | `unrecorded` | — | — | — |
| `compact-session` | Compact a long session | session | `unrecorded` | — | — | — |
| `undo-previous-message` | Undo the previous message | session | `unrecorded` | — | — | — |
| `redo-reverted-message` | Redo a reverted message | session | `unrecorded` | — | — | — |
| `copy-session-content` | Copy session content | session | `unrecorded` | — | — | — |
| `export-session-transcript` | Export a session transcript | session | `unrecorded` | — | — | — |
| `background-blocking-tools` | Background a blocking tool | session | `unrecorded` | — | — | — |
| `open-subagent-session` | Open a subagent session | session | `unrecorded` | — | — | — |
| `ask-side-question` | Ask a side question | session | `unrecorded` | — | — | — |
| `view-session-diff` | Review the session diff | session | `unrecorded` | — | — | — |
| `open-terminal-pane` | Open a terminal pane | session | `unrecorded` | — | — | — |
| `view-shell-output` | View a shell tool's output | session | `unrecorded` | — | — | — |
| `see-failed-turn-error` | See why a turn failed | session | `unrecorded` | — | — | — |
| `see-provider-retry` | See a provider retry in progress | session | `unrecorded` | — | — | — |
| `recall-prompt-history` | Recall an earlier prompt from history | prompt | `unrecorded` | — | — | — |
| `attach-image-to-prompt` | Attach an image to a prompt | prompt | `unrecorded` | — | — | — |
| `mention-file-in-prompt` | Mention a file in a prompt | prompt | `unrecorded` | — | — | — |
| `mention-skill-in-prompt` | Mention a skill in a prompt | prompt | `unrecorded` | — | — | — |
| `open-external-editor` | Compose a prompt in an external editor | prompt | `unrecorded` | — | — | — |
| `stash-prompt` | Stash and restore a prompt | prompt | `unrecorded` | — | — | — |
| `adjust-transcript-display` | Adjust the transcript display | session | `unrecorded` | — | — | — |
| `allow-permission-always` | Allow matching tool calls for the session | permission | `unrecorded` | — | — | — |
| `reject-permission-with-reason` | Reject a tool with a reason | permission | `unrecorded` | — | — | — |
| `answer-mcp-form` | Answer an MCP form | permission | `unrecorded` | — | — | — |
| `answer-agent-question` | Answer a question the agent asks | permission | `unrecorded` | — | — | — |
| `switch-model` | Switch the model | model | `unrecorded` | — | — | — |
| `switch-agent` | Switch the agent | model | `unrecorded` | — | — | — |
| `switch-model-variant` | Switch the model variant | model | `unrecorded` | — | — | — |
| `manage-mcp-servers` | Manage MCP servers | tools | `unrecorded` | — | — | — |
| `manage-plugins` | Manage plugins | tools | `unrecorded` | — | — | — |
| `see-file-reads-and-searches` | See the files the agent read and searched | tools | `unrecorded` | — | — | — |
| `see-file-edit-diff` | See the agent edit a file as a diff | tools | `unrecorded` | — | — | — |
| `manage-workspaces` | Manage workspaces | files | `unrecorded` | — | — | — |
| `change-working-directory` | Change the working directory | files | `unrecorded` | — | — | — |
| `reload-configuration` | Reload the configuration | config | `unrecorded` | — | — | — |
| `new-session` | Create a new session | session | `parity` | `parity` | reference: [`bridge/test/journeys/new-session/reference/`](../bridge/test/journeys/new-session/reference/) · maki: [`bridge/test/journeys/new-session/maki/`](../bridge/test/journeys/new-session/maki/) · diff: [`bridge/test/journeys/new-session/diff.json`](../bridge/test/journeys/new-session/diff.json) | session-created: the tab and list show the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make; first-prompt: the tab and list show the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make |
| `resume-session-history` | Resume a session and see its history | session | `parity` | `parity` | reference: [`bridge/test/journeys/resume-session-history/reference/`](../bridge/test/journeys/resume-session-history/reference/) · maki: [`bridge/test/journeys/resume-session-history/maki/`](../bridge/test/journeys/resume-session-history/maki/) · diff: [`bridge/test/journeys/resume-session-history/diff.json`](../bridge/test/journeys/resume-session-history/diff.json) | session-list: the list and tab show the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make; history-visible: the list and tab show the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make |
| `rename-session` | Rename a session | session | `parity` | `parity` | reference: [`bridge/test/journeys/rename-session/reference/`](../bridge/test/journeys/rename-session/reference/) · maki: [`bridge/test/journeys/rename-session/maki/`](../bridge/test/journeys/rename-session/maki/) · diff: [`bridge/test/journeys/rename-session/diff.json`](../bridge/test/journeys/rename-session/diff.json) | rename-dialog: the dialog is prefilled with the session's current title, which is Maki's: the tab and list show the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make |
| `delete-session` | Delete a session | session | `parity` | `parity` | reference: [`bridge/test/journeys/delete-session/reference/`](../bridge/test/journeys/delete-session/reference/) · maki: [`bridge/test/journeys/delete-session/maki/`](../bridge/test/journeys/delete-session/maki/) · diff: [`bridge/test/journeys/delete-session/diff.json`](../bridge/test/journeys/delete-session/diff.json) | delete-confirm: the tab and list show the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make |
| `send-prompt-stream-reply` | Send a prompt and watch the reply stream | prompt | `parity` | `parity` | reference: [`bridge/test/journeys/send-prompt-stream-reply/reference/`](../bridge/test/journeys/send-prompt-stream-reply/reference/) · maki: [`bridge/test/journeys/send-prompt-stream-reply/maki/`](../bridge/test/journeys/send-prompt-stream-reply/maki/) · diff: [`bridge/test/journeys/send-prompt-stream-reply/diff.json`](../bridge/test/journeys/send-prompt-stream-reply/diff.json) | streamed: the tab shows the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make |
| `allow-permission-once` | Allow a tool once | permission | `parity` | `parity` | reference: [`bridge/test/journeys/allow-permission-once/reference/`](../bridge/test/journeys/allow-permission-once/reference/) · maki: [`bridge/test/journeys/allow-permission-once/maki/`](../bridge/test/journeys/allow-permission-once/maki/) · diff: [`bridge/test/journeys/allow-permission-once/diff.json`](../bridge/test/journeys/allow-permission-once/diff.json) | permission-prompt: Maki titles a session only when its first run is recorded (maki-agent session.rs v0.6.4 L143–L166, L203–L217), so mid-run the tab correctly has no title yet; OpenCode titles in parallel with the first model call and the mock answers "Journey"; allowed: the tab shows the title Maki gives a session, its first prompt cut by generate_title (maki-storage sessions.rs v0.6.4 L677–L695), written when the first run is recorded (maki-agent session.rs L143–L166); the reference title "Journey" is the mock model's answer to OpenCode's title request, a model-generated title Maki does not make; the silent command shows Maki's real bash result "Exit code: 0" (plugins/bash/init.lua v0.6.4 L407–L412), where OpenCode's shell tool prints "(no output)" (core/src/shell.ts v2.0.32 L249) — each TUI renders its own tool's result |

### Out of scope (6)

| Slug | Journey | Area | Status | Live | Evidence | Accepted differences |
| --- | --- | --- | --- | --- | --- | --- |
| `open-documentation` | Open the documentation | navigation | `unrecorded` | — | — | — |
| `pair-device` | Pair a device | navigation | `unrecorded` | — | — | — |
| `connect-integration` | Connect a provider integration | config | `unrecorded` | — | — | — |
| `update-opencode` | Update OpenCode | config | `unrecorded` | — | — | — |
| `restart-service` | Restart the OpenCode service | config | `unrecorded` | — | — | — |
| `view-release-highlights` | View release highlights | config | `unrecorded` | — | — | — |

## Version matrix

| Component | Pinned | Evidence |
| --- | --- | --- |
| OpenCode (pinned contract) | 2.0.32 | [`bridge/src/openapi-2.0.32.json`](../bridge/src/openapi-2.0.32.json) |
| Maki SDK (wire) | 0.6.4 | [`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/e2e-note.md`](../openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/e2e-note.md) |
| Sandbox transport | OpenShell sandbox exec (stdio), non-root sandbox user, no secrets via --env; bridge binds 127.0.0.1 | [`bin/maki-oss`](../bin/maki-oss) |
