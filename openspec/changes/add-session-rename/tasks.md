# Tasks

- [x] 1.1 Serve `PATCH /api/session/{sessionID}` (title, empty title,
  metadata, 404). Verify: `bridge/test/session-title.test.ts`.
- [x] 1.2 Route `served-live`/reachable, feature `session-rename`. Verify:
  crosscheck.
- [x] 1.3 Record `rename-session` (offline twice, live with the area batch);
  accept the dialog's prefilled-title difference. Verify: `parity`.
- [x] 1.4 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate add-session-rename --strict`.
