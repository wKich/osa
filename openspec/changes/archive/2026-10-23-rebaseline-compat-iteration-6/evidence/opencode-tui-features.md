# OpenCode TUI features (contract 2.0.32)

The OpenCode side of the cross-map. Sources: the vendored
`bridge/src/openapi-2.0.32.json` (119 paths), the archived TUI route
inventory (`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/tui-route-inventory.md`,
33 routes measured against the stub across boot/prompt/permission phases),
and OpenCode's own docs (https://opencode.ai/docs/server/). "Measured" means
the real TUI called it during a capture; "contract-only" means the path
exists in the pinned spec but was never exercised by those captures.

Copied forward from the iteration-2 archive and re-read at the pin in
iteration 3. Sections marked **(+)** were added by the iteration-2 rebaseline
enumeration from `packages/schema/src/session-event.ts` at tag `v2.0.32`;
rows marked **(i3)** are this iteration's corrections. Every added row cites a
line at that tag.

## Boot and session management

| Feature | Routes | Coverage |
| --- | --- | --- |
| Server handshake | `GET /api/event` (`server.connected` first), `GET /api/info`, `/api/experimental/migration/v1` polling | measured |
| Location/project | `GET /api/location`, `/api/project`, `/api/vcs` | measured (faked); **(i6)** `project.id` keys the project/worktree pickers (`tui/src/component/session-tabs.tsx` L587–L592), `branch.current` is the footer label (`prompt/index.tsx` L1620), refreshed by `vcs.branch.updated` (`schema/src/vcs-event.ts`) |
| Config/plugins | `GET /api/config`, `/api/plugin`, `/api/integration`, `/api/mcp`, `/api/mcp/resource`, `/api/reference`, `/api/skill`, `/api/shell`, `/api/form`, `/api/fs/list` | measured (faked); **(i6)** all awaited together by the location sync (`client/src/solid/data.ts` L1944–L1960); consumers per route in `cross-map.md` iteration-6 triage |
| Agent/model catalogs | `GET /api/agent`, `/api/model`, `/api/provider` | measured (faked); **(i6)** submit needs a primary agent and a model in the list (`prompt/index.tsx` L1159–L1164) |
| Session list/read/delete | `GET /api/session`, `/api/session/active`, `POST /api/session`, `GET/DELETE /api/session/{id}` | measured (live) |
| Session rename/move | `PATCH /api/session/{id}`, `POST /api/session/{id}/move` | contract-only (the TUI has not called them); the bridge fakes both |
| Message history replay | `GET /api/session/{id}/message`, `.../message/{messageID}` | measured as polling only; body faked empty (deferred) |
| Session terminal snapshot | `GET /api/experimental/session/{id}/terminal` **(i3)** | measured: called at boot, answered `200`/`data: []` (`bridge/test/captures/tui-last-requests.jsonl`) |

## Turn and transcript

| Feature | Routes / events | Coverage |
| --- | --- | --- |
| Prompt submission | `POST /api/session/{id}/prompt` (`delivery: "steer"` shape) | measured (live) |
| Prompt attachments **(+)** **(i4)** | `files[]` on the prompt POST: pasted images/PDFs as `data:` URIs (`tui/src/component/prompt/local-attachment.ts` L55, L167), @-mentions as `file://` URIs (`autocomplete.tsx` L249–L268); delivered files come back as `Prompt.FileAttachment` `{data, mime, source}` (`schema/src/prompt.ts` L26–L34) | contract-only; images forwarded, PDFs dropped (pin), `file://` not read (`prompt-attachments`, `prompt-file-mentions`) |
| Turn boundaries | `session.execution.*`, `session.step.*` frames | measured (live) |
| Assistant parts | `session.text.*`, `session.reasoning.*`, `session.tool.input.*`, `session.tool.called`, `session.tool.success/failed` | measured (live) |
| User-role message frames | `session.inbox.enqueued` with `data.item:{type:"user",payload:{text},delivery}` (pinned live in task 2.1; see `cross-map.md`) | verified; ordering defect fixed **(i3)** (`bridge/test/golden.test.ts`) |
| Streaming deltas | `stream_event` → `session.text.delta` etc. | verified by the live Maki delta capture **(i3)** (`bridge/test/fixtures/maki-stream-live.jsonl`) |
| Model identity | model on `session.step.started`, `/api/model` list, status line | verified; synthesized-name defect fixed **(i3)** (`bridge/test/golden.test.ts`) |
| Model switch mid-session | `POST /api/session/{id}/model` | measured (the TUI posts its boot default, then the announced model); forwarded as `set_model` when it changes the model **(i4)** |
| Agent switch mid-session | `POST /api/session/{id}/agent` | measured as accepted; faked |
| Commands palette | `GET /api/command` | measured (faked); `POST /api/session/{id}/command` contract-only; **(i6)** a listed name makes submit POST `session.command` instead of `session.prompt` (`prompt/index.tsx` L1312–L1325) |
| Interrupt / abort | `POST /api/session/{id}/interrupt` | contract-only; forwarded as the inbound `control_request`/`interrupt` subtype (not `control_cancel_request`) and ended as `session.execution.interrupted` **(i4)** — `bridge/test/interrupt.test.ts` |
| Retry visibility | `session.retry.scheduled` **(i3)** | defined at the pin (`RetryScheduled`, durable: `assistantMessageID`, `attempt`, `at`, `error`); maki's `system api_retry` maps to it **(i5)** (`retry-scheduled`, `bridge/test/golden.test.ts`) |
| Steering (queue a message mid-turn) | `delivery: "steer" \| "queue"`; `session.inbox.delivery.changed` / `.delivered` / `.cancelled` | contract-only; a mid-turn prompt is queued behind the running turn and a `steer` is reported as `queue` **(i4)** |
| Compact / context | `POST /api/session/{id}/compact`, `GET /api/session/{id}/context` | contract-only (maki has `/compact` on its own TUI only) |
| Revert / rewind | `POST /api/session/{id}/revert`, `/revert/stage`, `/revert/commit` | contract-only |
| Fork | `POST /api/session/{id}/fork` | deferred (bridge answers minimal) |
| Diff view | `GET /api/session/{id}/diff`, `/api/vcs/diff`, `/api/vcs/status` | contract-only |

