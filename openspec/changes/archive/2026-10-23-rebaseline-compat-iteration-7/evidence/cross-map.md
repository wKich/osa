# Cross-map: Maki SDK wire ↔ OpenCode TUI (iteration 7)

Copied forward from `archive/2026-10-23-rebaseline-compat-iteration-6` by
`rebaseline-compat-iteration-7`, the closing pass after the route-queue
burndown. Rows marked **(i7)** were stale against `statuses.json` and are
refreshed here; no status changed in this pass.

Copied forward from `archive/2026-10-23-rebaseline-compat-iteration-5` by
`rebaseline-compat-iteration-6`, the first pass under the route queue
(`add-route-triage`). Rows marked **(i6)** are added or changed here.

Copied forward from `archive/2026-10-23-rebaseline-compat-iteration-4` by
`rebaseline-compat-iteration-5` (discovery pass 5, the closing check at the
current pin). Rows marked **(i5)** were stale against `statuses.json` and are
refreshed here; no status changed.

Copied forward from `archive/2026-10-23-rebaseline-compat-iteration-3` by the
iteration-4 burndown (`add-interrupt-forwarding` first; each later `add-…`
change copies the newest copy forward — this copy is `rebaseline-compat-iteration-4`'s, the closing record). Rows marked **(i4)** changed in iteration 4.

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
| Server info **(i6)** | — (the bridge is the server) | `GET /api/info` `{version,pid,urls,paths,capabilities.persistentPty}`; terminals offered unless `persistentPty === false` (`tui/src/context/session-terminals.tsx` L62–L77) | verified **(i7)** (`server-info-live`) | `bridge/test/boot-surface.test.ts` (fix-boot-surface-truth) |
| Workdir listing **(i6)** | sandbox workdir via `openshell sandbox exec` (the transport `bridge/src/maki.ts` already uses) | `GET /api/fs/list` (startup root, `/cd` completion: `tui/src/app.tsx` L218–L222) | verified **(i7)** (`fs-list-sandbox`) | `bridge/test/fs-list.test.ts` (fix-fs-list-sandbox) |
| Branch **(i6)** | sandbox `git` in the workdir | `GET /api/vcs` `branch.current` (footer `dir:branch`, `prompt/index.tsx` L1620) | verified **(i7)** (`vcs-branch-live`) | `bridge/test/sandbox-git.test.ts` (add-sandbox-git-state) |
| Project identity **(i6)** | sandbox `git` root commit | `GET /api/project`, `GET /api/location` `project.id` | verified **(i7)** (`project-identity-live`) | `bridge/test/sandbox-git.test.ts` (add-sandbox-git-state) |
| Active sessions **(i6)** | a turn in flight on a child | `GET /api/session/active` `{[ses]: {type:"running"}}` (server `handlers/session.ts` L182–L188) | verified **(i7)** (`session-active-live`) | `bridge/test/session-active.test.ts` (add-session-active-state) |
| MCP servers **(i6)** | `system.init.mcp_servers` hardcoded `[]` (L623); servers live in `mcp.toml` (`maki-agent/src/mcp/config.rs` L13) and their tools in `system.init.tools` as `<server>__<tool>` | `GET /api/mcp` (sidebar, `/status`, toasts on `failed`) | verified **(i7)** (`mcp-server-status`) | `bridge/test/mcp-status.test.ts` (add-mcp-server-status); `pending` when the state is not observable |
| Skills **(i6)** | skill plugin discovery (`plugins/skill/init.lua` L11–L30, L98–L130); no SDK frame | `GET /api/skill` (`@skill`, `/skills`) | verified **(i7)** (`skill-list-live`) | `bridge/test/skill-list.test.ts` (add-skill-list); the compiled-in `maki-plugin-dev` skill has no file and is not listed |
| Model/provider catalog **(i6)** | `maki models` prints `provider/model` lines (`src/cmd/subcmd.rs` L601–L630) | `GET /api/model`, `/api/provider`, `/api/integration` (connected = any connection, `tui/src/util/connected-provider.ts` L3) | verified **(i7)** (`model-catalog-live`) | `bridge/test/model-catalog.test.ts` (add-model-catalog); integrations via `maki auth status` `(via VAR)` |
| Server commands **(i6)** | `slash_commands` hardcoded `[]` (L624); SDK mode discovers no custom commands (`SdkParams` L542–L557) | `GET /api/command`; a listed pick POSTs `session.command` (`prompt/index.tsx` L1312–L1325) | degraded **(i7)** (pin, `slash-commands`) | list empty — `bridge/test/boot-surface.test.ts` |
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
| API retry visibility **(i3)** | `system api_retry` `{attempt, retry_delay_ms, error}` | `session.retry.scheduled` **(≠)** `{assistantMessageID, attempt, at, error}` — a real counterpart, contrary to iteration 2 | verified **(i5)** (`retry-scheduled`) | `bridge/test/golden.test.ts` over `bridge/test/fixtures/maki-retry.jsonl` (add-retry-scheduled-emission); the row said "never mapped" after the mapping landed |
| Interrupt / abort | inbound `control_request` subtype **`interrupt`** (L840–L843) **(≠)** — *not* `control_cancel_request`, which only denies a pending ask (L732–L742); the cancelled run ends with an `error_during_execution` result (L1168–L1172) | `POST /api/session/{id}/interrupt` → `session.execution.interrupted` `{reason:"user"}` (L253–L257) | verified **(i4)** (route `served-live`) | `bridge/test/interrupt.test.ts` (add-interrupt-forwarding) |
| Mid-session model switch | inbound `control_request set_model` (L861–L874; policy + spec resolution L883–L916), acked by `control_response` success/error | `POST /api/session/{id}/model` ("switch the model used by subsequent provider turns", vendored OpenAPI) | verified **(i4)** (route `served-live`) | `bridge/test/model-switch.test.ts` (add-model-switch-forwarding); the TUI's re-post of the model it already shows sends nothing |
| Mid-turn steering | inbound `user` while running is sent to the session's input queue (L682–L702) and answered by its own run after the current one (L763; maki-agent `headless.rs` L365) **(≠)** — `AgentEvent::Steered` is a plugin rewrite/drop, not mid-run delivery | `delivery: "steer" \| "queue"` on prompt POST; `session.inbox.delivery.changed` (L232), `.delivered` (L208), `.cancelled` (L225) | degraded **(i4)** (pin) | queued, never steered — `bridge/test/steering.test.ts` (add-mid-turn-prompt-queue) |
| SDK control handshake | inbound `initialize` (+`set_permission_mode`) | — | out-of-scope **(i5)** (`sdk-control-handshake`) | the pinned child serves control requests without it (L818–L827) and no TUI behavior depends on it — record, don't build |
| Prompt attachments **(i3)** | inbound `user` content decodes text blocks (`content_text`, L786–L804) and base64 image blocks in png/jpeg/gif/webp (`content_images`, L807–L816; maki-providers `types.rs` L30–L35) — no document block | prompt POST `files[]` (`PromptInput.FileAttachment`: `uri`, `name`); the TUI sends pasted images/PDFs as `data:` URIs (`tui/src/component/prompt/local-attachment.ts` L55, L167) and @-mentions as `file://` URIs (`autocomplete.tsx` L249–L268) | degraded **(i4)** (pin) | images forwarded, PDFs dropped at the pin — `bridge/test/prompt-attachments.test.ts` (add-prompt-attachment-forwarding) |
| File mentions **(i4)** | — (a `file://` URI is a host path; the child has its own sandbox workdir) | `files[]` entries with `file://` URIs | out-of-scope (`prompt-file-mentions`) | the bridge reads no host path on a client's behalf; the mention text stays in the prompt |
| Subagent transcript nesting | `parent_tool_use_id` on `assistant`/`user` | session/child sessions API | verified **(i3)** | live subagent capture, `bridge/test/golden.test.ts` |
| Message replay / resume | history not re-emitted on the wire | `GET /api/session/{id}/message`, `--continue` | out-of-scope **(i5)** (route `deferred`) | not in the reachable set: the TUI capture never calls the replay route, whose `statuses.json` row is `deferred`/`out-of-scope`; helper refuses resume in OpenCode mode. No feature row |
| Permission saved rules | no counterpart | `/api/permission/saved*` | out-of-scope | maki rules live in `permissions.toml` / config |
| PTY/shell, OAuth integrations, voice, worktrees, stats/export, background tasks, forms, inbox bodies | no counterparts | `/api/pty/**`, `/api/integration/**`, … | out-of-scope | one row per pinned operation — see `route-classification.md` |

Rows added to `bridge/compat/statuses.json` by iteration 2: api-retry
tolerance, interrupt round trip, model-switch, steering, sdk-control-handshake,
subagent-nesting. Iteration 3 adds three feature rows — `wire-envelope`,
`prompt-attachments`, `retry-scheduled` — all `unverified` with this change's
evidence as the link.

## Iteration 7 findings (closing pass)

- **Route queue empty.** All 33 reachable routes carry a decision: 22
  `served-live`, 4 `deferred`, and 7 `served-faked`. Of those seven, six are
  accepted with a `fakeReason` (`agent`, `config`, `reference`, `plugin`,
  `form`, `migration/v1`) and one, `command`, is pin-blocked
  (`slash-commands`).
- **The TUI no longer polls `GET /api/experimental/session/{id}/terminal`.**
  It now reads `capabilities.persistentPty: false`. The route stays reachable
  through `bridge/test/fixtures/bridge-requests.jsonl` and is `deferred` with
  `bridge/test/boot-surface.test.ts`.
- **Nothing new upstream.** No drift at the pins. Every captured request
  matched a spec route recorded as reachable. Discovery appended no defect.

## Iteration 6 findings (route queue)

Re-read at the pins (`sdk_mode.rs` v0.6.4 and the Maki workspace at that tag;
`anomalyco/opencode` v2.0.32 TUI and client sources) for each of the 21
untriaged reachable `served-faked` routes.

- **Three defects, appended by hand from the committed TUI capture** (the
  discovery scenarios do not probe the boot lists):
  `fs-list-reads-host-directory` — the listing reads the host directory the
  client names, breaking the "no host path on a client's behalf" invariant;
  `boot-lists-phantom-rows` — `sample` rows render as a connected MCP server,
  a running shell, an active plugin, a reference alias, a server command and a
  `sample` agent; `info-advertises-terminals` — no `persistentPty: false`.
- **The sandbox supplies most of the real data.** Branch, project identity,
  directory listing, MCP config, skills and the model catalog all live in the
  sandbox and are reachable through `openshell sandbox exec`, the transport
  the child already uses. None needs a bind mount or a host read.
- **Maki at the pin advertises nothing about MCP or commands on the wire**:
  `mcp_servers` and `slash_commands` are literal `[]` (L623–L624). MCP status
  is still derivable (config + advertised tool prefixes); commands are not
  runnable in SDK mode at all, so that route is pin-blocked.
- **Accepted (synthesized data is correct):** migration status, config
  documents, global forms — see the triage table.

## Iteration 6 triage (route queue)

| Route | Decision | Action | Rationale |
| --- | --- | --- | --- |
| `GET /api/info` | link `server-info-live` | fix (`info-advertises-terminals`) | the bridge is the server: its own pid/URL, pinned version, no PTY |
| `GET /api/fs/list` | link `fs-list-sandbox` | fix (`fs-list-reads-host-directory`) | list the sandbox workdir over exec |
| `GET /api/agent` | accept, after the fix | fix (`boot-lists-phantom-rows`) | Maki has one agent and no named-agent surface (`initialize` ignores `agents`, L828–L839; no `set_agent`, L818–L880): one primary `build` entry is the true list |
| `GET /api/plugin` | accept, after the fix | fix (`boot-lists-phantom-rows`) | the bridge hosts no OpenCode server plugin; Maki's Lua plugins are not OpenCode plugins |
| `GET /api/reference` | accept, after the fix | fix (`boot-lists-phantom-rows`) | references are aliases from OpenCode config documents, and there are none |
| `GET /api/shell` | deferred, after the fix | fix (`boot-lists-phantom-rows`) | no shell runs until the shell routes are built; empty is spec-valid |
| `GET /api/mcp/resource` | deferred, after the fix | fix (`boot-lists-phantom-rows`) | the resource catalog needs a live MCP client the bridge does not have; read only by the debug dump |
| `GET /api/experimental/session/{sessionID}/terminal` | deferred, with a test | fix (`info-advertises-terminals`) | no PTY exists; the empty list is already served and gets its proof |
| `GET /api/command` | pin (`slash-commands`) | fix (`boot-lists-phantom-rows`) | SDK mode runs no custom commands at v0.6.4 |
| `GET /api/vcs` | link `vcs-branch-live` | capability | sandbox `git` |
| `GET /api/project`, `GET /api/location` | link `project-identity-live` | capability | sandbox `git` root commit |
| `GET /api/session/active` | link `session-active-live` | capability | bridge session state |
| `GET /api/mcp` | link `mcp-server-status` | capability | sandbox `mcp.toml` + `system.init.tools` |
| `GET /api/skill` | link `skill-list-live` | capability | sandbox skill directories |
| `GET /api/model`, `/api/provider`, `/api/integration` | link `model-catalog-live` | capability | `maki models` in the sandbox |
| `GET /api/experimental/migration/v1` | accept | record | no data store, nothing to migrate |
| `GET /api/config` | accept | record | no OpenCode config document exists |
| `GET /api/form` | accept | record | no elicitation on the pinned wire |

## Iteration 5 findings

Re-enumerated at the pins (`sdk_mode.rs` v0.6.4, `session-event.ts` v2.0.32,
vendored OpenAPI 2.0.32); nothing upstream is missing from the matrices.

- **Wire side complete.** Inbound kinds `user`, `control_request`,
  `control_response`, `control_cancel_request` (L682–L732); control subtypes
  `initialize`, `interrupt`, `set_permission_mode`, `set_model` (L828–L861);
  outbound `system`/`assistant`/`user`/`result`/`stream_event`/
  `control_response`/`control_request` (L125–L134) and every `stream_event`
  delta name are all recorded in `maki-sdk-wire-features.md`.
- **Event side complete.** All 51 `session-event.ts` types have a row in
  `opencode-tui-features.md`; no phantom emitted by the bridge beyond the
  recorded `server.connected` handshake.
- **Routes complete.** 143 pinned operations = 143 `statuses.json` rows; the
  TUI pass (37 requests, all matched) calls the same route set as the
  committed capture, so the reachable set is unchanged.
- **Three stale rows, refreshed (i5).** API retry visibility read
  `unverified`/"never mapped" (and its OpenCode and wire rows "never mapped"
  / "no retry observed in fixtures") after `retry-scheduled` landed
  `verified`; the SDK handshake read `unverified` though its status row is
  `out-of-scope` with a reason; message replay read `unverified` though its
  route is `deferred`/`out-of-scope` and it has no feature row.
- **Pin citations re-checked.** Every degraded row's `sdk_mode.rs` range
  (L682–L702 + L763, L786–L816, L818–L880, L918–L927) says what its title
  claims at v0.6.4.

## Iteration 5 triage

| Row | Status | Action | Rationale |
| --- | --- | --- | --- |
| cross-map retry / replay / handshake rows | stale text | accept (matrix refresh in this change) | `statuses.json` was already right; only the matrices lagged |
| `permission-reask`, `agent-switch-state`, `mid-turn-steering`, `prompt-attachments` | degraded (pin) | accept | citations re-verified at v0.6.4; moving any needs a Maki pin bump |
| `sdk-control-handshake`, `prompt-file-mentions` | out-of-scope | accept | reasons unchanged (see iteration-4 triage) |

No `fix`, `coverage` or `capability` actions: 0 open defects and 0 reachable
`blockedBy: none` rows below `verified`.

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

- **Steering is queueing at the pin.** The headless session reads one stdin
  prompt per run (maki-agent `headless.rs` v0.6.4 L365); `Steered`
  (`maki-agent/src/types.rs` L604–L611, L732–L735) reports plugin rewrites and
  drops. The iteration-2/3 rows saying a mid-run `user` "steers the run" were
  wrong. Before `add-mid-turn-prompt-queue` the bridge also opened a second
  turn over the running one; read from the pre-change `beginTurn`/`handleResult`,
  the first result closed the second turn and the second result was ignored.
  `steering.test.ts` failed against that code and passes after the change.

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
| `mid-turn-steering` | unverified (none) → degraded (pin) | capability → `add-mid-turn-prompt-queue`, then accept the pinned remainder | the bridge opened a second turn over the running one; it now queues the turn behind the running one, which is what the pinned child does. Delivering into the running run has no SDK path at the pin (L682–L702, L763) |
| `sdk-control-handshake` | unverified, out-of-scope | accept (title records the reason in `rebaseline-compat-iteration-4`) | the pinned child runs without `initialize` (`handle_control_request` runs only when a `control_request` arrives, L818–L827); no TUI behavior depends on it — record, don't build |
| `agent-switch-state` | degraded (pin) | accept (title cites L818–L880 in `rebaseline-compat-iteration-4`) | pin-blocked: the inbound `control_request` subtypes at the pin are `initialize`, `interrupt`, `set_permission_mode`, `set_model` (L818–L880) — no `set_agent`. `set_permission_mode` only flips build/plan (`agent_mode`, L108–L113), which is not an OpenCode agent's identity (prompt, tools, model), so mapping agents onto it would invent semantics |
| `mid-session-model-switch` | degraded (pin) → verified | capability **(≠)** → `add-model-switch-forwarding` | mis-triaged as pin-blocked by `add-compat-burndown`: the pin defines inbound `set_model` (L861–L874, resolved through the model policy by `resolve_set_model`, L883–L906). Both pins support it and the TUI calls `POST /api/session/{id}/model` |

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
