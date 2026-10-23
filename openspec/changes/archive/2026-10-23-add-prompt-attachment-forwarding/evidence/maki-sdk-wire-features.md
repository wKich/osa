# Maki SDK wire features (v0.6.4)

The Maki side of the cross-map. Source of truth: `src/sdk_mode.rs` at tag
`v0.6.4` (the version pinned in `examples/maki-image/Dockerfile`), plus the
recorded fixtures in `bridge/test/fixtures/`. Line references are to that
tag.

Copied forward from the iteration-2 archive and re-read at the pin in
iteration 3. Rows marked **(+)** were added by a rebaseline enumeration; rows
marked **(≠)** were corrected against the pin — the earlier text disagreed
with it. Rows marked **(i3)** are this iteration's additions. Every (+)/(≠)/(i3)
row cites a file and line at the tag.

## Per-message envelope (i3, all types)

Every wire message is `WireMessage { #[serde(flatten)] inner, session_id,
uuid }`: the flattened variant's fields plus a top-level `session_id`
(`SessionRef`) and `uuid` (a hyphenated UUIDv7) — `sdk_mode.rs:117–122`. The
bridge reads the top-level `session_id` from `system.init` and records it
(`bridge/src/translator.ts:122`), but binds a child by the spawn handle for its
OpenCode session; the envelope's id must not rebind that session (see
`add-wire-envelope-coverage`). This was unrecorded; the
iteration-2 init row wrongly listed `session_id` as an `init` field.

## Outbound wire types (maki → bridge)

| # | Type | Shape / subtypes | Fixture evidence |
| --- | --- | --- | --- |
| 1 | `system` | `subtype: "init"` with `cwd`, `tools` (Claude-cased names), `model` (`startup_model.id`), `permissionMode`, `apiKeySource`, `mcp_servers`, `slash_commands`, `output_style` (L615–L625); `session_id` rides the envelope, not this payload **(≠)** | `maki-plain.jsonl` |
| 2 | `system` | `subtype: "api_retry"` with `attempt`, `retry_delay_ms`, `error` (L1081) | none yet — no retry observed in fixtures |
| 3 | `assistant` | message `{ id, model, role, content[thinking\|text\|tool_use], stop_reason, usage }` plus **`parent_tool_use_id`** for subagent turns; tool names mapped to Claude casing (L1105–L1120) | `maki-tool.jsonl` |
| 4 | `user` | tool_result content carrier, also carries `parent_tool_use_id` (L1116) | `maki-tool.jsonl` |
| 5 | `stream_event` | Anthropic-style deltas (`content_block_*`, `message_*`, `text_delta`, `thinking_delta`, `input_json_delta`); emitted **only** with `--include-partial-messages`, incl. a `finish_message` flush on turn end (L974, L1090) | none — fixtures are buffered-path only |
| 6 | `result` | `subtype: "success" \| "error_during_execution"` **(≠)**, `is_error`, `duration_ms`, `duration_api_ms`, `num_turns`, `result`, `total_cost_usd`, `usage`, `permission_denials` (plural) (L174–L185, L995–L1000) | `maki-plain.jsonl` |
| 7 | `control_request` | outbound subtype **`can_use_tool` only** (`tool_name`, `input`, `tool_use_id`); maki blocks the tool until `control_response` (L1155) | `maki-permission.jsonl` |
| 8 | `control_response` **(+)** | outbound answers to the bridge's own `control_request`: `{response: {subtype: "success" \| "error", request_id, response?, error?}}` (L126–L134, L424–L438; the `subtype` is `error` iff `error` is set, L436) | none — the bridge never sends an inbound `control_request`, so maki never answers one |

## Inbound wire types (bridge → maki)

| # | Type | Behavior | Bridge coverage today |
| --- | --- | --- | --- |
| 1 | `user` | prompt text; content also accepted as blocks, and base64 `{"type":"image","source":{"type":"base64","media_type","data"}}` blocks become images **(i3)** (L688, L805–815); sending while the agent works **steers** the run (`AgentEvent::Steered`) | prompt text plus base64 image blocks from `data:image/*` attachments **(i4)**; PDFs and `file://` URIs are not forwarded |
| 2 | `control_request` | subtypes: `initialize` (hooks/agents payloads ignored, L827), `interrupt` **(+)** (`handle.cancel_tx.try_send(())` — the one subtype that actually cancels the run, L840–L843), `set_permission_mode`, `set_model` (resolves via model policy, L866), anything else → `unsupported` error response (L875–L878) | `interrupt` sent by the interrupt route **(i4)**; `initialize`/`set_permission_mode`/`set_model` not sent — maki tolerates the absence (live smoke passed) |
| 3 | `control_response` | `{ request_id, behavior: "allow" \| "deny" }` (+ optional guidance). **(≠)** Not two behaviors: `allow` + an `updatedPermissions` key decodes to `AllowSession` (session-scoped), a bare `allow` to `AllowOnce`, and a `deny` with a non-empty `message` to `DenyWithGuidance` — the rest deny (L918–L927) | all four sent **(i4)**: `once` bare allow, `always` allow + `updatedPermissions`, `reject` deny (+ `message` when the TUI gives a reason) |
| 4 | `control_cancel_request` | **(≠)** Does *not* cancel the run: it resolves the named `request_id` to `PermissionAnswer::Deny` — an implicit deny of a pending permission ask. Cancelling is the inbound `control_request`/`interrupt` subtype above (L732–L742 vs L840–L843) | not sent: the bridge cancels with `control_request`/`interrupt` and settles a parked ask with a `deny` `control_response` **(i4)** |

