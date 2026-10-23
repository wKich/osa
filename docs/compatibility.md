# OpenCode TUI bridge — compatibility

Generated from `bridge/compat/statuses.json` and `bridge/defects.json` by `scripts/gen-compat.ts`. Do not edit by hand — run `make compat` to regenerate and `make compat-drift` to check the pinned contract against the installed OpenCode.

## Burndown

Reachable surface: **33 of 143 routes** (19 `served-live`, 10 `served-faked`, 4 `deferred`, 0 `unhandled`) and **39 of 41 features** (33 `verified`, 1 `unverified`, 5 `degraded` (5 pin-blocked), 0 `buggy`). Out of scope: 110 routes, 2 features. Open defects: **0**.

Next (first 1 of 1 reachable, unblocked, not `verified`; ids match the feature tables):

1. `model-catalog-live` — `GET /api/model`, `/api/provider` and `/api/integration` describe the models and providers `maki models` reports in the sandbox (`src/cmd/subcmd.rs` v0.6.4 L601–L630), with the child's announced model first and providers connected through their OpenShell profile (`unverified`)

Untriaged reachable routes: **0**.

## Served routes

Statuses: `served-live` (real state behind the route), `served-faked` (answered from the pinned spec with synthesized values), `deferred` (spec-valid minimal answer, surface not implemented), `unhandled` (outside the pinned contract: answered 404).

### Reachable (33)

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
| `GET /api/project` | `served-live` | live — `project-identity-live` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `GET /api/location` | `served-live` | live — `project-identity-live` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `GET /api/fs/list` | `served-live` | live — `fs-list-sandbox` | [`bridge/test/fs-list.test.ts`](../bridge/test/fs-list.test.ts) |
| `GET /api/skill` | `served-live` | live — `skill-list-live` | [`bridge/test/skill-list.test.ts`](../bridge/test/skill-list.test.ts) |
| `GET /api/mcp` | `served-live` | live — `mcp-server-status` | [`bridge/test/mcp-status.test.ts`](../bridge/test/mcp-status.test.ts) |
| `GET /api/vcs` | `served-live` | live — `vcs-branch-live` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `GET /api/session/active` | `served-live` | live — `session-active-live` | [`bridge/test/session-active.test.ts`](../bridge/test/session-active.test.ts) |
| `POST /api/session/{sessionID}/interrupt` | `served-live` | live | [`bridge/test/interrupt.test.ts`](../bridge/test/interrupt.test.ts) |
| `GET /api/model` | `served-faked` | in progress — `model-catalog-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/agent` | `served-faked` | accept — Maki at v0.6.4 runs one agent and has no named-agent surface — `initialize` ignores `agents` (sdk_mode.rs L828–L839) and there is no `set_agent` (L818–L880) — so one primary `build` entry, Maki's name for its default mode, is the true list; the TUI needs exactly one primary agent to submit (`prompt/index.tsx` v2.0.32 L1159–L1160) | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/config` | `served-faked` | accept — the response is the list of OpenCode config documents (`schema/src/config.ts` v2.0.32 L117–L135) and the bridge loads none — Maki's TOML/Lua config is not one; the TUI reads only the last document's `info.model` as a default (`tui/src/context/local.tsx` L173–L182), and the true default is the child's announced model, so an empty list is correct | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/command` | `served-faked` | pin — `slash-commands` | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/reference` | `served-faked` | accept — references are `@` aliases declared in OpenCode config documents, and the bridge has none (`GET /api/config` is an empty list); Maki has no alias concept at v0.6.4, so the empty list is the true set | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/provider` | `served-faked` | in progress — `model-catalog-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/integration` | `served-faked` | in progress — `model-catalog-live` | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/plugin` | `served-faked` | accept — the list holds OpenCode server plugins (`source`, `features`, `state`) and the bridge loads none; Maki's Lua plugins run inside the child and are not OpenCode plugins, so the empty list is the true set | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/form` | `served-faked` | accept — forms are pending MCP elicitations; the pinned Maki SDK wire has no elicitation message (its only outbound ask is `control_request` `can_use_tool`, `sdk_mode.rs` v0.6.4 L1155), so no global form can ever be pending and the empty list is the true state | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/experimental/migration/v1` | `served-faked` | accept — the bridge keeps no OpenCode data store, so there is no migration to run: `completed` is the true status, and the only one that ends the TUI's 1s poll without a spinner or an error toast (`tui/src/component/migration-overlay.tsx` v2.0.32 L22–L26) | [`bridge/test/fixtures/bridge-requests.jsonl`](../bridge/test/fixtures/bridge-requests.jsonl) |
| `GET /api/mcp/resource` | `deferred` | deferred | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/shell` | `deferred` | deferred | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/experimental/session/{sessionID}/terminal` | `deferred` | deferred | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `GET /api/session/{sessionID}/form` | `deferred` | deferred | [`bridge/test/deferred-session-surfaces.test.ts`](../bridge/test/deferred-session-surfaces.test.ts) |

