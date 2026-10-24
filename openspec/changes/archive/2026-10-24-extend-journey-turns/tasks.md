# Tasks

- [x] 1.1 Paced text turns on the mock provider and the scripted child, with interrupt. Verify: `mock-provider.test.ts`, `fake-maki-script.test.ts`.
- [x] 1.2 Per-side `call` turns. Verify: the same tests.
- [x] 1.3 `fail` turns with the pinned retry and failure shapes. Verify: the same tests.
- [x] 1.4 `OPENCODE_DISABLE_AUTOUPDATE=1` in the harness env. Verify: `record.test.ts`; no snapshot carries an update hint.
- [x] 1.5 Re-record every journey offline and live. Verify: all 14 stay `parity` on both.
- [x] 1.6 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate extend-journey-turns --strict`.