## Permissions

| Feature | Routes / events | Coverage |
| --- | --- | --- |
| Ask/reply round trip | `permission.asked` / `permission.replied`, `POST /api/session/{id}/permission/{requestID}/reply` | measured (live), offline-verified |
| Reply vocabulary | `once \| always \| reject` (+ `message`) → maki `allow` / `allow`+`updatedPermissions` / `deny` (+`message`) | measured; `always` is session-scoped in maki, not project-scoped as the TUI copy says (`permission-reask` row, pin) **(i4)** |
| Saved permission rules | `GET/PUT/DELETE /api/permission/saved`, `POST /api/permission/request` | contract-only (no maki counterpart) |

## Out of the bridge's scope (recorded for completeness)

PTY/shell surfaces (`/api/pty/**`, `/api/shell/{id}`, persistent-pty; the
session terminal snapshot route is measured at boot and recorded above **(i3)**), integrations/credentials OAuth flows
(`/api/integration/{id}/connect/**`, `/api/credential/**`), voice/pair/web
search admin (`/api/voice/session`, `/api/pair`, `/api/websearch/**`),
experimental FS write and generate (`/api/experimental/fs/write`,
`/api/experimental/generate`, `/api/session/{id}/generate`),
worktrees (`/api/worktree/**`), stats/export/import
(`/api/experimental/session/{stats,export,import}`), instructions and skills
per session, background tasks (`/api/session/{id}/background`), inbox
(measured as polling, body faked), forms (measured as polling, body faked).

## SSE event envelopes: the pinned enumeration (+)

The OpenAPI pin does not pin SSE envelopes at all (`V2EventEncoded` is an
opaque JSON string), so the event side of the contract is enumerated from
`packages/schema/src/session-event.ts` at tag `v2.0.32` — the bridge contract
pin in `statuses.json` `versions`. This is the complete public manifest
(`Definitions`, L652–L701) plus the two internal / replay-only events the
manifest comment excludes (L704–L709). 51 types: 43 durable, 6 ephemeral,
2 internal.

`server.connected` is **not** in this file — it is the TUI's stream
handshake, pinned separately by the live capture in
`user-prompt-shape-live.jsonl`.

