# Tasks

- [x] 1.1 Port the provider's diff, base, and status rules to batched sandbox git. Verify: `bridge/test/vcs-review.test.ts`.
- [x] 1.2 Re-read the project identity on project and location reads. Verify: the same test.
- [x] 1.3 Routes `served-live`/reachable, feature `vcs-review`. Verify: crosscheck.
- [x] 1.4 Record `view-session-diff` offline and live (branch pinned to `main`). Verify: `parity`, live equals offline.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate add-vcs-review --strict`.
