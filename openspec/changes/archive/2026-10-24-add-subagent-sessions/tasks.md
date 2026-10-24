# Tasks

- [x] 1.1 Open a child session per Task call and route its frames there. Verify: `bridge/test/session-subagent.test.ts`.
- [x] 1.2 Filter the session list by `parentID`. Verify: the same test.
- [x] 1.3 Record `open-subagent-session` offline and live; accept the title-only checkpoints. Verify: live equals offline; the `Terminals` tab remains (terminal capability).
- [x] 1.4 Record `background-blocking-tools` as pin-blocked; link its route. Verify: crosscheck.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate add-subagent-sessions --strict`.
