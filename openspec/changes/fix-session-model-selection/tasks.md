# Tasks

- [x] 1.1 Start the child on the created model when listed. Verify: `model-switch.test.ts`.
- [x] 1.2 Emit `session.model.selected` and the history row on ack. Verify: same, contract-validated.
- [x] 1.3 Record `switch-model` offline and live. Verify: `parity` on both.
- [x] 1.4 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate fix-session-model-selection --strict`.
- [x] 1.5 `session-idle.test.ts`: wait for the trailing SSE frame after `wait` answers (a load race the gate hit). Verify: full suite.
