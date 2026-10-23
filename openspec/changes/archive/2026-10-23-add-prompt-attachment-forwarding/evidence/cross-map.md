# Cross-map: Maki SDK wire ↔ OpenCode TUI (iteration 4)

Copied forward from `archive/2026-10-23-rebaseline-compat-iteration-3` by the
iteration-4 burndown (`add-interrupt-forwarding` first; each later `add-…`
change copies the newest copy forward — this copy is `add-prompt-attachment-forwarding`'s). Rows marked **(i4)** changed in iteration 4.

The join of `maki-sdk-wire-features.md` and `opencode-tui-features.md`.
Copied forward from iteration 2 and re-read against the pins in iteration 3.
Rows and findings marked **(≠)** correct an earlier claim against the pin,
**(+)** add one the pin defines but was not recorded, **(i3)** are this
iteration's corrections. Citations are to `src/sdk_mode.rs` at `v0.6.4` and
`packages/schema/src/session-event.ts` at tag `v2.0.32`.

Status vocabulary matches the report: `verified` (offline test or fixture),
`degraded` (works with a recorded limitation), `unverified` (no evidence
yet), `buggy` (open inventory entry in `bridge/defects.json`), `deferred`
(spec-valid minimal answer, not implemented), `out-of-scope`. A capability
whose route is answered minimally is a route `deferred`/`served-faked` and a
feature `unverified` — the two lenses are kept apart in `statuses.json`.

| Capability | Maki side | OpenCode side | Status | Evidence / next step |
| --- | --- | --- | --- | --- |
| SSE handshake + bare frames + id patterns | n/a (client of maki's stdout) | `GET /api/event`, `server.connected` | verified | `bridge/test/contract.test.ts` |
| Boot/config surface | — | info/config/agent/model/… reads | verified (faked values) | `bridge/test/session-api.test.ts` |
| Session CRUD + teardown | one SDK child per session | session list/read/create/delete | verified | `bridge/test/session-api.test.ts` |
| Prompt → assistant parts (text/thinking/tool) | `assistant` parts, `result` | `session.text.*`, `session.reasoning.*`, `session.tool.*` | verified | `bridge/test/golden/*` |
| Failing/denied tool rows | `tool_result{is_error}` | `session.tool.failed` `{type,message}` | verified | `bridge/test/session-api.test.ts` |
| Permission ask/reply | `control_request can_use_tool` ↔ `control_response` | `permission.asked/replied` + reply route | verified | `bridge/test/session-api.test.ts` |
| `always` reply scope | `allow`+`updatedPermissions` → `AllowSession`, a session rule for the generalized scope (L918–L927; maki-agent `permissions.rs` L685); no project/global answer on the SDK wire | `always`, whose TUI copy says "for this project" (`tui/src/util/permission.ts` L154–L160) | degraded **(i4)** (pin) | `bridge/test/session-api.test.ts`; session scope only — the project half is pin-blocked |
| Permission reply vocabulary (richer shapes) | `allow`+`updatedPermissions` → `AllowSession`, `deny`+`message` → `DenyWithGuidance` (L918–L927) | reply body `{decision, message}` (vendored OpenAPI) | verified **(i4)** | `bridge/test/permission-egress.test.ts` (add-permission-session-scope) |
| User prompt in transcript | no echo of plain user text on the wire (bridge owns it) | `session.inbox.enqueued` with `data.item:{type:"user",payload:{text},delivery}` | verified | `bridge/test/golden.test.ts`; shape pinned below |
| Model identity | `system.init.model`, `assistant.model` | status line, `/api/model`, `step.started.model` | verified | `bridge/test/golden.test.ts` |
| Streaming deltas | `stream_event` behind `--include-partial-messages` | `session.*.delta` | verified **(i3)** | live delta capture, `bridge/test/fixtures/maki-stream-live.jsonl` |
| API retry tolerance | `system api_retry` (L1081) | tolerance only; no event emitted | verified (tolerance) | `bridge/test/golden.test.ts` |
| API retry visibility **(i3)** | `system api_retry` `{attempt, retry_delay_ms, error}` | `session.retry.scheduled` **(≠)** `{assistantMessageID, attempt, at, error}` — a real counterpart, contrary to iteration 2 | unverified | never mapped; `opencode-tui-features.md` retry row |
| Interrupt / abort | inbound `control_request` subtype **`interrupt`** (L840–L843) **(≠)** — *not* `control_cancel_request`, which only denies a pending ask (L732–L742); the cancelled run ends with an `error_during_execution` result (L1168–L1172) | `POST /api/session/{id}/interrupt` → `session.execution.interrupted` `{reason:"user"}` (L253–L257) | verified **(i4)** (route `served-live`) | `bridge/test/interrupt.test.ts` (add-interrupt-forwarding) |
| Mid-session model switch | inbound `control_request set_model` | `POST /api/session/{id}/model` | unverified **(i3)** (route `served-live`: state only) | bridge records `s.model`, forwards no `set_model` |
| Mid-turn steering | inbound `user` while running (`Steered`) | `delivery: "steer"` on prompt POST | unverified **(i3)** | untested on both sides |
| SDK control handshake | inbound `initialize` (+`set_permission_mode`) | — | unverified **(i3)** | bridge never sends it; maki tolerates (live smoke) — record, don't build |
| Prompt attachments **(i3)** | inbound `user` content decodes text blocks (`content_text`, L786–L804) and base64 image blocks in png/jpeg/gif/webp (`content_images`, L807–L816; maki-providers `types.rs` L30–L35) — no document block | prompt POST `files[]` (`PromptInput.FileAttachment`: `uri`, `name`); the TUI sends pasted images/PDFs as `data:` URIs (`tui/src/component/prompt/local-attachment.ts` L55, L167) and @-mentions as `file://` URIs (`autocomplete.tsx` L249–L268) | degraded **(i4)** (pin) | images forwarded, PDFs dropped at the pin — `bridge/test/prompt-attachments.test.ts` (add-prompt-attachment-forwarding) |
| File mentions **(i4)** | — (a `file://` URI is a host path; the child has its own sandbox workdir) | `files[]` entries with `file://` URIs | out-of-scope (`prompt-file-mentions`) | the bridge reads no host path on a client's behalf; the mention text stays in the prompt |
| Subagent transcript nesting | `parent_tool_use_id` on `assistant`/`user` | session/child sessions API | verified **(i3)** | live subagent capture, `bridge/test/golden.test.ts` |
| Message replay / resume | history not re-emitted on the wire | `GET /api/session/{id}/message`, `--continue` | unverified **(i3)** (route `deferred`) | helper refuses resume in OpenCode mode |
| Permission saved rules | no counterpart | `/api/permission/saved*` | out-of-scope | maki rules live in `permissions.toml` / config |
| PTY/shell, OAuth integrations, voice, worktrees, stats/export, background tasks, forms, inbox bodies | no counterparts | `/api/pty/**`, `/api/integration/**`, … | out-of-scope | one row per pinned operation — see `route-classification.md` |

Rows added to `bridge/compat/statuses.json` by iteration 2: api-retry
tolerance, interrupt round trip, model-switch, steering, sdk-control-handshake,
subagent-nesting. Iteration 3 adds three feature rows — `wire-envelope`,
`prompt-attachments`, `retry-scheduled` — all `unverified` with this change's
evidence as the link.

## Iteration 4 findings

- **The re-ask policy rested on a wrong premise.** The iteration-1 design
  (decided with the user) said Maki's wire has only `allow|deny`; the pin's
  decoder has four answers (L918–L927). `add-permission-session-scope`
  replaces the policy with the session-scoped allow.
- **`save` is a pattern list, not a reply list.** The TUI shows "Always allow"
  only when `save` is non-empty and lists its entries as the patterns that
  will be allowed (`tui/src/routes/session/permission.tsx` L233–L240,
  `tui/src/util/permission.ts` L154–L160, v2.0.32). The bridge sent
  `save:["once"]`; it now sends the tool name.
- **`permission.asked`/`permission.replied` are pinned, just not in
  `session-event.ts`.** They are ephemeral events in
  `packages/schema/src/permission.ts` (L45–L53, v2.0.32), so the iteration-2
  "phantom" finding holds only for `model.updated`.

## Iteration 4 triage (burndown for the current pin)

Every reachable non-`verified` feature row gets one action. `capability` =
both pins define the behavior and the TUI needs it; the bridge implements it.

| Row | Status before | Action | Rationale |
| --- | --- | --- | --- |
| `interrupt-round-trip` | degraded (none) | capability → `add-interrupt-forwarding` | pinned `control_request`/`interrupt` (L840–L843) ↔ `session.execution.interrupted` (L253) |
| `permission-reply-vocabulary` | degraded (none) | capability → `add-permission-session-scope` | `allow`+`updatedPermissions` → `AllowSession`, `deny`+`message` → `DenyWithGuidance` (L918–L927) ↔ reply body `{decision, message}` (vendored OpenAPI) |
| `permission-reask` | degraded (none) → degraded (pin) | capability (same slice), then accept the pinned remainder | `always` maps onto `AllowSession`, so the re-ask policy was never forced by the wire; what remains — no project-scoped answer on the SDK wire (L918–L927) — is pin-blocked |
| `prompt-attachments` | degraded (none) → degraded (pin) | capability → `add-prompt-attachment-forwarding`, then accept the pinned remainder | base64 image blocks (L807–L816) ↔ `data:image/*` URIs; PDFs have no inbound block at the pin |
| `prompt-file-mentions` **(new)** | out-of-scope | accept | reading a client-named host path would add a host-exposure surface the bridge never had; the mention (`@path`) is already in the prompt text, and Maki reads the project in its sandbox workdir |
| `mid-turn-steering` | unverified (none) | re-triage after the slices above | inbound `user` while running is decoded and sent to the running session's input queue (L682–L702); the bridge opens a new turn per prompt |
| `sdk-control-handshake` | unverified, out-of-scope | accept | the pinned child runs without `initialize` (`handle_control_request` runs only when a `control_request` arrives, L818–L827); no TUI behavior depends on it — record, don't build |
| `agent-switch-state` | degraded (pin) | accept | pin-blocked: the inbound `control_request` subtypes at the pin are `initialize`, `interrupt`, `set_permission_mode`, `set_model` (L818–L880) — no `set_agent`. `set_permission_mode` only flips build/plan (`agent_mode`, L108–L113), which is not an OpenCode agent's identity (prompt, tools, model), so mapping agents onto it would invent semantics |
| `mid-session-model-switch` | degraded (pin) | capability **(≠)** | mis-triaged as pin-blocked by `add-compat-burndown`: the pin defines inbound `set_model` (L861–L874, resolved through the model policy by `resolve_set_model`, L883–L906). Both pins support it and the TUI calls `POST /api/session/{id}/model` |

## Findings from the pinned re-read (iteration 3)

- **Retry does have a counterpart.** `session.retry.scheduled` is pinned at
  v2.0.32; the iteration-2 row called it "no direct counterpart". The
  tolerance half is verified, the emission half is not (`retry-scheduled`).
- **Two rows were stale against later status flips.** Streaming deltas and
  subagent nesting both landed `verified` with the 2026-10-23 live captures
  and are refreshed here.
- **Attachments are a two-sided gap.** OpenCode's prompt POST carries
  `files[]`; Maki's inbound `user` decodes base64 image blocks; the bridge
  passes neither (`bridge/src/bridge.ts:259–273`). Recorded as
  `prompt-attachments`.
- **A capability can be `served-live` as a route yet unverified as a
  feature.** `POST /api/session/{id}/model` stores `s.model` (route
  `served-live`) but never sends `set_model`; the cross-map now says so.

## Findings from the pinned re-read (iteration 2)

- **The interrupt scenario was aimed at the wrong wire message.** The
  iteration-1 scenario seeds say "interrupt via `control_cancel_request`".
  At the pin that message only denies a pending permission ask
  (`sdk_mode.rs` L732–L742); the subtype that cancels a run is inbound
  `control_request`/`interrupt` (L840–L843). Any future interrupt coverage
  test must target `control_request`/`interrupt`.
- **`out-of-scope` is gone.** The bucketed rows above are expanded to one row
  per pinned operation by `evidence/route-classification.md` (142 `/api/*`
  operations, 108 of them previously unrecorded; iteration 3 adds the one
  non-`/api` operation).
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
