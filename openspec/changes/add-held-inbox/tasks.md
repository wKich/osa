# Tasks

- [x] 1.1 Hold waiting prompts in the translator and deliver each at its turn start. Verify: `steering.test.ts`, `inbox.test.ts`.
- [x] 1.2 Serve inbox list, cancel, and update. Verify: `inbox.test.ts` (contract-validated).
- [x] 1.3 Routes `served-live`/reachable, feature `session-inbox-held`; narrow the deferred-surface row. Verify: crosscheck.
- [x] 1.4 Record `queue-prompt-while-running` and `manage-queued-prompts` offline and live. Verify: `parity`.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate add-held-inbox --strict`.