### Out of scope (110)

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
| `PATCH /api/session/{sessionID}` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
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
| `POST /api/session/{sessionID}/view` | `served-faked` | [`bridge/src/spec-answers.ts`](../bridge/src/spec-answers.ts) |
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
| `GET /api/session/{sessionID}/message` | `deferred` | [`bridge/test/deferred-session-surfaces.test.ts`](../bridge/test/deferred-session-surfaces.test.ts) |
| `GET /api/session/{sessionID}/inbox` | `deferred` | [`bridge/test/deferred-session-surfaces.test.ts`](../bridge/test/deferred-session-surfaces.test.ts) |
| `POST /api/session/{sessionID}/fork` | `deferred` | [`bridge/src/bridge.ts`](../bridge/src/bridge.ts) |

## Wire features

Statuses: `verified` (an offline test or committed fixture proves it), `degraded` (works, with a limitation recorded in the evidence), `unverified` (no evidence yet), `buggy` (an open inventory entry in `bridge/defects.json` forces this status until the fix flips it). `pin-blocked` marks a gap that needs an upstream wire change.

### Reachable (39)

| Id | Feature | Status | Evidence |
| --- | --- | --- | --- |
| `sse-handshake` | SSE stream starts with server.connected | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `sse-bare-data-frames` | SSE frames are bare data: lines (no event:/id: lines) | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `sse-idle-keepalive` | SSE stream survives idle gaps: the TUI does not auto-reconnect mid-session | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `minted-id-patterns` | Minted ids match the OpenCode patterns (evt_/ses_/msg_/per_) | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `durable-envelope` | Durable events carry a complete durable envelope keyed to the session | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `openapi-contract` | Response bodies validate against the vendored OpenAPI 2.0.32 | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `session-crud` | Session create/read/list/delete with child teardown (no orphan processes) | `verified` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `deferred-session-surface-contract` | Deferred session message/inbox/form reads answer schema-valid empty lists and 404 unknown sessions, never a phantom row | `verified` | [`bridge/test/deferred-session-surfaces.test.ts`](../bridge/test/deferred-session-surfaces.test.ts) |
| `session-isolation` | Concurrent sessions keep their children and transcripts apart | `verified` | [`bridge/test/session-isolation.test.ts`](../bridge/test/session-isolation.test.ts) |
| `prompt-translation` | Recorded Maki turns translate to the committed golden frames | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `tool-failure-mapping` | Failing and permission-denied tools map to session.tool.failed | `verified` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `turn-failure-mapping` | A failed Maki turn maps to session.execution.failed with the wire's message, never to success | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `turn-abort-mapping` | A Maki child exiting mid-turn fails the turn exactly once (no success) and later prompts are refused with 503 | `verified` | [`bridge/test/turn-abort.test.ts`](../bridge/test/turn-abort.test.ts) |
| `permission-round-trip` | Permission ask/reply round trip runs offline over the child seam | `verified` | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `stream-deltas` | stream_event deltas translate into part delta frames | `verified` | [`bridge/test/fixtures/maki-stream-live.jsonl`](../bridge/test/fixtures/maki-stream-live.jsonl) |
| `transcript-order` | User prompts render before the assistant output they caused | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `model-identity` | Session events carry Maki's real model name | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `model-list-refresh` | The location model list refreshes when the child announces, so its model stays selectable | `verified` | [`bridge/test/contract.test.ts`](../bridge/test/contract.test.ts) |
| `api-retry-tolerance` | System api_retry frames are tolerated without disturbing the transcript | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `mid-session-model-switch` | Mid-session model selection is forwarded as `set_model`; the child's success ack moves the reported model (`model.updated`), a refused model leaves the announced one | `verified` | [`bridge/test/model-switch.test.ts`](../bridge/test/model-switch.test.ts) |
| `interrupt-round-trip` | Interrupt cancels an in-flight turn via `control_request`/`interrupt` and ends it `session.execution.interrupted`; an idle session answers `interrupted:false` | `verified` | [`bridge/test/interrupt.test.ts`](../bridge/test/interrupt.test.ts) |
| `control-response-emission` | Every answered permission ask writes one control_response naming Maki's request id | `verified` | [`bridge/test/permission-egress.test.ts`](../bridge/test/permission-egress.test.ts) |
| `permission-reply-vocabulary` | Permission answers use the pinned vocabulary: `once` → bare allow, `always` → allow + `updatedPermissions` (AllowSession), `reject` → deny, plus `message` as DenyWithGuidance when a reason is given | `verified` | [`bridge/test/permission-egress.test.ts`](../bridge/test/permission-egress.test.ts) |
| `subagent-nesting` | Subagent transcript nesting via parent_tool_use_id | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `maki-wire-envelope` | Maki's per-message envelope (top-level session_id + uuid) rides every wire frame; the bridge keeps the child on its OpenCode-minted session instead of rebinding on the envelope id | `verified` | [`bridge/test/envelope.test.ts`](../bridge/test/envelope.test.ts) |
| `retry-scheduled` | Maki `system api_retry` surfaces as the pinned `session.retry.scheduled` event | `verified` | [`bridge/test/golden.test.ts`](../bridge/test/golden.test.ts) — fixture provenance: [note 1](#fixture-provenance) |
| `server-info-live` | `GET /api/info` reports the bridge's own pid and listen URL with the pinned version, and `capabilities.persistentPty: false` because the bridge serves no persistent PTY (the TUI offers terminals unless it is false: `tui/src/context/session-terminals.tsx` v2.0.32 L62–L77) | `verified` | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |
| `fs-list-sandbox` | `GET /api/fs/list` lists the sandbox workdir through the OpenShell exec transport, never a host directory the client names | `verified` | [`bridge/test/fs-list.test.ts`](../bridge/test/fs-list.test.ts) |
| `vcs-branch-live` | `GET /api/vcs` reports the sandbox checkout's current branch (the footer's `dir:branch`, `tui/src/component/prompt/index.tsx` v2.0.32 L1620) through the exec transport | `verified` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `project-identity-live` | `GET /api/project` and `GET /api/location` name one project id read from the sandbox checkout (its root commit, else `global`) and the project's name and vcs, instead of `sample` | `verified` | [`bridge/test/sandbox-git.test.ts`](../bridge/test/sandbox-git.test.ts) |
| `session-active-live` | `GET /api/session/active` maps every session with a turn in flight to `running` (server `handlers/session.ts` v2.0.32 L182–L188), so a reconnecting TUI shows the busy state | `verified` | [`bridge/test/session-active.test.ts`](../bridge/test/session-active.test.ts) |
| `mcp-server-status` | `GET /api/mcp` lists the MCP servers in the sandbox's Maki `mcp.toml` files (`maki-agent/src/mcp/config.rs` v0.6.4 L13) with their status — disabled, or connected/failed by whether the child advertises their tools — since `system.init.mcp_servers` is hardcoded `[]` (`sdk_mode.rs` v0.6.4 L623) | `verified` | [`bridge/test/mcp-status.test.ts`](../bridge/test/mcp-status.test.ts) |
| `skill-list-live` | `GET /api/skill` lists the skills the child's skill plugin discovers in the sandbox (`plugins/skill/init.lua` v0.6.4 L11–L30, L98–L130) | `verified` | [`bridge/test/skill-list.test.ts`](../bridge/test/skill-list.test.ts) |
| `model-catalog-live` | `GET /api/model`, `/api/provider` and `/api/integration` describe the models and providers `maki models` reports in the sandbox (`src/cmd/subcmd.rs` v0.6.4 L601–L630), with the child's announced model first and providers connected through their OpenShell profile | `unverified` | [`bridge/test/captures/tui-last-requests.jsonl`](../bridge/test/captures/tui-last-requests.jsonl) |
| `permission-reask` | `always` becomes Maki's session-scoped allow (the bridge caches nothing); it is not saved for the project as the TUI's copy says — the pinned SDK decoder has no project/global answer (sdk_mode.rs v0.6.4 L918–L927) | `degraded` · pin-blocked | [`bridge/test/session-api.test.ts`](../bridge/test/session-api.test.ts) |
| `agent-switch-state` | Session agent selection is recorded and reported while the Maki child is not re-tasked — the pinned inbound control subtypes are `initialize`, `interrupt`, `set_permission_mode`, `set_model`, with no `set_agent` (sdk_mode.rs v0.6.4 L818–L880) | `degraded` · pin-blocked | [`bridge/test/agent-switch.test.ts`](../bridge/test/agent-switch.test.ts) |
| `mid-turn-steering` | A prompt sent while a turn runs is admitted and queued: its turn starts after the running turn's result, and a `steer` is reported as `queue` (`session.inbox.delivery.changed`) — the pinned SDK sends each stdin `user` to the session's input queue, answered by its own later run, never into the running one (sdk_mode.rs v0.6.4 L682–L702, L763) | `degraded` · pin-blocked | [`bridge/test/steering.test.ts`](../bridge/test/steering.test.ts) |
| `prompt-attachments` | Image attachments (`data:image/png\|jpeg\|gif\|webp`) reach the child as base64 image blocks and are reported as inline files; PDF and other data URIs are dropped — the pinned inbound `user` decodes only text and image blocks (sdk_mode.rs v0.6.4 L786–L816) | `degraded` · pin-blocked | [`bridge/test/prompt-attachments.test.ts`](../bridge/test/prompt-attachments.test.ts) |
| `slash-commands` | Server slash commands stay empty: the pinned SDK mode announces `slash_commands: []` and discovers no custom commands (`sdk_mode.rs` v0.6.4 L624; `SdkParams` L542–L557 has no commands field), so a listed command would POST `session.command` for a command the child cannot run | `degraded` · pin-blocked | [`bridge/test/boot-surface.test.ts`](../bridge/test/boot-surface.test.ts) |