| # | Event type | Durability | Pin line | Bridge emits |
| --- | --- | --- | --- | --- |
| 1 | `session.created` | durable | L49 | — |
| 2 | `session.agent.selected` | durable | L70 | — |
| 3 | `session.model.selected` | durable | L81 | — |
| 4 | `session.moved` | durable | L92 | — |
| 5 | `session.renamed` | durable | L102 | — |
| 6 | `session.metadata.updated` | durable | L112 | — |
| 7 | `session.permissions` | durable | L122 | — |
| 8 | `session.viewed` | durable | L132 | — |
| 9 | `session.message.content.updated` | internal / replay-only | L144 | — |
| 10 | `session.usage.recorded` | internal / replay-only | L156 | — |
| 11 | `session.usage.updated` | ephemeral | L168 | — |
| 12 | `session.deleted` | durable | L178 | — |
| 13 | `session.forked` | durable | L188 | — |
| 14 | `session.inbox.delivered` | durable | L209 | yes **(i4)** |
| 15 | `session.inbox.enqueued` | durable | L216 | yes |
| 16 | `session.inbox.cancelled` | durable | L226 | yes **(i4)** |
| 17 | `session.inbox.delivery.changed` | durable | L233 | yes **(i4)** |
| 18 | `session.execution.started` | durable | L240 | yes **(i3)** |
| 19 | `session.execution.succeeded` | durable | L243 | yes **(i3)** |
| 20 | `session.execution.failed` | durable | L247 | yes **(i3)** |
| 21 | `session.execution.interrupted` | durable | L254 | yes **(i4)** |
| 22 | `session.instructions.updated` | durable | L262 | — |
| 23 | `session.synthetic` | durable | L280 | — |
| 24 | `session.skill.activated` | durable | L293 | — |
| 25 | `session.shell.started` | durable | L307 | — |
| 26 | `session.shell.ended` | durable | L317 | — |
| 27 | `session.step.started` | durable | L330 | yes |
| 28 | `session.step.streamed` | durable | L346 | — |
| 29 | `session.step.ended` | durable | L356 | yes |
| 30 | `session.step.failed` | durable | L373 | — |
| 31 | `session.text.started` | durable | L393 | yes |
| 32 | `session.text.delta` | ephemeral | L405 | yes |
| 33 | `session.text.ended` | durable | L416 | yes |
| 34 | `session.reasoning.started` | durable | L431 | yes |
| 35 | `session.reasoning.delta` | ephemeral | L444 | yes |
| 36 | `session.reasoning.ended` | durable | L455 | yes |
| 37 | `session.tool.input.started` | durable | L477 | yes |
| 38 | `session.tool.input.delta` | ephemeral | L488 | yes |
| 39 | `session.tool.input.ended` | durable | L497 | yes |
| 40 | `session.tool.called` | durable | L508 | yes |
| 41 | `session.tool.progress` | ephemeral | L521 | — |
| 42 | `session.tool.success` | durable | L531 | yes |
| 43 | `session.tool.failed` | durable | L552 | yes |
| 44 | `session.retry.scheduled` | durable | L570 | yes **(i4)** (stale since `add-retry-scheduled-emission`) |
| 45 | `session.compaction.started` | durable | L584 | — |
| 46 | `session.compaction.delta` | ephemeral | L596 | — |
| 47 | `session.compaction.ended` | durable | L605 | — |
| 48 | `session.compaction.failed` | durable | L624 | — |
| 49 | `session.revert.staged` | durable | L640 | — |
| 50 | `session.revert.cleared` | durable | L644 | — |
| 51 | `session.revert.committed` | durable | L646 | — |

## Findings from the pinned re-read (iteration 4)

- **The bridge emits 23 of the 51 pinned `session-event.ts` envelopes.**
  Iteration 4 adds `session.execution.interrupted`, `session.inbox.delivered`,
  `.cancelled`, and `.delivery.changed`; `session.retry.scheduled` was already
  emitted (`add-retry-scheduled-emission`) but its row still said no.
  Enumerated from `bridge/src/translator.ts` emit sites against the 51 types at
  v2.0.32.
- **`permission.asked`/`permission.replied` are pinned** as ephemeral events
  in `packages/schema/src/permission.ts` (L45–L53, v2.0.32), so of the
  iteration-2 phantom finding only `model.updated` remains unpinned.

## Findings from the pinned re-read (iteration 3)

- **The bridge emits 18 of the 51 pinned envelopes**, not 15: the three
  `session.execution.*` frames were marked unemitted while
  `bridge/src/translator.ts:99`, `:321`, and `:323` send them. The 33
  unemitted ones are recorded, not implemented; this change records them.
- **Retry has a counterpart after all.** `session.retry.scheduled` is a
  durable pinned event (`RetryScheduled` at v2.0.32), so the cross-map's
  "no direct counterpart" for Maki's `system api_retry` was wrong. The bridge
  tolerates the frame and emits nothing.
- **The session terminal snapshot route is measured.** The TUI calls
  `GET /api/experimental/session/{id}/terminal` at boot; it was bucketed as
  out-of-scope. The route row was already `served-faked` and stays so.

## Findings from the pinned re-read (iteration 2)

- **Four event names the bridge emits are absent from the pin.** `model.updated`
  (`bridge/src/bridge.ts:200`), `permission.asked`, and `permission.replied`
  (`bridge/src/bridge.ts:292`, `:316`) appear in no line of
  `session-event.ts` at v2.0.32. `server.connected` is likewise not in that
  file, but is pinned by the live TUI capture. The first three are the
  phantom-row class on the event side: the bridge invents them to drive the
  TUI. Recorded as a finding for the loop; no bridge source changes here
  (this change's non-goal).

## Scenario seeds taken from this inventory

- interrupt round trip (inbound `control_request`/`interrupt` ↔
  `POST /api/session/{id}/interrupt`)
- mid-session model switch actually switching the maki child (`set_model`) —
  landed in iteration 4
- message replay on session select (needs a transcript store)
- steering a working turn (queue → inbound `user`) — queued at the pin,
  landed in iteration 4
- `always` reply honoring session scope — the pin already has it
  (`updatedPermissions` → `AllowSession`); landed in iteration 4
