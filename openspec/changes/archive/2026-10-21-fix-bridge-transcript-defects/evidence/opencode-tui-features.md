# OpenCode TUI features (contract 2.0.32)

The OpenCode side of the cross-map. Sources: the vendored
`bridge/src/openapi-2.0.32.json` (119 paths), the archived TUI route
inventory (`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/tui-route-inventory.md`,
33 routes measured against the stub across boot/prompt/permission phases),
and OpenCode's own docs (https://opencode.ai/docs/server/). "Measured" means
the real TUI called it during a capture; "contract-only" means the path
exists in the pinned spec but was never exercised by those captures.

## Boot and session management

| Feature | Routes | Coverage |
| --- | --- | --- |
| Server handshake | `GET /api/event` (`server.connected` first), `GET /api/info`, `/api/experimental/migration/v1` polling | measured |
| Location/project | `GET /api/location`, `/api/project`, `/api/vcs` | measured (faked) |
| Config/plugins | `GET /api/config`, `/api/plugin`, `/api/integration`, `/api/mcp`, `/api/mcp/resource`, `/api/reference`, `/api/skill`, `/api/shell`, `/api/form`, `/api/fs/list` | measured (faked) |
| Agent/model catalogs | `GET /api/agent`, `/api/model`, `/api/provider` | measured (faked) |
| Session list/read/delete | `GET /api/session`, `/api/session/active`, `POST /api/session`, `GET/DELETE /api/session/{id}` | measured (live) |
| Session rename/move | `PATCH /api/session/{id}`, `POST /api/session/{id}/move` | contract-only |
| Message history replay | `GET /api/session/{id}/message`, `.../message/{messageID}` | measured as polling only; body faked empty (deferred) |

## Turn and transcript

| Feature | Routes / events | Coverage |
| --- | --- | --- |
| Prompt submission | `POST /api/session/{id}/prompt` (`delivery: "steer"` shape) | measured (live) |
| Turn boundaries | `session.execution.*`, `session.step.*` frames | measured (live) |
| Assistant parts | `session.text.*`, `session.reasoning.*`, `session.tool.input.*`, `session.tool.called`, `session.tool.success/failed` | measured (live) |
| User-role message frames | `session.inbox.enqueued` with `data.item:{type:"user",payload:{text},delivery}` (pinned live in task 2.1; see `cross-map.md`) | **defect: absent/misordered** (`message-order-inversion`) |
| Streaming deltas | `stream_event` → `session.text.delta` etc. | implemented, not measured (maki side unverified) |
| Model identity | model on `session.step.started`, `/api/model` list, status line | **defect: synthesized** (`synthesized-model-name`) |
| Model switch mid-session | `POST /api/session/{id}/model` | measured as accepted; no effect behind it (maki supports `set_model`) |
| Agent switch mid-session | `POST /api/session/{id}/agent` | measured as accepted; faked |
| Commands palette | `GET /api/command` | measured (faked); `POST /api/session/{id}/command` contract-only |
| Interrupt / abort | `POST /api/session/{id}/interrupt` | contract-only (maki has `control_cancel_request`) |
| Steering (queue a message mid-turn) | inbound `user` while running | contract-only on both sides |
| Compact / context | `POST /api/session/{id}/compact`, `GET /api/session/{id}/context` | contract-only (maki has `/compact` on its own TUI only) |
| Revert / rewind | `POST /api/session/{id}/revert`, `/revert/stage`, `/revert/commit` | contract-only |
| Fork | `POST /api/session/{id}/fork` | deferred (bridge answers minimal) |
| Diff view | `GET /api/session/{id}/diff`, `/api/vcs/diff`, `/api/vcs/status` | contract-only |

## Permissions

| Feature | Routes / events | Coverage |
| --- | --- | --- |
| Ask/reply round trip | `permission.asked` / `permission.replied`, `POST /api/session/{id}/permission/{requestID}/reply` | measured (live), offline-verified |
| Reply vocabulary | `once \| always \| reject` → maki `allow \| deny` | measured; `always` degrades to re-ask (`permission-reask` row) |
| Saved permission rules | `GET/PUT/DELETE /api/permission/saved`, `POST /api/permission/request` | contract-only (no maki counterpart) |

## Out of the bridge's scope (recorded for completeness)

PTY/shell surfaces (`/api/pty/**`, `/api/shell/{id}`, persistent-pty,
terminal snapshots), integrations/credentials OAuth flows
(`/api/integration/{id}/connect/**`, `/api/credential/**`), voice/pair/web
search admin (`/api/voice/session`, `/api/pair`, `/api/websearch/**`),
experimental FS write and generate (`/api/experimental/fs/write`,
`/api/experimental/generate`, `/api/session/{id}/generate`),
worktrees (`/api/worktree/**`), stats/export/import
(`/api/experimental/session/{stats,export,import}`), instructions and skills
per session, background tasks (`/api/session/{id}/background`), inbox
(measured as polling, body faked), forms (measured as polling, body faked).

## Scenario seeds taken from this inventory

- interrupt round trip (`interrupt` ↔ `control_cancel_request`)
- mid-session model switch actually switching the maki child (`set_model`)
- message replay on session select (needs a transcript store)
- steering a working turn (queue → inbound `user`)
- `always` reply honoring session scope if/when maki's wire grows it
