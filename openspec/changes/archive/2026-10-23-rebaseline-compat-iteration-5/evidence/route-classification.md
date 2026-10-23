# Route classification: how the bridge answers each pinned operation

Copied forward from `archive/2026-10-23-rebaseline-compat-iteration-4` by
iteration 5 (unchanged: re-enumerated, 143 = 143). Earlier: copied forward from
`archive/2026-10-23-rebaseline-compat-iteration-3` by iteration 4; rows marked **(i4)** changed. Re-enumerated at iteration 4: 143
pinned operations in `bridge/src/openapi-2.0.32.json`, 143 rows in
`bridge/compat/statuses.json`, no operation missing and none phantom.

Iteration-2 evidence for the rebaseline, copied forward and re-checked in
iteration 3. The determination comes from reading `bridge/src/bridge.ts`
dispatch (L409–L423) and `synthesize` in `bridge/src/spec-answers.ts`; it was
then verified against a live bridge — one `bun bridge/test/discovery.ts` pass
(5/5 scenarios clean, 0 defects appended) plus a probe that curled all 142
pinned `/api/*` operations against a bridge started the way
`bridge/test/lib/bridge.ts` starts one, reading the `matched` flag from each
request's `BRIDGE_LOG` line (bridge.ts:425).

Iteration 3 re-ran the enumeration against the whole vendored pin rather than
only `/api/*`, and re-read the two session rows whose dispatch label did not
match the code. Changes are marked **(i3)**.

`matched` is the bridge's own verdict: `true` means `synthesize` found a
spec template and answered it; `false` means dispatch fell through to the
404 `no spec route for …` arm (bridge.ts:427–431).

## Result

- 143 pinned operations across 119 paths (142 under `/api/`, plus one outside)
- 108 had no row in iteration 2; all 108 are `served-faked` (spec answer,
  `matched: true`), 0 `unhandled`
- 1 row named a route the pin does not define: `GET /api/session/{sessionID}/terminal`
  (removed in iteration 2)
- **(i3)** 1 pinned operation still had no row: `GET /auth/connect/{code}`.
  Probed live: `200 {"token":"sample"}`, `matched: true` — `served-faked`,
  added in iteration 3. The gap existed because iteration 2 scoped the
  enumeration to `/api/*`.

This confirms D3: dispatch falls through to `synthesize()`, which answers
from the vendored spec for every unrecognized route, so the honest row for
all 108 is `served-faked`, not `unhandled`.

The proposal expected "a handful that dispatch genuinely rejects stay
`unhandled`"; the measurement found none. `served-faked` is therefore the
status for the whole 108, and `unhandled` is left empty rather than
forced.

## Caveat: `GET /api/fs/read/*` is a literal wildcard

The pin spells that path with a literal `*` — not a `{param}` — so it is
requested literally here, and the bridge answers it `200` / `matched: true`
(it is `served-faked` like the rest). But `matchRoute` escapes the `*`, so
only a client asking for a literal `*` gets that answer: a real file path
404s. Measured directly against a live bridge:

- `GET /api/fs/read/*` → 200, `matched: true`
- `GET /api/fs/read/sample` → 404 `no spec route for …`
- `GET /api/fs/read/a/b` → 404 `no spec route for …`

The row is truthful as spelled; the unusability for real paths is recorded
here as a finding for the discovery loop, not as a status flip.

## Every pinned operation

