# Cross-map: Maki SDK wire ↔ OpenCode TUI (iteration 2)

The join of `maki-sdk-wire-features.md` and `opencode-tui-features.md`.
Copied forward from iteration 1 and extended by the rebaseline enumeration
(this change); rows and findings marked **(≠)** correct an iteration-1 claim
against the pin, **(+)** add one the pin defines but iteration 1 did not
record. Citations are to `src/sdk_mode.rs` at `v0.6.4` and
`packages/schema/src/session-event.ts` at tag `v2.0.32`.

Status vocabulary matches the report: `verified` (offline test or fixture),
`degraded` (works with a recorded limitation), `unverified` (no evidence
yet), `buggy` (open inventory entry in `bridge/defects.json`), `deferred`
(spec-valid minimal answer, not implemented), `out-of-scope`. "Iteration"
names the loop pass that should pick the row up; iteration 1 fixes only the
two buggy rows.

| Capability | Maki side | OpenCode side | Status | Evidence / next step |
| --- | --- | --- | --- | --- |
| SSE handshake + bare frames + id patterns | n/a (client of maki's stdout) | `GET /api/event`, `server.connected` | verified | `bridge/test/contract.test.ts` |
| Boot/config surface | — | info/config/agent/model/… reads | verified (faked values) | `bridge/test/session-api.test.ts` |
| Session CRUD + teardown | one SDK child per session | session list/read/create/delete | verified | `bridge/test/session-api.test.ts` |
| Prompt → assistant parts (text/thinking/tool) | `assistant` parts, `result` | `session.text.*`, `session.reasoning.*`, `session.tool.*` | verified | `bridge/test/golden/*` |
| Failing/denied tool rows | `tool_result{is_error}` | `session.tool.failed` `{type,message}` | verified | `bridge/test/session-api.test.ts` |
| Permission ask/reply | `control_request can_use_tool` ↔ `control_response` | `permission.asked/replied` + reply route | verified | `bridge/test/session-api.test.ts` |
| `always` reply scope | only `allow`/`deny` representable | `once\|always\|reject` | degraded | re-ask policy, archived `api-check.log`; revisit if maki's wire grows scoped answers |
| User prompt in transcript | no echo of plain user text on the wire (bridge owns it) | `session.inbox.enqueued` with `data.item:{type:"user",payload:{text},delivery}` | verified (fixed in this change) | `bridge/test/golden.test.ts`; shape pinned below |
| Model identity | `system.init.model`, `assistant.model` | status line, `/api/model`, `step.started.model` | verified (fixed in this change) | `bridge/test/golden.test.ts` |
| Streaming deltas | `stream_event` behind `--include-partial-messages` | `session.*.delta` | unverified | needs a streaming provider capture (iteration 2 candidate) |
| API retry visibility | `system api_retry` | no direct counterpart (status bar only) | unverified | tolerance test: transcript undisturbed (iteration 2) |
| Interrupt / abort | inbound `control_request` subtype **`interrupt`** (L840–L843) **(≠)** — *not* `control_cancel_request`, which only denies a pending permission ask (L732–L742) | `POST /api/session/{id}/interrupt` | deferred | route answered minimally; round trip = iteration 2+ |
| Mid-session model switch | inbound `control_request set_model` | `POST /api/session/{id}/model` | deferred | both sides support it; bridge forwards neither (iteration 2+ candidate) |
| Mid-turn steering | inbound `user` while running (`Steered`) | `delivery: "steer"` on prompt POST | deferred | untested on both sides |
| SDK control handshake | inbound `initialize` (+`set_permission_mode`) | — | deferred | bridge never sends it; maki tolerates (live smoke) — record, don't build |
| Subagent transcript nesting | `parent_tool_use_id` on `assistant`/`user` | session/child sessions API | deferred | no capture of a subagent turn yet |
| Message replay / resume | history not re-emitted on the wire | `GET /api/session/{id}/message`, `--continue` | deferred | helper refuses resume in OpenCode mode |
| Permission reply vocabulary | `behavior: allow\|deny`; `allow`+`updatedPermissions` → `AllowSession`, `deny`+`message` → `DenyWithGuidance` (L918–L927) **(≠)** | `once \| always \| reject` | degraded | the bridge sends bare allow/deny only, so the richer shapes are recorded, not exercised; re-ask policy in `api-check.log` |
| Permission saved rules | no counterpart | `/api/permission/saved*` | out-of-scope | maki rules live in `permissions.toml` / config |
| PTY/shell, OAuth integrations, voice, worktrees, stats/export, background tasks, forms, inbox bodies | no counterparts | `/api/pty/**`, `/api/integration/**`, … | out-of-scope | **(≠)** expanded to individual rows this change — see `route-enumeration.md`; the bucket is gone |

Rows added to `bridge/compat/statuses.json` this iteration: api-retry
tolerance, interrupt round trip, model-switch, steering, sdk-control-handshake,
subagent-nesting — each `unverified`/`deferred` with this change's evidence
as the link. Rows `transcript-order` and `model-identity` flip to `verified`
once their fixes land.

## Findings from the pinned re-read (this change)

- **The interrupt scenario was aimed at the wrong wire message.** The
  iteration-1 scenario seeds say "interrupt via `control_cancel_request`".
  At the pin that message only denies a pending permission ask
  (`sdk_mode.rs` L732–L742); the subtype that cancels a run is inbound
  `control_request`/`interrupt` (L840–L843). Any future interrupt coverage
  test must target `control_request`/`interrupt`.
- **`out-of-scope` is gone.** The bucketed rows above are expanded to one row
  per pinned operation by `evidence/route-enumeration.md` (142 operations,
  108 of them previously unrecorded).
- **The event side has its own phantom class.** `model.updated`,
  `permission.asked`, and `permission.replied` are emitted by the bridge but
  defined by no line of `session-event.ts` at v2.0.32 — see
  `opencode-tui-features.md`. Same finding class as a phantom route; no
  bridge source change in this iteration.
- **`result` has two subtypes** (`success`, `error_during_execution`,
  L996–L1000), not three; `error` belongs to `control_response` (L436), and
  the field is `permission_denials` (plural, L183–L184).

## Pinned: the user-prompt SSE frame (task 2.1)

The discovery scenario's expectation (`message.part.updated` with
`data.message.role === "user"`) was a hypothesis and is **wrong**. Established
by the decision-1 chain:

1. Archived captures (`add-opencode-tui-bridge/evidence/`) are of the bridge
   itself, and maki's wire has no user echo — no confirmation possible there.
2. The vendored OpenAPI 2.0.32 pins no SSE event envelopes at all
   (`V2EventEncoded` is an opaque JSON string); it only pins the replayed
   message object `Session.Message.User` = `{id, time.created, text,
   type:"user"}` on `GET /api/session/{id}/message`.
3. Gated live capture (both prior sources failed): real `opencode v2.0.32`
   `serve` in an isolated XDG tree (no host config touched; one benign
   prompt turn), SSE subscriber on `GET /api/event`, prompt via
   `POST /api/session/{id}/prompt` with `{"text": …}`. Recorded in
   `user-prompt-shape-live.jsonl`.

**Confirmed shape** — the user prompt appears on the event stream as

```json
{"type":"session.inbox.enqueued","data":{"inboxID":"<msg id>","sessionID":"…","item":{"type":"user","payload":{"text":"<prompt>"},"delivery":"steer"}}}
```

emitted synchronously at admission, strictly before any assistant frame of
the turn; the turn continues `session.inbox.delivered`, `session.step.*`,
`session.text.*`, `session.execution.succeeded`. Two prompts in one session
interleave Q-A-Q-A purely from this ordering. No `message.part.updated` event
exists on the wire at all. The prompt POST response also returns the user
message object (`{id, sessionID, time.created, type:"user", payload:{text},
delivery}`); the replay route returns `{id, time.created, text, type:"user"}`.