### Out of scope (2)

| Id | Feature | Status | Evidence |
| --- | --- | --- | --- |
| `sdk-control-handshake` | SDK control handshake (`initialize` / `set_permission_mode`) is not sent: the pinned child serves control requests without it (sdk_mode.rs v0.6.4 L818–L827) and no TUI behavior depends on it — record, don't build | `unverified` | [`openspec/changes/archive/2026-10-23-add-interrupt-forwarding/evidence/cross-map.md`](../openspec/changes/archive/2026-10-23-add-interrupt-forwarding/evidence/cross-map.md) |
| `prompt-file-mentions` | `file://` attachments (@-mentions) are not read or forwarded: the bridge reads no host path on a client's behalf; the mention stays in the prompt text and Maki reads its own sandbox workdir | `unverified` | [`bridge/test/prompt-attachments.test.ts`](../bridge/test/prompt-attachments.test.ts) |

### Fixture provenance

Rows citing these notes are proved against fixtures that were authored or spliced from the pinned source, not captured whole from a live run.

1. `maki-error.jsonl` is mixed (assistant output is captured; the error_during_execution result shape is source-derived (sdk_mode.rs v0.6.4 L995-L1000)); `maki-retry.jsonl` is mixed (the two spliced frames are source-derived (error is a plain string per the pin); the surrounding turn is captured); wire shape source-derived: `maki-stream.jsonl` is authored (never captured from a live streaming provider; see the shortcut note in bridge/src/translator.ts); wire shape source-derived: `maki-subagent.jsonl` is authored (never captured from a live subagent turn)

## Version matrix

| Component | Pinned | Evidence |
| --- | --- | --- |
| OpenCode (pinned contract) | 2.0.32 | [`bridge/src/openapi-2.0.32.json`](../bridge/src/openapi-2.0.32.json) |
| Maki SDK (wire) | 0.6.4 | [`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/e2e-note.md`](../openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/e2e-note.md) |
| Sandbox transport | OpenShell sandbox exec (stdio), non-root sandbox user, no secrets via --env; bridge binds 127.0.0.1 | [`bin/maki-oss`](../bin/maki-oss) |
