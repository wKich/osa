# Tasks

- [x] 1.1 Measure `openshell sandbox exec --tty` under a Bun PTY (interactive shell, resize). Verify: the proposal's measurement.
- [x] 1.2 Serve the persistent-PTY routes and attach socket. Verify: `bridge/test/sandbox-terminals.test.ts` (contract-validated).
- [x] 1.3 Report `persistentPty: true` with a sandbox. Verify: `boot-surface.test.ts`.
- [x] 1.4 Routes `served-live`/reachable, feature `sandbox-terminals`. Verify: crosscheck.
- [x] 1.5 Re-record every journey offline and live; accept the sandbox shell's prompt. Verify: `open-terminal-pane` and `open-subagent-session` `parity` offline and live.
- [x] 1.6 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`, `openspec validate add-sandbox-terminals --strict`.
