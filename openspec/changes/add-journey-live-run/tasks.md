# Tasks

## 1. Spike: can real Maki reach an in-sandbox provider?

- [x] 1.1 From Maki's source at tag `v0.6.4`, find how a custom
  OpenAI-compatible provider and base URL are configured (file, keys) and how
  YOLO and permission asks are set per user config; record citations in
  `evidence/maki-provider-spike.md`. Verify in a throwaway sandbox (minimal
  policy, no provider): start a stub server on the sandbox's loopback with
  the image's Bun, run one `maki --print` turn against it, and log the stub's
  received request and the sandbox's effective policy
  (`openshell policy get <name> --full`) in the evidence file. If either
  precondition fails, stop here and report with the observed error.

## 2. Live runner

- [x] 2.1 Add a standalone entry for the mock provider that runs under the
  image's Bun with only the journey's turns as input; verify with
  `bun test` that it serves the same chunks as the in-process harness
  provider for the pilot turns.
- [x] 2.2 Implement the throwaway sandbox lifecycle (design decision 2):
  create, leftover check, exit/failure/interrupt cleanup; verify with a test
  against `bridge/test/fake-openshell.ts` that cleanup runs on success, on a
  thrown error, and on SIGINT, and that an existing `maki-oss-journeys-*`
  sandbox makes the runner refuse to start.
- [x] 2.3 Implement the journey-only Maki config upload (design decision 3)
  from the spike's findings; verify with the fake openshell that the uploaded
  files contain only the loopback provider, a placeholder key, and YOLO off,
  and that no `--env`, `--provider`, or policy command is issued.
- [x] 2.4 Implement the live run: start the in-sandbox provider, start the
  bridge with `OPENMAKI_SANDBOX` set to the throwaway sandbox, drive the
  journey script, render, normalize, diff against the committed reference,
  and write `evidence.live` (design decision 5); verify with a unit test of
  the evidence writer and the verdict on recorded fixtures.

## 3. Targets, gate, report

- [x] 3.1 Add `make test-journeys-live` with the skip conditions in design
  decision 6; verify it exits 0 and changes no file with `openshell` removed
  from `PATH`, and with `openshell status` failing (fake openshell).
- [x] 3.2 Extend `bridge/test/crosscheck.test.ts`: live evidence files exist;
  re-diffing committed live snapshots reproduces the live verdict; live
  request logs join the measured route set. Verify each with a temporary bad
  edit, then `cd bridge && bun test` passes.
- [x] 3.3 Show the live verdict beside the offline status in the journey lens
  and flag a live verdict worse than the offline one; verify `make compat`
  exits 0 after committing the regenerated report.

## 4. Pilot live runs

- [x] 4.1 Run `make test-journeys-live` for the three pilot journeys on a host
  with a gateway; verify the runs produce live evidence, that
  `openshell sandbox list` shows no `maki-oss-journeys-*` sandbox afterwards,
  and record during-run `openshell policy get <name> --full` output showing
  no provider rules in `evidence/pilot-live.md`.
- [x] 4.2 Run it a second time and verify byte-identical live snapshots; then
  triage any live verdict worse than the offline status with the
  `discovering-tui-journeys` hand-off table, recorded in
  `evidence/pilot-live.md`.

## 5. Gate

- [x] 5.1 Run in one pass: `make test`, `make test-bridge`, `make compat`,
  `make lint`, `make test-journeys`, `make test-journeys-live`, `openspec
  validate "add-journey-live-run" --strict`; all exit 0.
