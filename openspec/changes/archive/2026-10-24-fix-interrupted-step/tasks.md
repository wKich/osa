# Tasks

- [x] 1.1 Record `interrupted-step-not-failed` from the journey. Verify: crosscheck.
- [x] 1.2 Emit `session.step.failed` for an interrupted step. Verify: `bridge/test/interrupt.test.ts`.
- [x] 1.3 Close the defect; record `interrupt-running-turn` offline and live. Verify: `parity`.
- [x] 1.4 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate fix-interrupted-step --strict`.
