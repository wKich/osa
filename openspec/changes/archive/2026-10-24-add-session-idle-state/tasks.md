# Tasks

- [x] 1.1 Set `time.idle`/`outcome` on terminal transitions before the frame;
  return them on reads. Verify: `bridge/test/session-idle.test.ts`.
- [x] 1.2 Serve `POST /api/session/{sessionID}/view` with the real server's
  rules. Verify: the same test (stale, future, repeat, invalid).
- [x] 1.3 Record the route `served-live`/reachable and feature
  `session-idle-state`. Verify: crosscheck.
- [x] 1.4 Settle the pilots' post-turn checkpoints; re-record twice offline
  and twice live; accept the remaining by-design differences with reasons.
  Verify: byte-identical runs; `send-prompt-stream-reply` and
  `allow-permission-once` `parity` offline and live.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate add-session-idle-state --strict`.
