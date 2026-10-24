# Tasks

- [x] 1.1 Project the bridge's frames into a per-session transcript. Verify:
  `bridge/test/session-history.test.ts` (user, assistant, tool, idle).
- [x] 1.2 Serve the route with the pinned paging. Verify: the same test
  (default order, cursor walk, invalid cursor, order+cursor, type filter) and
  contract validation.
- [x] 1.3 Flip the route to `served-live`, add `session-message-history`,
  narrow the deferred-surface feature. Verify: crosscheck.
- [x] 1.4 Re-record `resume-session-history` twice offline and twice live;
  accept the by-design title difference. Verify: byte-identical, `parity`.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate add-session-message-history --strict`.