## Stream event envelope names (added by the rebaseline enumeration)

`stream_event` carries an Anthropic-style stream under `event` (L187–L190).
The complete set of envelope names `StreamSynth` can emit, with the line that
produces it — the bridge's `Translator` decodes these, so each is a wire kind
the bridge must tolerate when `--include-partial-messages` is on.

| # | Envelope name | Emitted by | Pin line |
| --- | --- | --- | --- |
| 1 | `message_start` | first delta of a turn (`ensure_started`) | L353 |
| 2 | `content_block_start` | opening a text / thinking / tool_use block | L319, L379 |
| 3 | `content_block_delta` | a fragment inside the open block | L297, L307, L324 |
| 4 | `content_block_stop` | closing the open block | L392 |
| 5 | `message_delta` | turn flush, carries `usage.output_tokens` | L338 |
| 6 | `message_stop` | turn flush, ends the message | L342 |

`content_block_delta`'s inner `delta.type` is one of `text_delta` (L299),
`thinking_delta` (L309), or `input_json_delta` (partial tool input JSON,
L326). `finish_message` (L332–L345) emits 4 → 5 → 6 together and is a no-op
if no block was ever opened.

## Findings from the pinned re-read (iteration 3)

- **The envelope is a wire feature in its own right.** `session_id` and `uuid`
  are siblings of every variant's fields (`L117–122`), so any consumer that
  switches on `type` and ignores them is still correct, but the bridge binds
  sessions by `session_id` (`translator.ts:122`) and that binding was
  unrecorded.
- **Images arrive on the SDK wire, not only through `--image`.** The inbound
  `user` handler splits text blocks and base64 image blocks
  (`content_images`, L805–815; called at L688). The OpenCode prompt POST also
  carries `files[]` (`PromptInput.FileAttachment`), and the bridge forwards
  neither — a two-sided attachment gap with a plausible join.
- **`question` never reaches the permission wire.** SDK mode excludes it
  (L580), so a `can_use_tool` ask for `Question` cannot occur.

## Findings from the pinned re-read (iteration 2)

- **`interrupt` is a real inbound subtype.** Iteration 1 recorded "anything
  else → unsupported" and named only `initialize` / `set_permission_mode` /
  `set_model`. `interrupt` (L840–L843) is the only subtype that cancels a run.
- **`control_cancel_request` was mis-described.** It denies a pending
  permission ask (L732–L742); it does not cancel. The cancel path is
  `control_request`/`interrupt`. The cross-map's "interrupt ↔
  `control_cancel_request`" scenario is therefore aimed at the wrong wire
  message.
- **`control_response` is richer than two behaviors.** `updatedPermissions`
  → `AllowSession`; `deny` + `message` → `DenyWithGuidance` (L918–L927).
  The bridge only ever sends bare `allow`/`deny`, so the session-scoped and
  guidance-bearing shapes are recorded, not exercised.
- **Outbound `control_response` was missing from the enumeration.** It is a
  seventh `WireInner` variant (L126–L134) and is emitted for every inbound
  `control_request` the bridge could send.
- **`result` has two subtypes, not three.** `success` and
  `error_during_execution` (L996–L1000); `error` belongs to
  `control_response` (L436). The field is `permission_denials` (plural,
  L183–L184).

## Session/CLI surface relevant to the bridge

| Feature | Flag / mechanism | Bridge relevance |
| --- | --- | --- |
| SDK mode entry | `-p --input-format stream-json --output-format stream-json` | the child argv (`bridge/src/maki.ts`) |
| Model pin | `-m provider/id` | wired (`MAKI_MODEL` → child argv) |
| Session identity | `--session-id`, `--continue`, `--resume`, `--fork-session` | refused in OpenCode mode (helper-cli requirement); replay of history not emitted on the wire |
| Permission posture | `--permission-mode default\|acceptEdits\|plan\|bypassPermissions`, `--yolo` | default kept so `can_use_tool` fires (the TUI dialog) |
| Turn/output caps | `--max-turns`, `--verbose` | unused |
| Prompt replacement | `--system-prompt`, `--append-system-prompt` (SDK only) | unused |
| Partial streaming | `--include-partial-messages` | implemented in translator, wire-verified by the live delta capture (`stream-deltas` row) |
| Vision | `--image` (print mode); inbound `user` content blocks also carry images **(i3)** | image attachments from the prompt POST's `files[]` ride the inbound `user` content **(i4)** |
| Excluded tool | `question` is passed to `headless::spawn_interactive` as an excluded tool, so SDK mode never asks `can_use_tool` for it **(i3)** (L580) | no effect; the bridge's tool map still carries `Question` |

## Scenario seeds taken from this inventory

- Q-A-Q-A ordering (defect `message-order-inversion`)
- status-line model identity from `system.init.model` / `assistant.model`
  (defect `synthesized-model-name`)
- `api_retry` system frame must be tolerated without disturbing the transcript
- mid-turn steering via inbound `user`
- interrupt via inbound `control_request`/`interrupt` (not `control_cancel_request`,
  which only denies a pending ask) — corrected in iteration 2
- mid-session model switch via inbound `control_request set_model`
- subagent turns flagged by `parent_tool_use_id`
