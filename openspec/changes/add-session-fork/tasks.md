# Tasks

- [x] 1.1 Fork flags on the child argv. Verify: `argv.test.ts`.
- [x] 1.2 Serve the full fork; refuse cut, unknown, and empty forks. Verify: `session-fork.test.ts` (contract-validated).
- [x] 1.3 Route `served-live`/reachable; features `session-fork` (verified) and `session-fork-at-message` (pin). Verify: crosscheck.
- [x] 1.4 Record `fork-session-from-message` offline and live, prompting inside the fork. Verify: `parity`.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate add-session-fork --strict`.
