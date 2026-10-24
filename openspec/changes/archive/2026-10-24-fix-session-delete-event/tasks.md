# Tasks

- [x] 1.1 Record `session-delete-emits-no-event` from the `delete-session` journey. Verify: crosscheck.
- [x] 1.2 Emit `session.deleted` on delete. Verify: `bridge/test/session-api.test.ts`.
- [x] 1.3 Close the defect; record `delete-session` offline (twice) and live. Verify: `parity`.
- [x] 1.4 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate fix-session-delete-event --strict`.