| Route | Dispatch branch | Measured | `matched` | Classification |
| --- | --- | --- | --- | --- |
| `GET /auth/connect/{code}` **(i3)** | `synthesize` (dispatch falls through, bridge.ts:421–423; `matchRoute` matches the whole spec, not only `/api/*`) | 200 | `true` | `served-faked` **new** |
| `DELETE /api/credential/{credentialID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/debug/location` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/experimental/mcp/{server}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/experimental/persistent-pty/{ptyID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/experimental/session/{sessionID}/instructions/entries/{key}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/integration/{integrationID}/connect/command/{attemptID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/integration/{integrationID}/connect/oauth/{attemptID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/permission/saved/{id}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/pty/{ptyID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/session/{sessionID}` | `sessionRoute` → session object / kill child (real child state) | 204 | `null` | `served-live`  |
| `DELETE /api/session/{sessionID}/form/{formID}` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `DELETE /api/session/{sessionID}/inbox/{inboxID}` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `DELETE /api/session/{sessionID}/revert` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `DELETE /api/shell/{id}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `DELETE /api/worktree` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `GET /api/agent` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/agent/{agentID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/command` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/config` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/config/shell` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/credential` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/debug/location` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/event` | `openEventStream` (SSE, handled before dispatch) | SSE stream | `—` | `served-live`  |
| `GET /api/experimental/migration/v1` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/experimental/persistent-pty/{ptyID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/persistent-pty/{ptyID}/connect` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/persistent-pty/{ptyID}/snapshot` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/session/stats` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/session/{sessionID}/export` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/session/{sessionID}/instructions/entries` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/session/{sessionID}/log` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/session/{sessionID}/terminal` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/experimental/session/{sessionID}/terminal/read` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/form` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/fs/find` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/fs/list` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/fs/read/*` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/info` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/integration` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/integration/{integrationID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/integration/{integrationID}/connect/command/{attemptID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/integration/{integrationID}/connect/oauth/{attemptID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/location` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/mcp` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/mcp/resource` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/model` | `modelList` → `synthesize`, first entry patched to the announced model | 200 | `true` | `served-faked`  |
| `GET /api/model/default` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/permission/request` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/permission/saved` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/plugin` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/project` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/provider` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/provider/{providerID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/pty` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/pty/{ptyID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/pty/{ptyID}/connect` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/reference` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/session` | `listSessions` (real child state) | 200 | `null` | `served-live`  |
| `GET /api/session/active` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/session/{sessionID}` | `sessionRoute` → session object / kill child (real child state) | 200 | `null` | `served-live`  |
| `GET /api/session/{sessionID}/context` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `GET /api/session/{sessionID}/diff` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `GET /api/session/{sessionID}/form` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `deferred`  |
| `GET /api/session/{sessionID}/form/{formID}` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `GET /api/session/{sessionID}/inbox` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `deferred`  |
| `GET /api/session/{sessionID}/message` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `deferred`  |
| `GET /api/session/{sessionID}/message/{messageID}` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `GET /api/session/{sessionID}/permission` | `sessionRoute` → pending list (real child state) | 200 | `null` | `served-live`  |
| `GET /api/session/{sessionID}/permission/{requestID}` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `GET /api/shell` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/shell/{id}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/shell/{id}/output` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/skill` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/vcs` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked`  |
| `GET /api/vcs/base` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/vcs/branch` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/vcs/diff` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/vcs/status` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/websearch/provider` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `GET /api/worktree` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `PATCH /api/credential/{credentialID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `PATCH /api/experimental/config` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `PATCH /api/project/{projectID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `PATCH /api/session/{sessionID}` | `sessionRoute` → **falls through to `synthesize`** (no PATCH branch for `rest === ""`, bridge.ts:338–347) **(i3)** | 204 | `true` | `served-faked` **new** |
| `PATCH /api/session/{sessionID}/inbox/{inboxID}` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/credential` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/credential/{credentialID}/activate` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/experimental/fs/write` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/experimental/generate` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/experimental/integration/wellknown` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/experimental/mcp/{server}/connect` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/experimental/mcp/{server}/disconnect` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/experimental/persistent-pty/handoff` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/experimental/persistent-pty/shutdown` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/experimental/persistent-pty/{ptyID}/connect-token` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/experimental/session/import` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/experimental/session/{sessionID}/skill` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/experimental/session/{sessionID}/terminal` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/experimental/session/{sessionID}/wait` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/experimental/voice/session` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/integration/{integrationID}/connect/command` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/integration/{integrationID}/connect/external` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/integration/{integrationID}/connect/key` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/integration/{integrationID}/connect/oauth` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/integration/{integrationID}/connect/oauth/{attemptID}/complete` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/location/reload` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/pair` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/plugin/check` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/plugin/update` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/pty` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/pty/{ptyID}/connect-token` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/rpc/{rpcID}/{method}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/session` | `createSession` (real child state) | 200 | `null` | `served-live`  |
| `POST /api/session/{sessionID}/agent` | `sessionRoute` → sets `s.agent` (real child state) | 204 | `null` | `served-live`  |
| `POST /api/session/{sessionID}/background` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/command` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/compact` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/fork` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `deferred`  |
| `POST /api/session/{sessionID}/form` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/form/{formID}/reply` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/generate` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/interrupt` | `sessionRoute` → `interrupt`: `control_request`/`interrupt` to the child while a turn runs, `{interrupted}` from live turn state **(i4)** | 200 | `true` | `served-live` **(i4)** |
| `POST /api/session/{sessionID}/model` | `sessionRoute` → `selectModel`: `set_model` to the child; the ack moves the reported model **(i4)** | 204 | `null` | `served-live`  |
| `POST /api/session/{sessionID}/move` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/permission` | `sessionRoute` → **falls through to `synthesize`** (the pending-list merge is GET-only, bridge.ts:359–362) **(i3)** | 200 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/permission/{requestID}/reply` | `sessionRoute` → `replyPermission` (real child state) | 404 | `null` | `served-live`  |
| `POST /api/session/{sessionID}/prompt` | `sessionRoute` → `prompt` (real child state) | 200 | `null` | `served-live`  |
| `POST /api/session/{sessionID}/revert/commit` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/revert/stage` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/shell` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/synthetic` | `sessionRoute` → falls through to `synthesize` | 200 | `true` | `served-faked` **new** |
| `POST /api/session/{sessionID}/view` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |
| `POST /api/shell` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/vcs/init` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `POST /api/websearch` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/worktree` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `POST /api/worktree/refresh` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `PUT /api/experimental/mcp/{server}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `PUT /api/experimental/persistent-pty/{ptyID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `PUT /api/experimental/session/{sessionID}/instructions/entries/{key}` | `synthesize` (dispatch falls through, bridge.ts:422) | 204 | `true` | `served-faked` **new** |
| `PUT /api/pty/{ptyID}` | `synthesize` (dispatch falls through, bridge.ts:422) | 200 | `true` | `served-faked` **new** |
| `PUT /api/session/{sessionID}/environment` | `sessionRoute` → falls through to `synthesize` | 204 | `true` | `served-faked` **new** |

## Phantom

`GET /api/session/{sessionID}/terminal` — absent from the pin. The bridge 404s it as
`no spec route for …` (`matchRoute` finds no template), so no status can
truthfully describe it. Removed in task 2.3.
