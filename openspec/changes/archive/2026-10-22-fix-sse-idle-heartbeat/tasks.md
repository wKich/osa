# Tasks

## 1. Pin the expected behavior from evidence

- [x] 1.1 Read the defect capture and reproduce at TUI level
      (`make test-ui` prints the prompt/permission invariant failures;
      `tui-last-frames.jsonl` shows a 46-second silent gap ending in a second
      `server.connected`) (verify: the run's failing output and the gap are
      recorded in `evidence/`)
- [x] 1.2 Establish what the stream should send, in decision-1 order —
      archived mapping table (`: heartbeat` comments on the real wire), the
      vendored OpenAPI contract (declares the stream schema, no keepalive),
      the pinned OpenCode 2.0.32 client (45-second stall timeout, any byte
      resets it) (verify: `design.md` decision 1 names each source and the
      value it contributed)

## 2. Fix the event stream

- [x] 2.1 `bridge/src/bridge.ts`: write `: heartbeat` on every open stream
      inside the idle window, per subscriber, cleared on cancel or enqueue
      failure (`SSE_HEARTBEAT_MS`, default 15000) (verify:
      `bridge/test/contract.test.ts` idle-gap test passes against a live
      bridge)
- [x] 2.2 `bridge/test/lib/contract.ts`: `checkRawSse` accepts `:` comment
      lines while still rejecting anything that is not a frame or a comment
      (verify: the archived-raw and live-wire tests stay green, and a
      deliberately non-`data:`/non-comment line is still reported)
- [x] 2.3 `bridge/src/bridge.ts`: emit `model.updated` for the session's
      location when the child announces on `system.init`, so the TUI refetches
      the model list it read at boot and its composer stops refusing submits
      (verify: the live turn test asserts the frame and a refetched
      `/api/model` naming the announced model)

## 3. Assert the keepalive and the selectable model

- [x] 3.1 Live-bridge test: an idle stream produces a heartbeat within the
      window, and the comment does not appear as an event frame
      (verify: `cd bridge && bun test -t heartbeat` passes)
- [x] 3.2 Live-bridge test: the turn emits `model.updated` and `GET /api/model`
      then names the announced provider and id (verify: the contract suite
      passes)

## 4. Close the loop's records

- [x] 4.1 `bridge/defects.json`: `tui-sse-idle-reconnect-drops-next-turn`
      flips to `status: "fixed"` — no `expectedFailure` marker or golden to
      flip, capture kept (verify: `bridge/test/crosscheck.test.ts` passes)
- [x] 4.2 `bridge/compat/statuses.json`: `sse-idle-keepalive` flips to
      `verified` with `bridge/test/contract.test.ts` as evidence, and the
      `model-list-refresh` row is added as `verified` with the same test
      (verify: `make compat` regenerates `docs/compatibility.md` with the
      keepalive row no longer `buggy` and the new row present)

## 5. Verification pass and wrap-up

- [x] 5.1 API-level discovery rerun (verify: `bun bridge/test/discovery.ts`
      prints `ok` for all five scenarios and `0 appended`, leaving
      `bridge/defects.json` byte-identical)
- [x] 5.2 TUI-level pass rerun after the fix, with its capture recorded as
      this change's evidence (verify: `make test-ui` prints `tui-check: PASS`
      — both prompts and the permission round trip — the frame log holds
      exactly one `server.connected`, and `evidence/tui-keepalive-frames.jsonl`
      plus `evidence/tui-keepalive-note.md` record it)
- [x] 5.3 One-pass gate: `make test`, `make test-bridge`, `make compat`,
      `make lint`, `openspec validate "fix-sse-idle-heartbeat"` all exit 0
      (verify: five commands in one shell pass, no failures)
- [x] 5.4 Archive-path reminder: the statuses row for this defect cites a
      suite file, not this change directory, so no evidence key needs
      rewriting at archive time; the TUI capture recorded under this change's
      `evidence/` is historical (verify: `bridge/compat/statuses.json` has no
      key pointing into `openspec/changes/fix-sse-idle-heartbeat/`)
