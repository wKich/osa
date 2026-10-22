# Evidence: idle keepalive and the model-list gate

Both halves of `tui-sse-idle-reconnect-drops-next-turn` were pinned from
recorded sources before any code changed, then re-measured after the fix.

## Before the fix (reproduction, 2026-10-21)

`make test-ui` on the pre-fix build:

```
FAIL    expected >=2 prompt turns, saw 1 session.execution.started
FAIL    no permission.asked frame: the gated prompt never asked
FAIL    no 204 permission reply in the log (got none)
FAIL    probe still exists: the accepted command did not run
tui-check: FAILED (4)
```

Frame log of that run (`bridge/test/captures/defect-…` and the run before it):

- `session.execution.succeeded` at `T`, then **nothing** for 46.014 s, then a
  second `server.connected` — the client's stall timeout (45 s) plus its 1 s
  reconnect backoff.
- 59 requests: the second `GET /api/info` at `T+46 s` is the client's full
  boot sweep running again (the re-boot).
- `POST …/prompt` appears **once**; it was typed at `T+20 s`, while the stream
  was still connected, so the reconnect is not what dropped it.

Client source read from the installed OpenCode 2.0.32 binary (pinned contract):

```js
var no=2000, Sr=1000, ro=50, so=45000, io=20000;   // so = idleTimeout
let c = n.idleTimeout ?? so;
let de=()=>{ if(ie=Date.now(), te===void 0) return;
  clearTimeout(ye), ye=setTimeout(()=>ce.abort(Error("Event stream stalled")), c) };
// parser: any received chunk counts as activity, comments are not events
if(!y.done) n?.onActivity?.();
… S = lines.filter(m=>m.startsWith("data:")) … if(S!=="") yield JSON.parse(S)
```

The second gate, same binary — the composer's submit path:

```js
let ve = k.model.selection();
if (!ve) return Se(), !1;
if ((!o.sessionID || we.mode !== "shell") && !k.model.available(ve))
  return Q.show({title:"Model unavailable",
    message:`${ve.providerID}/${ve.modelID} is not available in this session's location`,
    variant:"warning"}), !1;
// available(): the selected {providerID, modelID} is in the location list
function _(O){ return !!g()?.some((H)=>H.providerID===O.providerID && H.id===O.modelID) }
```

Boot `GET /api/model` in that run (read **before** any child existed):

```json
{"location":{"directory":"…/maki-openshell"},
 "data":[{"id":"sample","modelID":"sample","providerID":"sample","name":"sample", …}]}
```

The first submit selected `sample/sample` and posted fine; `system.init` then
announced `synthetic/fake`, the session model followed it, and the toast above
appeared in the transcript for every later Enter.

Archived sources for the keepalive:

- `openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/mapping-table.md`
  §0: "one bare `data: <json>\n\n` per frame (no `id:`/`event:` lines;
  `: heartbeat` comments between frames)" — measured on the real wire.
- The vendored OpenAPI 2.0.32 declares the `text/event-stream` schema but no
  event names and no keepalive, so it cannot settle either question; no
  archived capture contains `model.updated`, so the event name is pinned from
  the consumer's own handler (quoted above).

## After the fix (passing run, 2026-10-21)

`make test-ui`:

```
ok      composer accepted 2 prompts; PONG rendered
ok      permission dialog round-tripped: ask -> 204 reply -> gated command ran
tui-check: PASS — invariants hold, 0 open defect(s) recorded from this capture
```

Same run's frame and request logs, committed beside this note:

- **1** `server.connected` in 21 frames — no reconnect across either idle gap.
- `model.updated` with `location` at `14:51:15.930Z`; the client's
  `GET /api/model` follows at `14:51:15.943Z` (**13 ms** later) — the event is
  what triggers the refetch.
- two `POST …/prompt` calls, permission reply `204`, 37 requests total (no
  duplicated boot sweep).
