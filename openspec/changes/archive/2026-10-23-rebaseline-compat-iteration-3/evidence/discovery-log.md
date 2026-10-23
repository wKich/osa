# Discovery pass 3: pinned re-enumeration against the live bridge

Iteration 3 of the discovery loop. Everything here is read-only against the
pins and the running bridge; this change records findings and adds status rows,
it changes no bridge behavior.

## The passes

| Pass | Command | Result |
| --- | --- | --- |
| API discovery | `bun bridge/test/discovery.ts` | 5 scenarios, 5 clean, 0 known defects deduped, **0 appended** |
| TUI discovery | `make test-ui` (real `opencode v2.0.32`, the exact pin) | PASS — 37 requests served without 404, PONG rendered, permission round-tripped, 0 open defects |
| Offline suite | `cd bridge && bun test` | 38 pass, 0 fail, 137 expectations |
| Report consistency | `bun scripts/gen-compat.ts --check` | `docs/compatibility.md` matches |

Baseline was green before any edit, so nothing below is a regression; the
findings are enumeration gaps, not new breakage.

## Route enumeration diff (task 1.1)

Scripted against the vendored pin (`bridge/src/openapi-2.0.32.json`, 119 paths):

```
spec ops: 143  recorded: 142
MISSING from statuses:
GET /auth/connect/{code}
RECORDED but not in pin:
(none)
```

The iteration-2 enumeration scoped itself to paths under `/api/` ("Paths
outside `/api/` are not part of that surface and are excluded",
`route-enumeration.md` in the iteration-2 archive). That scoping is the gap:
the pin defines one more operation outside `/api/`, and the bridge answers it.

### Probe of the one unrecorded operation (task 1.2)

Started the shipped bridge the way `bridge/test/lib/bridge.ts` starts it
(`PORT=0`, scripted child seam, `BRIDGE_LOG`), then read `matched` from the
request log:

| Probe | Response | `matched` | Classification |
| --- | --- | --- | --- |
| `GET /auth/connect/abc123` | `200 {"token":"sample"}` | `true` | `served-faked` |
| `GET /api/fs/read/sample` | `404 no spec route for …` | `false` | (caveat re-confirmed) |
| `GET /api/fs/read/a/b` | `404 no spec route for …` | `false` | (caveat re-confirmed) |
| `PATCH /api/session/does-not-exist` | `404 SessionNotFoundError` | `undefined` | (not a spec fallthrough) |

`/auth/connect/{code}` is served by the same `synthesize` fallthrough
(`bridge/src/bridge.ts:421–423`) as every other unrecognized route, because
`matchRoute` matches against the whole vendored spec, not only `/api/*`. So the
honest row is `served-faked`, not `unhandled`.

The `GET /api/fs/read/*` caveat from iteration 2 still holds: only a literal
`*` matches, a real path 404s with `matched: false`.

## What the re-read contradicted (tasks 1.3–1.5)

The matrices copied forward into this directory are corrected against the pins;
each correction cites the pinned file and line. Summary:

1. **The bridge emits 18 pinned envelopes, not 15.** `session.execution.started`,
   `.succeeded`, and `.failed` are emitted (`bridge/src/translator.ts:99`,
   `:321`, `:323`) but were marked "—" in the event table.
2. **`session.retry.scheduled` exists at the pin.** The cross-map claimed
   "no direct counterpart" for Maki's `system api_retry`; the pin defines a
   durable retry event (`packages/schema/src/session-event.ts` at v2.0.32,
   `RetryScheduled`). The bridge tolerates `api_retry` without emitting it.
3. **Maki's universal envelope was unrecorded.** Every wire message carries
   top-level `session_id` and `uuid` (`src/sdk_mode.rs:117–122`), and the
   bridge relies on it (`bridge/src/translator.ts:122`).
4. **Inbound `user` accepts image blocks.** L688 and L805–815 decode
   base64 image blocks; the CLI table called vision "not representable in the
   current prompt POST path". The OpenCode prompt POST does carry a `files[]`
   attachment array (`PromptInput.FileAttachment`), so both sides have a
   representation the bridge forwards on neither.
5. **Two rows against later status flips.** Streaming deltas and subagent
   nesting are `verified` in `statuses.json` (the 2026-10-23 live captures) but
   still `unverified`/`deferred` in the matrices.
6. **`GET /api/experimental/session/{sessionID}/terminal` is measured, not
   out-of-scope.** The TUI calls it at boot in the captured request log
   (`bridge/test/captures/tui-last-requests.jsonl`, 200, `matched: true`).
7. **Two route-classification branch labels were wrong** (the statuses were
   right): `PATCH /api/session/{sessionID}` and
   `POST /api/session/{sessionID}/permission` both fall through to
   `synthesize` — `sessionRoute` has no branch for either
   (`bridge/src/bridge.ts:337–367` only handles PATCH-less `rest === ""` and
   holds the pending list for GET only).

## Unchanged findings (still true, re-confirmed)

- The bridge emits four event names the pin does not define:
  `model.updated`, `permission.asked`, `permission.replied`, and
  `server.connected` (the last is the TUI handshake, pinned by live capture).
- `GET /api/fs/read/*` is only reachable as a literal `*`.
- Every other pinned operation keeps the iteration-2 classification.

## Evidence paths this change adds

`bridge/compat/statuses.json` rows cite files in this directory. At archive
time the archive commit must rewrite those paths to
`openspec/changes/archive/<date>-rebaseline-compat-iteration-3/evidence/…`,
or `crosscheck.test.ts` goes red.
