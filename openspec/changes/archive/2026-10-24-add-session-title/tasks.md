# Tasks

- [x] 1.1 `bridge/src/title.ts`: Maki's `generate_title` rule. Verify: a unit
  test covers short, whitespace, long-with-space, long-without-space, and
  multibyte cases from the pinned tests (`sessions.rs` v0.6.4 L3429–L3445).
- [x] 1.2 Bridge: title on the first run's end, `session.renamed`, `title` on
  session reads. Verify: a spawned-bridge test asserts the frame and both
  reads, and no second rename.
- [x] 1.3 Add feature `session-title` (verified, the new test) and list it on
  the journeys that show the title. Verify: crosscheck.
- [x] 1.4 Re-record the pilots offline (twice) and live; withdraw the wrong
  accepted reason (it also hid the unread marker; the true reason is recorded
  with the idle-state change). Verify: `make test-journeys`,
  `make test-journeys-live`.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate add-session-title --strict`.
