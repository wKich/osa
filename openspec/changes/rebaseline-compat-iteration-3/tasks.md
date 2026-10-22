# Tasks

## 1. Re-enumerate the pinned contract

- [x] 1.1 Script the route enumeration from `bridge/src/openapi-2.0.32.json`
      over the **whole** spec (not only `/api/*`), and verify the diff against
      `statuses.json` names exactly `GET /auth/connect/{code}` as unrecorded
      and nothing as phantom
- [x] 1.2 Probe the unrecorded operation against a bridge started the way
      `bridge/test/lib/bridge.ts` starts one, and verify its `BRIDGE_LOG`
      entry shows `matched: true` and a `200`
- [x] 1.3 Re-read Maki `sdk_mode.rs` at v0.6.4 and OpenCode
      `session-event.ts` at v2.0.32, copy the three matrices and the route
      classification forward into this change, and verify no file under
      `openspec/changes/archive/` was modified

## 2. Correct the matrices

- [x] 2.1 Refresh every matrix row contradicted by a later `statuses.json`
      flip (streaming deltas, subagent nesting) and every row contradicted by
      the code (execution events, retry counterpart, measured terminal route,
      two dispatch labels), citing the pinned file and line
- [x] 2.2 Record the wire features the matrices lacked (per-message envelope,
      inbound image blocks, excluded `question` tool), and verify each cites
      `sdk_mode.rs` at the pin
- [x] 2.3 Verify the `GET /api/fs/read/*` literal-wildcard caveat still holds
      by probing a real path (404, `matched: false`)

## 3. Record in the status file

- [x] 3.1 Add the `GET /auth/connect/{code}` route row at `served-faked` with
      this change's evidence
- [x] 3.2 Add the `wire-envelope`, `prompt-attachments`, and `retry-scheduled`
      feature rows at `unverified`, and verify no new row is `verified`

## 4. Regenerate and verify

- [x] 4.1 Run `bun scripts/gen-compat.ts` and verify `--check` passes;
      `make compat` (regen + `git diff --exit-code`) passes once the
      regenerated report is committed
- [x] 4.2 Run `cd bridge && bun test` and verify the suite is green,
      including the evidence-existence crosscheck
- [x] 4.3 Re-run both discovery passes and verify they still append nothing

## 5. Wrap-up

- [x] 5.1 Record the archive-time path rewrite requirement in
      `evidence/discovery-log.md`
